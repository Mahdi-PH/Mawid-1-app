/**
 * مكافحة الغش: تحقق من المدخلات على الخادم، وتجميع المخالفات، وحظر تلقائي مؤقت.
 * Server-side plausibility checks. The authoritative simulation already prevents the
 * classic exploits (the server does its own raycasts, so an aimbot cannot invent a hit);
 * this layer catches impossible *inputs* — speed hacks, fire-rate hacks, teleports.
 */
import { balance, classBalance, maxShotsInWindow, type ClassKey, type InputCommand } from '@duskfront/shared';
import { createLogger } from '../logger.js';

const AC = balance.anticheat;
const P = balance.player;
const log = createLogger('anticheat');

export type ViolationKind =
  | 'speed'
  | 'fire_rate'
  | 'turn_rate'
  | 'teleport'
  | 'input_flood'
  | 'origin_mismatch'
  | 'bad_payload';

export interface Violation {
  kind: ViolationKind;
  weight: number;
  detail: string;
  at: number;
}

interface TrackedSession {
  score: number;
  lastDecayAt: number;
  lastYaw: number;
  lastInputAt: number;
  inputsInWindow: number;
  windowStartedAt: number;
  shotTimes: number[];
  violations: Violation[];
}

/**
 * أوزان المخالفات. الحمولة الفاسدة وزنها منخفض عمدًا: عميل قديم أو حزمة تالفة
 * ليسا غشًّا، بينما الانتقال الآني وتسريع الإطلاق مؤشران قويان.
 */
const WEIGHTS: Record<ViolationKind, number> = {
  speed: 2,
  fire_rate: 3,
  turn_rate: 1,
  teleport: 4,
  input_flood: 1,
  origin_mismatch: 2,
  bad_payload: 0.35,
};

export class AntiCheat {
  private readonly sessions = new Map<string, TrackedSession>();

  track(sessionId: string): void {
    if (!this.sessions.has(sessionId)) {
      this.sessions.set(sessionId, {
        score: 0,
        lastDecayAt: 0,
        lastYaw: 0,
        lastInputAt: 0,
        inputsInWindow: 0,
        windowStartedAt: 0,
        shotTimes: [],
        violations: [],
      });
    }
  }

  forget(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  score(sessionId: string): number {
    return this.sessions.get(sessionId)?.score ?? 0;
  }

  violations(sessionId: string): Violation[] {
    return this.sessions.get(sessionId)?.violations ?? [];
  }

  /** يجب حظر اللاعب مؤقتًا؟ */
  shouldBan(sessionId: string): boolean {
    return this.score(sessionId) >= AC.violationBanThreshold;
  }

  banUntil(): Date {
    return new Date(Date.now() + AC.tempBanMinutes * 60_000);
  }

  private flag(sessionId: string, kind: ViolationKind, detail: string, now: number): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    const weight = WEIGHTS[kind];
    session.score += weight;
    session.violations.push({ kind, weight, detail, at: now });
    if (session.violations.length > 50) session.violations.shift();
    log.warn('violation', { sessionId, kind, detail, score: session.score });
  }

  /** يُستدعى كل تحديث لتخفيف النتيجة تدريجيًا. */
  decay(sessionId: string, now: number): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    const elapsed = now - session.lastDecayAt;
    if (elapsed <= 0) return;
    session.lastDecayAt = now;
    session.score = Math.max(0, session.score - AC.violationDecayPerSec * elapsed);
  }

  /**
   * تحقق من أمر إدخال واحد قبل إدخاله إلى المحاكاة.
   * يعيد أمرًا مُصحّحًا (قد يكون مقصوصًا) أو null للرفض.
   */
  validateInput(
    sessionId: string,
    command: InputCommand,
    classKey: ClassKey,
    now: number,
  ): InputCommand | null {
    const session = this.sessions.get(sessionId);
    if (!session) return command;

    // 1) غمر بالمدخلات / input flooding
    if (now - session.windowStartedAt > 1) {
      session.windowStartedAt = now;
      session.inputsInWindow = 0;
    }
    session.inputsInWindow++;
    const maxInputsPerSecond = 260;
    if (session.inputsInWindow > maxInputsPerSecond) {
      this.flag(sessionId, 'input_flood', `${session.inputsInWindow} inputs/s`, now);
      return null;
    }

    // 2) سرعة الالتفات / turn-rate
    const maxTurn = (AC.maxYawRateDegPerSec * Math.PI) / 180;
    const dt = Math.max(command.dt, 1 / 240);
    let delta = Math.abs(command.yaw - session.lastYaw) % (Math.PI * 2);
    if (delta > Math.PI) delta = Math.PI * 2 - delta;
    if (session.lastInputAt > 0 && delta / dt > maxTurn) {
      this.flag(sessionId, 'turn_rate', `${((delta / dt) * 180) / Math.PI | 0} deg/s`, now);
    }
    session.lastYaw = command.yaw;
    session.lastInputAt = now;

    // 3) شدّة محور الحركة / movement axis magnitude
    const magnitude = Math.hypot(command.moveX, command.moveZ);
    if (magnitude > 1.02) {
      const scale = 1 / magnitude;
      return { ...command, moveX: command.moveX * scale, moveZ: command.moveZ * scale };
    }
    void classKey;
    return command;
  }

  /**
   * تحقق من إزاحة اللاعب بين تحديثين — يكشف تسريع السرعة والانتقال الآني.
   * يعيد true إذا كانت الإزاحة مقبولة.
   */
  validateDisplacement(
    sessionId: string,
    classKey: ClassKey,
    distance: number,
    elapsedSec: number,
    now: number,
  ): boolean {
    if (elapsedSec <= 0) return true;
    const cls = classBalance(classKey);
    // أقصى سرعة نظرية: جري + دفعات القدرات + هامش
    const theoretical =
      cls.speed * P.sprintMultiplier * AC.maxSpeedTolerance +
      balance.classes.sunshot.abilities.e.impulse * 0.5;
    const speed = distance / elapsedSec;
    if (speed > theoretical * 3) {
      this.flag(sessionId, 'teleport', `${speed.toFixed(1)} m/s`, now);
      return false;
    }
    if (speed > theoretical) {
      this.flag(sessionId, 'speed', `${speed.toFixed(1)} m/s > ${theoretical.toFixed(1)}`, now);
      return false;
    }
    return true;
  }

  /** تحقق من معدل الإطلاق على نافذة ثانيتين. */
  validateShot(sessionId: string, weaponKey: Parameters<typeof maxShotsInWindow>[0], now: number): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return true;
    const windowSec = 2;
    session.shotTimes.push(now);
    while (session.shotTimes.length > 0 && now - session.shotTimes[0]! > windowSec) session.shotTimes.shift();
    const allowed = maxShotsInWindow(weaponKey, windowSec);
    if (session.shotTimes.length > allowed) {
      this.flag(sessionId, 'fire_rate', `${session.shotTimes.length} shots / ${windowSec}s > ${allowed}`, now);
      return false;
    }
    return true;
  }

  /** يُسجّل رفض الخادم لنقطة انطلاق غير منطقية. */
  flagOriginMismatch(sessionId: string, detail: string, now: number): void {
    this.flag(sessionId, 'origin_mismatch', detail, now);
  }

  flagBadPayload(sessionId: string, detail: string, now: number): void {
    this.flag(sessionId, 'bad_payload', detail, now);
  }
}
