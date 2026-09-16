/**
 * محاكاة المباراة الموثوقة — قلب اللعبة.
 * The authoritative match simulation. The server owns an instance of this and
 * streams snapshots from it; the client owns an instance too, for offline modes
 * (تدريب/حملة/مناوشة ضد البوتات) and for local prediction of its own player.
 *
 * كل الأرقام تأتي من balance.json عبر وحدة balance.ts — لا أرقام ثابتة هنا.
 */
import { balance, classBalance, startingAmmo } from '../balance.js';
import {
  computeLightLevel,
  duskLineX,
  solarChargeMultiplier,
  stepExposure,
  zoneAtX,
} from '../dusk.js';
import { clamp, clamp01, directionFromAngles, distance3, lerp, raySphere } from '../math.js';
import { CollisionWorld, raycastWorld, rayObb, stepCharacter, stepProjectile } from '../physics.js';
import { Rng } from '../rng.js';
import {
  MAP_HALF,
  clampToMap,
  getObstacles,
  teamSpawnPoint,
  terrainHeight,
  type BoxObstacle,
} from '../terrain.js';
import {
  InputButton,
  type AbilitySlot,
  type ClassKey,
  type CrawlerState,
  type Difficulty,
  type GameMode,
  type InputCommand,
  type MatchPhase,
  type MatchSnapshot,
  type PlayerPublicState,
  type StructureState,
  type TeamId,
  type Vec3,
  type WeaponKey,
  type WellState,
  type WinReason,
  type ZoneKey,
} from '../types.js';
import {
  applyDamage,
  canFire,
  chargeRatio,
  explosionDamage,
  fallDamage,
  hitRegionFor,
  isSolar,
  lumenCost,
  lumenRegenPerSecond,
  magazineSize,
  pelletCount,
  reloadSeconds,
  resolveDamage,
  shotInterval,
  spreadRadians,
  weaponRange,
} from '../weapons.js';
import type { SimEvent } from './events.js';
import { emptyAbility, emptyMotion, emptyStats, emptyWeaponState, type SimPlayer } from './state.js';

const P = balance.player;
const C = balance.crawler;
const W = balance.wells;
const LU = balance.lumen;
const NET = balance.network;
const ULT = balance.ultimate;

export interface SimPlayerInit {
  id: string;
  userId: string;
  name: string;
  team: TeamId;
  classKey: ClassKey;
  isBot?: boolean;
  botDifficulty?: Difficulty;
}

export interface SimOptions {
  mode: GameMode;
  matchId: string;
  seed?: number;
  /** يتجاوز مدة الوضع الافتراضية (يُستخدم في الاختبارات) */
  durationSec?: number;
  serverVersion?: string;
}

export interface FireRequest {
  seq: number;
  origin: Vec3;
  direction: Vec3;
  chargeSec: number;
  clientTimeMs: number;
}

export interface AbilityRequest {
  slot: AbilitySlot;
  aim: Vec3;
  yaw: number;
}

interface Grenade {
  id: string;
  ownerId: string;
  team: TeamId;
  position: Vec3;
  velocity: Vec3;
  detonateAt: number;
}

interface PendingStrike {
  id: string;
  ownerId: string;
  team: TeamId;
  position: Vec3;
  at: number;
  radius: number;
  damage: number;
}

/** تصنيف هدف الشعاع / what a hitscan ray ran into. */
interface RayTarget {
  distance: number;
  kind: 'player' | 'structure' | 'crawler' | 'world';
  playerId?: string;
  structureId?: string;
  crawlerTeam?: TeamId;
  point: Vec3;
  isCore?: boolean;
}

export class MatchSimulation {
  readonly mode: GameMode;
  readonly matchId: string;
  readonly mapKey = balance.map.key;
  readonly durationSec: number;
  readonly world: CollisionWorld;
  readonly players = new Map<string, SimPlayer>();
  readonly structures = new Map<string, StructureState>();
  readonly wells: WellState[] = [];
  readonly crawlers: [CrawlerState, CrawlerState];
  teamLumen: [number, number] = [LU.teamStartAmount, LU.teamStartAmount];
  teamScore: [number, number] = [0, 0];
  timeSec = 0;
  tick = 0;
  phase: MatchPhase = 'warmup';
  winnerTeam: TeamId | null = null;
  winReason: WinReason = 'draw';

  private readonly rng: Rng;
  private readonly warmupSec: number;
  private readonly respawnSec: number;
  private readonly permanentDusk: boolean;
  private readonly killTarget: number;
  private events: SimEvent[] = [];
  private grenades: Grenade[] = [];
  private strikes: PendingStrike[] = [];
  private crawlerVotes = new Map<string, number>();
  private nextEntityId = 1;
  private staticObstacles: BoxObstacle[];

  constructor(options: SimOptions) {
    this.mode = options.mode;
    this.matchId = options.matchId;
    this.rng = new Rng(options.seed ?? balance.map.seed);
    this.staticObstacles = getObstacles();
    this.world = new CollisionWorld(this.staticObstacles);

    const isHunt = options.mode === 'shadowhunt';
    this.permanentDusk = isHunt;
    this.killTarget = balance.match.shadowhunt.killTarget;
    this.durationSec =
      options.durationSec ??
      (isHunt ? balance.match.shadowhunt.durationSec : balance.match.crawl.durationSec);
    this.warmupSec = isHunt ? balance.match.shadowhunt.warmupSec : balance.match.crawl.warmupSec;
    this.respawnSec = isHunt ? balance.match.shadowhunt.respawnSec : balance.match.crawl.respawnSec;

    for (let i = 0; i < W.positions.length; i++) {
      const p = W.positions[i]!;
      this.wells.push({ id: i, position: { x: p.x, z: p.z }, owner: -1, progress: 0, capturingTeam: -1 });
    }

    const startX = duskLineX(0);
    this.crawlers = [this.makeCrawler(0, startX), this.makeCrawler(1, startX)];
    this.refreshDynamicObstacles();
  }

  // ───────────────────────────── دورة الحياة / lifecycle ─────────────────────

  private makeCrawler(team: TeamId, x: number): CrawlerState {
    const z = C.laneZ[team]!;
    return {
      team,
      position: { x, y: terrainHeight(x, z), z },
      integrity: C.integrityMax,
      coreHealth: C.core.health,
      coreMaxHealth: C.core.health,
      coreShieldUntil: 0,
      outsideSince: -1,
      steerOffset: 0,
      boostUntil: 0,
      zone: 'dusk',
    };
  }

  addPlayer(init: SimPlayerInit): SimPlayer {
    const cls = classBalance(init.classKey);
    const ammo = startingAmmo(cls.primary as WeaponKey);
    const index = [...this.players.values()].filter((p) => p.team === init.team).length;
    const spawn = teamSpawnPoint(init.team, index, duskLineX(this.timeSec));
    const player: SimPlayer = {
      id: init.id,
      userId: init.userId,
      name: init.name,
      team: init.team,
      classKey: init.classKey,
      isBot: init.isBot ?? false,
      botDifficulty: init.botDifficulty ?? 'normal',
      motion: emptyMotion(spawn),
      health: cls.health,
      maxHealth: cls.health,
      shield: cls.shield,
      maxShield: cls.shield,
      lumen: LU.personalStartAmount,
      light: 0.5,
      zone: 'dusk',
      heat: 0,
      cold: 0,
      temperatureC: balance.zones.dusk.ambientTempC,
      alive: true,
      respawnAt: 0,
      ultimateCharge: 0,
      weapon: emptyWeaponState(cls.primary as WeaponKey, ammo.magazine, ammo.reserve),
      abilities: { q: emptyAbility(), e: emptyAbility(), f: emptyAbility() },
      grenades: P.grenadesPerLife,
      cloakedUntil: 0,
      markedUntil: 0,
      markedBy: null,
      mirrorShieldUntil: 0,
      dashUntil: 0,
      dashDir: { x: 0, y: 0, z: 0 },
      knockdownUntil: 0,
      speedMultiplier: 1,
      workshopUntil: 0,
      lastDamageAt: -999,
      lastShieldDamageAt: -999,
      recentDamagers: new Map(),
      inputQueue: [],
      lastAckSeq: 0,
      latencyMs: 0,
      history: [],
      stats: emptyStats(),
      connected: true,
      botMemory: {},
    };
    player.motion.yaw = init.team === 0 ? 0 : Math.PI;
    this.players.set(init.id, player);
    return player;
  }

  removePlayer(id: string): void {
    this.players.delete(id);
    this.crawlerVotes.delete(id);
    for (const [sid, s] of this.structures) {
      if (s.ownerId === id) this.structures.delete(sid);
    }
    this.refreshDynamicObstacles();
  }

  getPlayer(id: string): SimPlayer | undefined {
    return this.players.get(id);
  }

  /** يستبدل الصنف قبل بدء الجولة أو بعد الموت. */
  switchClass(id: string, classKey: ClassKey): boolean {
    const p = this.players.get(id);
    if (!p) return false;
    if (p.alive && this.phase === 'live') return false;
    const cls = classBalance(classKey);
    const ammo = startingAmmo(cls.primary as WeaponKey);
    p.classKey = classKey;
    p.maxHealth = cls.health;
    p.health = cls.health;
    p.maxShield = cls.shield;
    p.shield = cls.shield;
    p.weapon = emptyWeaponState(cls.primary as WeaponKey, ammo.magazine, ammo.reserve);
    p.abilities = { q: emptyAbility(), e: emptyAbility(), f: emptyAbility() };
    return true;
  }

  // ───────────────────────────── المدخلات / inputs ───────────────────────────

  enqueueInput(playerId: string, command: InputCommand): void {
    const p = this.players.get(playerId);
    if (!p) return;
    if (command.seq <= p.lastAckSeq) return;
    if (p.inputQueue.length >= NET.inputBufferSize) p.inputQueue.shift();
    p.inputQueue.push(command);
  }

  setLatency(playerId: string, ms: number): void {
    const p = this.players.get(playerId);
    if (p) p.latencyMs = clamp(ms, 0, 1000);
  }

  setConnected(playerId: string, connected: boolean): void {
    const p = this.players.get(playerId);
    if (p) p.connected = connected;
  }

  voteCrawler(playerId: string, offset: number): void {
    const p = this.players.get(playerId);
    if (!p) return;
    this.crawlerVotes.set(playerId, clamp(offset, -1, 1));
  }

  /** إنفاق لومِن الفريق / spend the team pool on a crawler action. */
  teamSpend(team: TeamId, action: 'crawlerBoost' | 'coreShield' | 'crawlerRepair'): boolean {
    const spend = LU.spend[action];
    if (this.teamLumen[team] < spend.cost) return false;
    const crawler = this.crawlers[team];
    if (action === 'crawlerBoost') {
      crawler.boostUntil = this.timeSec + LU.spend.crawlerBoost.durationSec;
    } else if (action === 'coreShield') {
      crawler.coreShieldUntil = this.timeSec + LU.spend.coreShield.durationSec;
    } else {
      if (crawler.integrity >= C.integrityMax) return false;
      crawler.integrity = Math.min(C.integrityMax, crawler.integrity + LU.spend.crawlerRepair.integrityPercent);
    }
    this.teamLumen[team] -= spend.cost;
    this.push({ type: 'announce', key: `announce.${action}`, severity: 'info', team });
    return true;
  }

  // ───────────────────────────── التحديث / the tick ──────────────────────────

  /**
   * خطوة محاكاة بمدة ثابتة / advance the simulation by dt seconds.
   * لا تُمسح قائمة الأحداث هنا: الطلبات التي تصل بين التحديثات (إطلاق/قدرة)
   * تُراكم أحداثها وتُسلَّم مع أحداث هذا التحديث.
   */
  step(dt: number): SimEvent[] {
    this.tick++;

    if (this.phase === 'ended') return this.drain();

    if (this.phase === 'warmup') {
      this.timeSec += dt;
      if (this.timeSec >= this.warmupSec) {
        this.phase = 'live';
        this.timeSec = 0;
        this.push({ type: 'announce', key: 'announce.match_start', severity: 'info' });
      }
      this.updatePlayers(dt);
      return this.drain();
    }

    this.timeSec += dt;
    this.updatePlayers(dt);
    this.updateStructures(dt);
    this.updateGrenades(dt);
    this.updateStrikes();
    this.updateWells(dt);
    if (this.mode === 'crawl') this.updateCrawlers(dt);
    this.recordHistory();
    this.checkWinConditions();
    return this.drain();
  }

  private drain(): SimEvent[] {
    const out = this.events;
    this.events = [];
    return out;
  }

  private push(event: SimEvent): void {
    this.events.push(event);
  }

  private nextId(prefix: string): string {
    return `${prefix}_${this.nextEntityId++}`;
  }

  // ───────────────────────────── اللاعبون / players ──────────────────────────

  private updatePlayers(dt: number): void {
    const duskX = duskLineX(this.timeSec);
    const structureList = [...this.structures.values()];

    for (const p of this.players.values()) {
      if (!p.alive) {
        if (this.timeSec >= p.respawnAt) this.respawn(p);
        continue;
      }

      // 1) استهلاك المدخلات المعلّقة
      const maxPerTick = Math.max(1, Math.ceil((dt * 1000) / 8));
      let consumed = 0;
      while (p.inputQueue.length > 0 && consumed < maxPerTick) {
        const cmd = p.inputQueue.shift()!;
        this.applyInput(p, cmd);
        p.lastAckSeq = cmd.seq;
        consumed++;
      }
      if (consumed === 0) {
        // لا مدخلات (انقطاع/بوت بلا أمر): حرّك بالجمود فقط
        this.applyInput(p, {
          seq: p.lastAckSeq,
          dt,
          moveX: 0,
          moveZ: 0,
          yaw: p.motion.yaw,
          pitch: p.motion.pitch,
          buttons: 0,
          clientTimeMs: this.timeSec * 1000,
        });
      }

      // 2) الضوء والمنطقة
      const zone: ZoneKey = this.permanentDusk ? 'dusk' : zoneAtX(p.motion.position.x, this.timeSec);
      const contribution = computeLightLevel(p.motion.position, this.timeSec, structureList, this.timeSec);
      p.zone = this.permanentDusk ? 'dusk' : contribution.zone;
      p.light = this.permanentDusk ? balance.zones.dusk.baseLight : contribution.light;

      // 3) التعرّض للحرارة/البرد
      const sheltered = contribution.inArtificialShadow || this.isUnderCover(p.motion.position);
      const exposure = stepExposure({ heat: p.heat, cold: p.cold }, zone, dt, {
        sheltered,
        light: p.light,
      });
      p.heat = exposure.heat;
      p.cold = exposure.cold;
      p.temperatureC = exposure.temperatureC;
      if (exposure.damage > 0) {
        this.damagePlayer(p, exposure.damage, null, exposure.source === 'heat' ? 'heat' : 'cold', 'ability', false);
      }
      if (zone === 'bright') p.stats.timeInSunS += dt;
      else if (zone === 'dark') p.stats.timeInDarkS += dt;

      // 4) اللومِن الشخصي
      const regen = lumenRegenPerSecond(p.light) * dt;
      if (regen > 0) {
        const before = p.lumen;
        p.lumen = Math.min(LU.personalMax, p.lumen + regen);
        p.stats.lumenGenerated += p.lumen - before;
      }

      // 5) تجديد الدرع والصحة
      if (this.timeSec - p.lastShieldDamageAt > P.shieldRegenDelaySec && p.shield < p.maxShield) {
        p.shield = Math.min(p.maxShield, p.shield + P.shieldRegenPerSec * dt);
      }
      if (this.timeSec - p.lastDamageAt > P.healthRegenDelaySec && p.health < p.maxHealth) {
        p.health = Math.min(p.maxHealth, p.health + P.healthRegenPerSec * dt);
      }

      // 6) شحن القدرة الخارقة مع الزمن
      this.addUltimate(p, ULT.chargePerSecond * dt);

      // 7) انتهاء المؤثرات المؤقتة
      if (p.cloakedUntil > 0 && this.timeSec >= p.cloakedUntil) p.cloakedUntil = 0;
      if (p.markedUntil > 0 && this.timeSec >= p.markedUntil) {
        p.markedUntil = 0;
        p.markedBy = null;
      }
      if (p.mirrorShieldUntil > 0 && this.timeSec >= p.mirrorShieldUntil) p.mirrorShieldUntil = 0;
      if (p.workshopUntil > 0 && this.timeSec >= p.workshopUntil) p.workshopUntil = 0;
      if (p.dashUntil > 0 && this.timeSec >= p.dashUntil) p.dashUntil = 0;

      // 8) إعادة التعبئة المنتهية
      if (p.weapon.reloadEndsAt > 0 && this.timeSec >= p.weapon.reloadEndsAt) this.finishReload(p);

      // 9) ورشة المهندس الميدانية
      if (p.workshopUntil > this.timeSec) this.tickWorkshop(p, dt);

      // 10) الكشف بالمرايا
      if (contribution.inMirrorPocket && p.cloakedUntil > this.timeSec) {
        p.cloakedUntil = 0;
        this.push({ type: 'reveal', byPlayerId: '', targetId: p.id });
      }

      // نظافة قائمة من ألحق الضرر
      for (const [id, entry] of p.recentDamagers) {
        if (this.timeSec - entry.at > 8) p.recentDamagers.delete(id);
      }

      void duskX;
    }
  }

  private applyInput(p: SimPlayer, cmd: InputCommand): void {
    if (this.timeSec < p.knockdownUntil) {
      // مصدوم: لا حركة إرادية
      cmd = { ...cmd, moveX: 0, moveZ: 0, buttons: cmd.buttons & ~InputButton.Jump };
    }
    const cls = classBalance(p.classKey);
    let speedMultiplier = p.speedMultiplier;
    if (p.cloakedUntil > this.timeSec && p.classKey === 'nightstalker') {
      speedMultiplier *= balance.classes.nightstalker.abilities.q.moveSpeedBonus;
    }
    const result = stepCharacter(
      p.motion,
      cmd,
      { baseSpeed: cls.speed, speedMultiplier, canSprint: true, canJump: this.timeSec >= p.knockdownUntil },
      this.world,
    );

    // اندفاع الحارس يتجاوز الحركة العادية
    if (p.dashUntil > this.timeSec) {
      const dash = balance.classes.guardian.abilities.e;
      const speed = dash.distance / dash.durationSec;
      p.motion.velocity.x = p.dashDir.x * speed;
      p.motion.velocity.z = p.dashDir.z * speed;
      this.resolveDashImpacts(p);
    }

    if (result.landingSpeed > 0) {
      const dmg = fallDamage(result.landingSpeed);
      if (dmg > 0) this.damagePlayer(p, dmg, null, 'fall', 'ability', false);
    }

    if ((cmd.buttons & InputButton.Reload) !== 0) this.requestReload(p.id);
  }

  private respawn(p: SimPlayer): void {
    const cls = classBalance(p.classKey);
    const index = [...this.players.values()].filter((o) => o.team === p.team).indexOf(p);
    const spawn = teamSpawnPoint(p.team, Math.max(0, index) + this.tick % 5, duskLineX(this.timeSec));
    p.motion = emptyMotion(spawn);
    p.motion.yaw = p.team === 0 ? 0 : Math.PI;
    p.health = cls.health;
    p.shield = cls.shield;
    p.alive = true;
    p.heat = 0;
    p.cold = 0;
    p.grenades = P.grenadesPerLife;
    p.cloakedUntil = 0;
    p.markedUntil = 0;
    p.mirrorShieldUntil = 0;
    p.recentDamagers.clear();
    const ammo = startingAmmo(p.weapon.key);
    p.weapon.magazine = ammo.magazine;
    p.weapon.reserve = ammo.reserve;
    p.weapon.reloadEndsAt = 0;
    p.weapon.nextFireAt = 0;
    this.push({ type: 'respawn', playerId: p.id, position: spawn });
  }

  private isUnderCover(position: Vec3): boolean {
    // يكفي وجود سقف فوق اللاعب لاعتباره في الظل
    const up = { x: 0, y: 1, z: 0 };
    const eye = { x: position.x, y: position.y + P.eyeHeight, z: position.z };
    for (const box of this.world.query(position.x, position.z, 3)) {
      if (!box.solid) continue;
      if (rayObb(eye, up, box, 40) >= 0) return true;
    }
    return false;
  }

  // ───────────────────────────── الإطلاق / shooting ──────────────────────────

  requestReload(playerId: string): void {
    const p = this.players.get(playerId);
    if (!p || !p.alive) return;
    const magSize = magazineSize(p.weapon.key);
    if (magSize === 0) return;
    if (p.weapon.reloadEndsAt > 0) return;
    if (p.weapon.magazine >= magSize || p.weapon.reserve <= 0) return;
    p.weapon.reloadEndsAt = this.timeSec + reloadSeconds(p.weapon.key);
  }

  private finishReload(p: SimPlayer): void {
    const magSize = magazineSize(p.weapon.key);
    const need = magSize - p.weapon.magazine;
    const take = Math.min(need, p.weapon.reserve);
    p.weapon.magazine += take;
    p.weapon.reserve -= take;
    p.weapon.reloadEndsAt = 0;
  }

  /**
   * طلب إطلاق من العميل. يُتحقق منه بالكامل على الخادم.
   * Server-validated shot: ammo/lumen/fire-rate gate, origin sanity, lag compensation.
   */
  requestFire(playerId: string, req: FireRequest): { accepted: boolean; reason: string } {
    const p = this.players.get(playerId);
    if (!p || !p.alive || this.phase !== 'live') return { accepted: false, reason: 'not_alive' };

    const zone = p.zone;
    const gate = canFire({
      weapon: p.weapon.key,
      nowSec: this.timeSec,
      nextFireAt: p.weapon.nextFireAt,
      magazine: p.weapon.magazine,
      lumen: p.lumen,
      reloading: p.weapon.reloadEndsAt > 0,
      zone,
      solarChargeMultiplier: solarChargeMultiplier(zone, p.light),
    });
    if (!gate.allowed) return { accepted: false, reason: gate.reason };

    // الأسلحة الشمسية لا تعمل بلا شحن في العتمة
    if (isSolar(p.weapon.key) && solarChargeMultiplier(zone, p.light) <= 0 && p.lumen < lumenCost(p.weapon.key)) {
      return { accepted: false, reason: 'no_solar_charge' };
    }

    // تحقق من صحة نقطة الانطلاق مقارنة بموضع اللاعب لدى الخادم
    const eye = this.eyePosition(p);
    if (distance3(eye, req.origin) > 2.5) {
      return { accepted: false, reason: 'origin_mismatch' };
    }

    const dir = this.normalize(req.direction);
    p.weapon.nextFireAt = this.timeSec + shotInterval(p.weapon.key);

    if (isSolar(p.weapon.key)) p.lumen -= lumenCost(p.weapon.key);
    else if (magazineSize(p.weapon.key) > 0) p.weapon.magazine -= 1;

    // كسر التخفي عند الإطلاق
    if (p.cloakedUntil > this.timeSec && balance.classes.nightstalker.abilities.q.breakOnFire) {
      p.cloakedUntil = 0;
    }

    const charge = chargeRatio(p.weapon.key, req.chargeSec);
    const pellets = pelletCount(p.weapon.key);
    const rewindTime = this.rewindTimeFor(p);
    const spread = spreadRadians(p.weapon.key, true);

    this.push({ type: 'shot', playerId: p.id, weapon: p.weapon.key, origin: eye, direction: dir, charge });

    for (let i = 0; i < pellets; i++) {
      const pelletDir = pellets > 1 || spread > 0 ? this.jitter(dir, spread, p.id + i + this.tick) : dir;
      this.resolveHitscan(p, eye, pelletDir, charge, rewindTime);
    }
    return { accepted: true, reason: 'ok' };
  }

  private resolveHitscan(shooter: SimPlayer, origin: Vec3, dir: Vec3, charge: number, rewindTime: number): void {
    const range = weaponRange(shooter.weapon.key);
    const target = this.castRay(origin, dir, range, shooter, rewindTime);
    if (!target) return;

    if (target.kind === 'player' && target.playerId) {
      const victim = this.players.get(target.playerId);
      if (!victim) return;
      const pose = this.poseAt(victim, rewindTime);
      const region = hitRegionFor(target.point, pose, victim.motion.crouching);
      const amplify = victim.markedUntil > this.timeSec ? balance.classes.sunshot.abilities.q.damageAmplify : 1;
      let damage = resolveDamage({
        weapon: shooter.weapon.key,
        distance: target.distance,
        region,
        chargeRatio: charge,
        amplify,
      });

      // درع المرآة يعكس نصف ضرر الأسلحة الشمسية
      if (victim.mirrorShieldUntil > this.timeSec && isSolar(shooter.weapon.key)) {
        const reflected = damage * balance.classes.guardian.abilities.q.reflectFraction;
        damage -= reflected;
        this.damagePlayer(shooter, reflected, victim, 'player', 'ability', false);
      }

      const killed = this.damagePlayer(victim, damage, shooter, 'player', shooter.weapon.key, region === 'head');
      this.push({
        type: 'hit',
        attackerId: shooter.id,
        targetId: victim.id,
        damage,
        headshot: region === 'head',
        killed,
        distance: target.distance,
        weapon: shooter.weapon.key,
      });
    } else if (target.kind === 'structure' && target.structureId) {
      const damage = resolveDamage({
        weapon: shooter.weapon.key,
        distance: target.distance,
        region: 'body',
        chargeRatio: charge,
      });
      this.damageStructure(target.structureId, damage, shooter);
    } else if (target.kind === 'crawler' && target.crawlerTeam !== undefined) {
      const damage = resolveDamage({
        weapon: shooter.weapon.key,
        distance: target.distance,
        region: 'body',
        chargeRatio: charge,
      });
      this.damageCrawler(target.crawlerTeam, damage, shooter, !!target.isCore);
    }
  }

  /** الشعاع الرئيسي: عالم + لاعبون (بإرجاع زمني) + بنى + قلاع. */
  private castRay(
    origin: Vec3,
    dir: Vec3,
    maxDist: number,
    shooter: SimPlayer | null,
    rewindTime: number,
  ): RayTarget | null {
    let best: RayTarget | null = null;
    const worldHit = raycastWorld(origin, dir, maxDist, this.world);
    if (worldHit) best = { distance: worldHit.distance, kind: 'world', point: worldHit.point };
    const limit = () => (best ? best.distance : maxDist);

    for (const other of this.players.values()) {
      if (!other.alive) continue;
      if (shooter && other.id === shooter.id) continue;
      if (shooter && other.team === shooter.team) continue;
      const pose = this.poseAt(other, rewindTime);
      const height = other.motion.crouching ? P.crouchEyeHeight + 0.2 : P.height;
      // كرتان: الجسم والرأس
      const body = { x: pose.x, y: pose.y + height * 0.5, z: pose.z };
      const head = { x: pose.x, y: pose.y + height * 0.9, z: pose.z };
      const tBody = raySphere(origin, dir, body, P.radius + height * 0.22, limit());
      const tHead = raySphere(origin, dir, head, P.radius * 0.72, limit());
      const t = tHead >= 0 && (tBody < 0 || tHead < tBody) ? tHead : tBody;
      if (t >= 0 && t < limit()) {
        best = {
          distance: t,
          kind: 'player',
          playerId: other.id,
          point: { x: origin.x + dir.x * t, y: origin.y + dir.y * t, z: origin.z + dir.z * t },
        };
      }
    }

    for (const s of this.structures.values()) {
      if (s.health <= 0) continue;
      if (shooter && s.team === shooter.team && s.kind !== 'decoy') continue;
      const box = this.structureBox(s);
      const t = rayObb(origin, dir, box, limit());
      if (t >= 0 && t < limit()) {
        best = {
          distance: t,
          kind: 'structure',
          structureId: s.id,
          point: { x: origin.x + dir.x * t, y: origin.y + dir.y * t, z: origin.z + dir.z * t },
        };
      }
    }

    if (this.mode === 'crawl') {
      for (const crawler of this.crawlers) {
        if (shooter && crawler.team === shooter.team) continue;
        const hull = this.crawlerBox(crawler);
        const t = rayObb(origin, dir, hull, limit());
        if (t >= 0 && t < limit()) {
          const point = { x: origin.x + dir.x * t, y: origin.y + dir.y * t, z: origin.z + dir.z * t };
          best = { distance: t, kind: 'crawler', crawlerTeam: crawler.team, point, isCore: false };
        }
        const coreCenter = this.corePosition(crawler);
        const tc = raySphere(origin, dir, coreCenter, C.core.radius, limit());
        if (tc >= 0 && tc < limit()) {
          best = {
            distance: tc,
            kind: 'crawler',
            crawlerTeam: crawler.team,
            point: { x: origin.x + dir.x * tc, y: origin.y + dir.y * tc, z: origin.z + dir.z * tc },
            isCore: true,
          };
        }
      }
    }

    return best;
  }

  private jitter(dir: Vec3, spread: number, saltSource: string | number): Vec3 {
    if (spread <= 0) return dir;
    const salt = typeof saltSource === 'string' ? hashString(saltSource) : saltSource;
    const rng = new Rng(salt ^ this.tick);
    const angle = rng.next() * Math.PI * 2;
    const radius = Math.sqrt(rng.next()) * spread;
    // بناء قاعدة متعامدة حول الاتجاه
    const up = Math.abs(dir.y) > 0.9 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 };
    const rx = up.y * dir.z - up.z * dir.y;
    const ry = up.z * dir.x - up.x * dir.z;
    const rz = up.x * dir.y - up.y * dir.x;
    const rl = Math.hypot(rx, ry, rz) || 1;
    const right = { x: rx / rl, y: ry / rl, z: rz / rl };
    const ux = dir.y * right.z - dir.z * right.y;
    const uy = dir.z * right.x - dir.x * right.z;
    const uz = dir.x * right.y - dir.y * right.x;
    const ox = Math.cos(angle) * radius;
    const oy = Math.sin(angle) * radius;
    return this.normalize({
      x: dir.x + right.x * ox + ux * oy,
      y: dir.y + right.y * ox + uy * oy,
      z: dir.z + right.z * ox + uz * oy,
    });
  }

  private normalize(v: Vec3): Vec3 {
    const len = Math.hypot(v.x, v.y, v.z);
    if (len < 1e-6) return { x: 0, y: 0, z: -1 };
    return { x: v.x / len, y: v.y / len, z: v.z / len };
  }

  eyePosition(p: SimPlayer): Vec3 {
    const h = p.motion.crouching ? P.crouchEyeHeight : P.eyeHeight;
    return { x: p.motion.position.x, y: p.motion.position.y + h, z: p.motion.position.z };
  }

  // ───────────────────── تعويض التأخير / lag compensation ────────────────────

  private recordHistory(): void {
    const cutoff = this.timeSec - NET.snapshotHistoryMs / 1000;
    for (const p of this.players.values()) {
      p.history.push({
        t: this.timeSec,
        x: p.motion.position.x,
        y: p.motion.position.y,
        z: p.motion.position.z,
        crouching: p.motion.crouching,
        alive: p.alive,
      });
      while (p.history.length > 2 && p.history[0]!.t < cutoff) p.history.shift();
    }
  }

  private rewindTimeFor(shooter: SimPlayer): number {
    const maxRewind = NET.lagCompensationMaxMs / 1000;
    const rewind = clamp(shooter.latencyMs / 1000 + NET.interpolationDelayMs / 1000, 0, maxRewind);
    return this.timeSec - rewind;
  }

  /** موضع لاعب في لحظة سابقة / interpolated historical pose. */
  private poseAt(p: SimPlayer, t: number): Vec3 {
    if (p.history.length === 0 || t >= this.timeSec) return { ...p.motion.position };
    for (let i = p.history.length - 1; i > 0; i--) {
      const a = p.history[i - 1]!;
      const b = p.history[i]!;
      if (t >= a.t && t <= b.t) {
        const span = b.t - a.t;
        const k = span > 1e-6 ? (t - a.t) / span : 0;
        return { x: lerp(a.x, b.x, k), y: lerp(a.y, b.y, k), z: lerp(a.z, b.z, k) };
      }
    }
    const oldest = p.history[0]!;
    return { x: oldest.x, y: oldest.y, z: oldest.z };
  }

  // ───────────────────────────── الضرر / damage ──────────────────────────────

  /** يطبّق الضرر ويعيد true إن قُتل الهدف. */
  damagePlayer(
    victim: SimPlayer,
    amount: number,
    attacker: SimPlayer | null,
    source: 'player' | 'heat' | 'cold' | 'fall' | 'explosion' | 'crawler',
    weapon: WeaponKey | 'ability' | 'explosion',
    headshot: boolean,
  ): boolean {
    if (!victim.alive || amount <= 0) return false;
    if (this.phase !== 'live') return false;

    const result = applyDamage(victim.health, victim.shield, amount);
    victim.health = result.health;
    victim.shield = result.shield;
    victim.lastDamageAt = this.timeSec;
    if (result.absorbed > 0) victim.lastShieldDamageAt = this.timeSec;

    const fromYaw = attacker
      ? Math.atan2(attacker.motion.position.x - victim.motion.position.x, attacker.motion.position.z - victim.motion.position.z)
      : 0;
    this.push({ type: 'damaged', targetId: victim.id, amount, fromYaw, source, attackerId: attacker?.id });

    if (attacker && attacker.id !== victim.id) {
      attacker.stats.damageDealt += amount;
      this.addUltimate(attacker, amount * ULT.chargePerDamage);
      const prev = victim.recentDamagers.get(attacker.id);
      victim.recentDamagers.set(attacker.id, {
        at: this.timeSec,
        amount: (prev?.amount ?? 0) + amount,
      });
      if (headshot) attacker.stats.headshots += 1;
    }

    if (victim.health <= 0) {
      this.killPlayer(victim, attacker, weapon === 'explosion' ? 'ability' : weapon, headshot, source);
      return true;
    }
    return false;
  }

  private killPlayer(
    victim: SimPlayer,
    killer: SimPlayer | null,
    weapon: WeaponKey | 'ability',
    headshot: boolean,
    source: string,
  ): void {
    victim.alive = false;
    victim.health = 0;
    victim.shield = 0;
    victim.cloakedUntil = 0;
    victim.respawnAt = this.timeSec + this.respawnSec;
    victim.stats.deaths += 1;
    victim.inputQueue.length = 0;

    const assistIds: string[] = [];
    for (const [id, entry] of victim.recentDamagers) {
      if (killer && id === killer.id) continue;
      if (this.timeSec - entry.at > 8) continue;
      const helper = this.players.get(id);
      if (!helper || helper.team === victim.team) continue;
      helper.stats.assists += 1;
      this.addUltimate(helper, ULT.chargePerAssist);
      this.teamLumen[helper.team] = Math.min(LU.teamMax, this.teamLumen[helper.team] + LU.assistReward);
      assistIds.push(id);
    }

    if (killer && killer.team !== victim.team) {
      killer.stats.kills += 1;
      this.addUltimate(killer, ULT.chargePerKill);
      this.teamLumen[killer.team] = Math.min(LU.teamMax, this.teamLumen[killer.team] + LU.killReward);
      this.teamScore[killer.team] += 1;
    } else if (killer && killer.team === victim.team) {
      killer.stats.kills -= 1;
    }

    this.push({
      type: 'kill',
      killerId: killer?.id ?? null,
      victimId: victim.id,
      weapon: source === 'heat' || source === 'cold' || source === 'fall' ? 'environment' : weapon,
      headshot,
      assistIds,
    });
    victim.recentDamagers.clear();
  }

  private addUltimate(p: SimPlayer, amount: number): void {
    if (p.ultimateCharge >= ULT.chargeTarget) return;
    p.ultimateCharge = Math.min(ULT.chargeTarget, p.ultimateCharge + amount);
    if (p.ultimateCharge >= ULT.chargeTarget) this.push({ type: 'ultimate_ready', playerId: p.id });
  }

  // ───────────────────────────── القدرات / abilities ─────────────────────────

  requestAbility(playerId: string, req: AbilityRequest): { accepted: boolean; reason: string } {
    const p = this.players.get(playerId);
    if (!p || !p.alive || this.phase !== 'live') return { accepted: false, reason: 'not_alive' };
    const slot = req.slot;
    const ability = p.abilities[slot];
    const cls = classBalance(p.classKey);
    const def = cls.abilities[slot] as Record<string, number | string | boolean>;

    if (slot === 'f') {
      if (p.ultimateCharge < ULT.chargeTarget) return { accepted: false, reason: 'not_charged' };
    } else if (this.timeSec < ability.readyAt) {
      return { accepted: false, reason: 'cooldown' };
    }

    const cost = typeof def.lumenCost === 'number' ? def.lumenCost : 0;
    if (cost > 0 && p.lumen < cost) return { accepted: false, reason: 'no_lumen' };

    const aim = this.normalize(req.aim);
    const ok = this.executeAbility(p, slot, aim, req.yaw);
    if (!ok) return { accepted: false, reason: 'blocked' };

    if (cost > 0) p.lumen -= cost;
    if (slot === 'f') p.ultimateCharge = 0;
    else ability.readyAt = this.timeSec + (typeof def.cooldownSec === 'number' ? def.cooldownSec : 0);
    const durationSec = typeof def.durationSec === 'number' ? def.durationSec : 0;
    ability.activeUntil = this.timeSec + durationSec;

    this.push({ type: 'ability_used', playerId: p.id, classKey: p.classKey, slot });
    return { accepted: true, reason: 'ok' };
  }

  private executeAbility(p: SimPlayer, slot: AbilitySlot, aim: Vec3, yaw: number): boolean {
    const eye = this.eyePosition(p);
    switch (p.classKey) {
      case 'guardian':
        if (slot === 'q') {
          p.mirrorShieldUntil = this.timeSec + balance.classes.guardian.abilities.q.durationSec;
          return true;
        }
        if (slot === 'e') {
          const dash = balance.classes.guardian.abilities.e;
          p.dashUntil = this.timeSec + dash.durationSec;
          p.dashDir = this.normalize({ x: aim.x, y: 0, z: aim.z });
          return true;
        }
        return this.placeDawnWall(p, yaw);
      case 'sunshot':
        if (slot === 'q') return this.thermalMark(p, eye, aim);
        if (slot === 'e') {
          const leap = balance.classes.sunshot.abilities.e;
          p.motion.velocity.x += aim.x * leap.impulse;
          p.motion.velocity.y = Math.max(p.motion.velocity.y, 0) + Math.abs(aim.y) * leap.impulse * 0.5 + leap.impulse * 0.45;
          p.motion.velocity.z += aim.z * leap.impulse;
          p.motion.grounded = false;
          return true;
        }
        return this.scheduleNoonStrike(p, eye, aim);
      case 'nightstalker':
        if (slot === 'q') {
          const cloak = balance.classes.nightstalker.abilities.q;
          const dur = p.zone === 'dark' ? cloak.durationSec * cloak.darkDurationMultiplier : cloak.durationSec;
          p.cloakedUntil = this.timeSec + dur;
          return true;
        }
        if (slot === 'e') return this.throwDousing(p, eye, aim);
        return this.spawnDecoy(p);
      case 'engineer':
        if (slot === 'q') return this.placeStructure(p, 'mirror', eye, aim, yaw);
        if (slot === 'e') return this.placeStructure(p, 'shadow_tower', eye, aim, yaw);
        p.workshopUntil = this.timeSec + balance.classes.engineer.abilities.f.durationSec;
        return true;
      default:
        return false;
    }
  }

  private resolveDashImpacts(p: SimPlayer): void {
    const dash = balance.classes.guardian.abilities.e;
    for (const other of this.players.values()) {
      if (other.team === p.team || !other.alive) continue;
      if (distance3(p.motion.position, other.motion.position) > P.radius * 3) continue;
      if (p.botMemory[`dashHit_${other.id}`] === Math.floor(p.dashUntil * 100)) continue;
      p.botMemory[`dashHit_${other.id}`] = Math.floor(p.dashUntil * 100);
      other.knockdownUntil = this.timeSec + dash.knockdownSec;
      this.damagePlayer(other, dash.impactDamage, p, 'player', 'ability', false);
    }
  }

  private thermalMark(p: SimPlayer, eye: Vec3, aim: Vec3): boolean {
    const mark = balance.classes.sunshot.abilities.q;
    const target = this.castRay(eye, aim, mark.range, p, this.timeSec);
    if (!target || target.kind !== 'player' || !target.playerId) return false;
    const victim = this.players.get(target.playerId);
    if (!victim) return false;
    victim.markedUntil = this.timeSec + mark.durationSec;
    victim.markedBy = p.id;
    victim.cloakedUntil = 0;
    this.push({ type: 'reveal', byPlayerId: p.id, targetId: victim.id });
    return true;
  }

  private scheduleNoonStrike(p: SimPlayer, eye: Vec3, aim: Vec3): boolean {
    const strike = balance.classes.sunshot.abilities.f;
    const hit = this.castRay(eye, aim, weaponRange('beam_rifle') * 1.6, p, this.timeSec);
    const point = hit ? hit.point : { x: eye.x + aim.x * 100, y: eye.y + aim.y * 100, z: eye.z + aim.z * 100 };
    this.strikes.push({
      id: this.nextId('strike'),
      ownerId: p.id,
      team: p.team,
      position: { x: point.x, y: terrainHeight(point.x, point.z), z: point.z },
      at: this.timeSec + strike.delaySec,
      radius: strike.radius,
      damage: strike.damage,
    });
    this.push({ type: 'announce', key: 'announce.noon_strike_incoming', severity: 'warning' });
    return true;
  }

  private throwDousing(p: SimPlayer, eye: Vec3, aim: Vec3): boolean {
    const dous = balance.classes.nightstalker.abilities.e;
    const hit = this.castRay(eye, aim, 60, p, this.timeSec);
    const point = hit ? hit.point : { x: eye.x + aim.x * 40, y: eye.y + aim.y * 40, z: eye.z + aim.z * 40 };
    const ground = { x: point.x, y: terrainHeight(point.x, point.z), z: point.z };
    const structure: StructureState = {
      id: this.nextId('dous'),
      kind: 'shadow_tower',
      ownerId: p.id,
      team: p.team,
      position: ground,
      yaw: 0,
      health: 1,
      maxHealth: 1,
      expiresAt: this.timeSec + dous.durationSec,
      radius: dous.radius,
      meta: { temporary: 1 },
    };
    this.structures.set(structure.id, structure);
    this.push({ type: 'structure_placed', structure });
    return true;
  }

  private spawnDecoy(p: SimPlayer): boolean {
    const twin = balance.classes.nightstalker.abilities.f;
    const forward = directionFromAngles(p.motion.yaw, 0);
    const structure: StructureState = {
      id: this.nextId('decoy'),
      kind: 'decoy',
      ownerId: p.id,
      team: p.team,
      position: { ...p.motion.position },
      yaw: p.motion.yaw,
      health: twin.decoyHealth,
      maxHealth: twin.decoyHealth,
      expiresAt: this.timeSec + twin.durationSec,
      meta: { vx: forward.x * twin.decoySpeed, vz: forward.z * twin.decoySpeed },
    };
    this.structures.set(structure.id, structure);
    this.push({ type: 'structure_placed', structure });
    p.cloakedUntil = this.timeSec + twin.durationSec * 0.4;
    return true;
  }

  private placeDawnWall(p: SimPlayer, yaw: number): boolean {
    const wall = balance.classes.guardian.abilities.f;
    const forward = directionFromAngles(yaw, 0);
    const x = p.motion.position.x + forward.x * 3.2;
    const z = p.motion.position.z + forward.z * 3.2;
    const structure: StructureState = {
      id: this.nextId('wall'),
      kind: 'dawn_wall',
      ownerId: p.id,
      team: p.team,
      position: { x, y: terrainHeight(x, z), z },
      yaw,
      health: Number.POSITIVE_INFINITY,
      maxHealth: Number.POSITIVE_INFINITY,
      expiresAt: this.timeSec + wall.durationSec,
      radius: wall.length / 2,
    };
    this.structures.set(structure.id, structure);
    this.refreshDynamicObstacles();
    this.push({ type: 'structure_placed', structure });
    return true;
  }

  private placeStructure(
    p: SimPlayer,
    kind: 'mirror' | 'shadow_tower',
    eye: Vec3,
    aim: Vec3,
    yaw: number,
  ): boolean {
    const def =
      kind === 'mirror' ? balance.classes.engineer.abilities.q : balance.classes.engineer.abilities.e;
    const owned = [...this.structures.values()].filter((s) => s.ownerId === p.id && s.kind === kind);
    if (owned.length >= def.maxActive) {
      const oldest = owned.reduce((a, b) => (a.expiresAt < b.expiresAt ? a : b));
      this.destroyStructure(oldest.id);
    }
    const hit = this.castRay(eye, aim, P.interactRange * 3, p, this.timeSec);
    const point = hit ? hit.point : { x: eye.x + aim.x * 6, y: eye.y + aim.y * 6, z: eye.z + aim.z * 6 };
    const clamped = clampToMap(point.x, point.z);
    const structure: StructureState = {
      id: this.nextId(kind),
      kind,
      ownerId: p.id,
      team: p.team,
      position: { x: clamped.x, y: terrainHeight(clamped.x, clamped.z), z: clamped.z },
      yaw,
      health: def.structureHealth,
      maxHealth: def.structureHealth,
      expiresAt: this.timeSec + def.lifetimeSec,
    };
    this.structures.set(structure.id, structure);
    if (kind === 'mirror') p.stats.mirrorsPlaced += 1;
    this.refreshDynamicObstacles();
    this.push({ type: 'structure_placed', structure });
    return true;
  }

  private tickWorkshop(p: SimPlayer, dt: number): void {
    const shop = balance.classes.engineer.abilities.f;
    const crawler = this.crawlers[p.team];
    if (this.mode === 'crawl' && distance3(p.motion.position, crawler.position) < C.halfLength + shop.radius) {
      crawler.integrity = Math.min(C.integrityMax, crawler.integrity + shop.crawlerRepairPercentPerSec * dt);
    }
    for (const ally of this.players.values()) {
      if (ally.team !== p.team || !ally.alive) continue;
      if (distance3(ally.motion.position, p.motion.position) > shop.radius) continue;
      ally.health = Math.min(ally.maxHealth, ally.health + shop.allyHealPerSec * dt);
    }
  }

  // ───────────────────────────── القنابل / grenades ──────────────────────────

  throwGrenade(playerId: string, direction: Vec3): boolean {
    const p = this.players.get(playerId);
    if (!p || !p.alive || p.grenades <= 0 || this.phase !== 'live') return false;
    const g = balance.weapons.frag_grenade;
    p.grenades -= 1;
    const eye = this.eyePosition(p);
    const dir = this.normalize(direction);
    this.grenades.push({
      id: this.nextId('nade'),
      ownerId: p.id,
      team: p.team,
      position: { ...eye },
      velocity: { x: dir.x * g.throwSpeed, y: dir.y * g.throwSpeed + 2.5, z: dir.z * g.throwSpeed },
      detonateAt: this.timeSec + g.fuseSec,
    });
    return true;
  }

  private updateGrenades(dt: number): void {
    const g = balance.weapons.frag_grenade;
    for (let i = this.grenades.length - 1; i >= 0; i--) {
      const nade = this.grenades[i]!;
      stepProjectile(nade.position, nade.velocity, dt, this.world, g.bounce);
      if (this.timeSec >= nade.detonateAt) {
        this.detonate(nade.position, g.radius, nade.ownerId, nade.team);
        this.grenades.splice(i, 1);
      }
    }
  }

  private updateStrikes(): void {
    for (let i = this.strikes.length - 1; i >= 0; i--) {
      const s = this.strikes[i]!;
      if (this.timeSec < s.at) continue;
      this.detonate(s.position, s.radius, s.ownerId, s.team, s.damage);
      this.strikes.splice(i, 1);
    }
  }

  private detonate(position: Vec3, radius: number, ownerId: string, team: TeamId, fixedDamage?: number): void {
    const owner = this.players.get(ownerId) ?? null;
    this.push({ type: 'explosion', position: { ...position }, radius, ownerId });
    for (const victim of this.players.values()) {
      if (!victim.alive) continue;
      const center = { x: victim.motion.position.x, y: victim.motion.position.y + P.height * 0.5, z: victim.motion.position.z };
      const d = distance3(center, position);
      if (d > radius) continue;
      const damage = fixedDamage !== undefined ? fixedDamage * (1 - clamp01(d / radius) * 0.6) : explosionDamage(d);
      if (damage <= 0) continue;
      const friendly = victim.team === team && victim.id !== ownerId;
      this.damagePlayer(victim, friendly ? damage * 0.25 : damage, owner, 'explosion', 'explosion', false);
    }
    for (const s of [...this.structures.values()]) {
      if (s.team === team) continue;
      if (distance3(s.position, position) > radius) continue;
      this.damageStructure(s.id, fixedDamage ?? explosionDamage(distance3(s.position, position)), owner);
    }
    if (this.mode === 'crawl') {
      for (const crawler of this.crawlers) {
        if (crawler.team === team) continue;
        if (distance3(crawler.position, position) > radius + C.halfLength) continue;
        this.damageCrawler(crawler.team, (fixedDamage ?? explosionDamage(0)) * 0.5, owner, false);
      }
    }
  }

  // ───────────────────────────── البنى / structures ──────────────────────────

  private updateStructures(dt: number): void {
    let dirty = false;
    for (const s of [...this.structures.values()]) {
      if (s.expiresAt > 0 && this.timeSec >= s.expiresAt) {
        this.destroyStructure(s.id);
        dirty = true;
        continue;
      }
      if (s.kind === 'decoy' && s.meta) {
        const vx = s.meta.vx ?? 0;
        const vz = s.meta.vz ?? 0;
        const nx = s.position.x + vx * dt;
        const nz = s.position.z + vz * dt;
        const c = clampToMap(nx, nz);
        s.position.x = c.x;
        s.position.z = c.z;
        s.position.y = terrainHeight(c.x, c.z);
      }
    }
    if (dirty) this.refreshDynamicObstacles();
  }

  damageStructure(structureId: string, amount: number, attacker: SimPlayer | null): void {
    const s = this.structures.get(structureId);
    if (!s || !Number.isFinite(s.health)) return;
    s.health -= amount;
    if (attacker) attacker.stats.damageDealt += amount;
    if (s.health <= 0) this.destroyStructure(structureId);
  }

  private destroyStructure(structureId: string): void {
    const s = this.structures.get(structureId);
    if (!s) return;
    this.structures.delete(structureId);
    this.push({ type: 'structure_destroyed', structureId, kind: s.kind, position: { ...s.position } });
    this.refreshDynamicObstacles();
  }

  private structureBox(s: StructureState): BoxObstacle {
    const cfg = balance.structures;
    if (s.kind === 'mirror') {
      return {
        id: s.id,
        kind: 'pillar',
        center: { x: s.position.x, y: s.position.y + cfg.mirror.height / 2, z: s.position.z },
        half: { x: cfg.mirror.radius, y: cfg.mirror.height / 2, z: 0.25 },
        yaw: s.yaw,
        solid: true,
      };
    }
    if (s.kind === 'shadow_tower') {
      return {
        id: s.id,
        kind: 'pillar',
        center: { x: s.position.x, y: s.position.y + cfg.shadow_tower.height / 2, z: s.position.z },
        half: { x: cfg.shadow_tower.radius, y: cfg.shadow_tower.height / 2, z: cfg.shadow_tower.radius },
        yaw: s.yaw,
        solid: (s.meta?.temporary ?? 0) === 0,
      };
    }
    if (s.kind === 'dawn_wall') {
      const wall = balance.classes.guardian.abilities.f;
      return {
        id: s.id,
        kind: 'wall',
        center: { x: s.position.x, y: s.position.y + wall.height / 2, z: s.position.z },
        half: { x: wall.length / 2, y: wall.height / 2, z: cfg.dawn_wall.thickness / 2 },
        yaw: s.yaw + Math.PI / 2,
        solid: wall.blocksProjectiles,
      };
    }
    return {
      id: s.id,
      kind: 'pillar',
      center: { x: s.position.x, y: s.position.y + P.height / 2, z: s.position.z },
      half: { x: P.radius, y: P.height / 2, z: P.radius },
      yaw: s.yaw,
      solid: false,
    };
  }

  private crawlerBox(crawler: CrawlerState): BoxObstacle {
    return {
      id: `crawler_${crawler.team}`,
      kind: 'wall',
      center: { x: crawler.position.x, y: crawler.position.y + C.height / 2, z: crawler.position.z },
      half: { x: C.halfLength, y: C.height / 2, z: C.halfWidth },
      yaw: 0,
      solid: true,
    };
  }

  private corePosition(crawler: CrawlerState): Vec3 {
    return { x: crawler.position.x, y: crawler.position.y + C.height * 0.55, z: crawler.position.z };
  }

  /** يعيد بناء قائمة العوائق المتحركة (قلاع + جدران + مرايا). */
  private refreshDynamicObstacles(): void {
    const dynamic: BoxObstacle[] = [];
    if (this.mode === 'crawl') for (const c of this.crawlers) dynamic.push(this.crawlerBox(c));
    for (const s of this.structures.values()) {
      const box = this.structureBox(s);
      if (box.solid) dynamic.push(box);
    }
    this.world.setDynamic(dynamic);
  }

  // ───────────────────────────── الآبار / lumen wells ────────────────────────

  private updateWells(dt: number): void {
    for (const well of this.wells) {
      const inside: SimPlayer[] = [];
      for (const p of this.players.values()) {
        if (!p.alive) continue;
        const d = Math.hypot(p.motion.position.x - well.position.x, p.motion.position.z - well.position.z);
        if (d <= W.captureRadius) inside.push(p);
      }
      const t0 = inside.filter((p) => p.team === 0).length;
      const t1 = inside.filter((p) => p.team === 1).length;

      if (t0 > 0 && t1 > 0) {
        // متنازع عليه: يتباطأ التقدّم
        well.progress = Math.max(0, well.progress - dt * W.contestSlowdown / W.captureSec);
      } else if (t0 > 0 || t1 > 0) {
        const team: TeamId = t0 > 0 ? 0 : 1;
        if (well.owner === team) {
          well.progress = 1;
          well.capturingTeam = team;
        } else {
          if (well.capturingTeam !== team) {
            well.capturingTeam = team;
            well.progress = Math.max(0, well.progress - dt / W.captureSec);
          } else {
            well.progress += dt / W.captureSec;
          }
          if (well.progress >= 1) {
            const previous = well.owner;
            well.owner = team;
            well.progress = 1;
            if (previous !== -1) this.push({ type: 'well_lost', wellId: well.id, team: previous });
            for (const p of inside) if (p.team === team) p.stats.wellsCaptured += 1;
            this.push({
              type: 'well_captured',
              wellId: well.id,
              team,
              playerIds: inside.filter((p) => p.team === team).map((p) => p.id),
            });
          }
        }
      } else if (well.owner === -1) {
        well.progress = Math.max(0, well.progress - dt * W.decayPerSec / W.captureSec);
        if (well.progress === 0) well.capturingTeam = -1;
      }

      if (well.owner !== -1) {
        this.teamLumen[well.owner] = Math.min(LU.teamMax, this.teamLumen[well.owner] + LU.wellRatePerSec * dt);
        for (const p of this.players.values()) {
          if (p.team === well.owner && p.alive) this.addUltimate(p, ULT.chargePerWellTick * dt);
        }
      }
    }
  }

  // ───────────────────────────── القلاع / crawlers ───────────────────────────

  private updateCrawlers(dt: number): void {
    const duskX = duskLineX(this.timeSec);

    for (const crawler of this.crawlers) {
      // 1) التصويت على التوجيه
      let voteSum = 0;
      let voteCount = 0;
      for (const [id, offset] of this.crawlerVotes) {
        const p = this.players.get(id);
        if (!p || p.team !== crawler.team) continue;
        voteSum += offset;
        voteCount++;
      }
      const desired = voteCount > 0 ? (voteSum / voteCount) * C.maxSteerOffset : 0;
      crawler.steerOffset += clamp(desired - crawler.steerOffset, -C.steerSpeedMps * dt * 8, C.steerSpeedMps * dt * 8);

      // 2) الحركة نحو الهدف
      const boosted = this.timeSec < crawler.boostUntil;
      const speed = C.baseSpeedMps * (boosted ? LU.spend.crawlerBoost.speedMultiplier : 1) + C.steerSpeedMps;
      const targetX = clamp(duskX + crawler.steerOffset, -MAP_HALF + C.halfLength, MAP_HALF - C.halfLength);
      const delta = clamp(targetX - crawler.position.x, -speed * dt, speed * dt);
      crawler.position.x += delta;
      crawler.position.y = terrainHeight(crawler.position.x, crawler.position.z) + 1;

      // 3) المنطقة والعقوبة
      const zone = zoneAtX(crawler.position.x, this.timeSec);
      const changed = zone !== crawler.zone;
      crawler.zone = zone;
      if (zone === 'dusk') {
        if (crawler.outsideSince >= 0) {
          crawler.outsideSince = -1;
          this.push({ type: 'crawler_zone', team: crawler.team, zone, secondsOutside: 0 });
        }
      } else {
        if (crawler.outsideSince < 0) {
          crawler.outsideSince = this.timeSec;
          this.push({
            type: 'announce',
            key: 'announce.crawler_outside',
            severity: 'warning',
            team: crawler.team,
          });
        }
        const outside = this.timeSec - crawler.outsideSince;
        if (outside > C.outsideGraceSec) {
          const before = crawler.integrity;
          crawler.integrity = Math.max(0, crawler.integrity - C.outsideDrainPerSec * dt);
          if (Math.floor(before) !== Math.floor(crawler.integrity)) {
            this.push({
              type: 'crawler_damaged',
              team: crawler.team,
              integrity: crawler.integrity,
              reason: 'exposure',
            });
          }
        }
        if (changed) {
          this.push({ type: 'crawler_zone', team: crawler.team, zone, secondsOutside: outside });
        }
      }

      // 4) منصّة الإصلاح: لاعبو الفريق داخل القلعة يتعافون
      for (const p of this.players.values()) {
        if (p.team !== crawler.team || !p.alive) continue;
        if (distance3(p.motion.position, crawler.position) > C.halfLength) continue;
        p.health = Math.min(p.maxHealth, p.health + C.repairPadHealPerSec * dt);
      }
    }

    this.refreshDynamicObstacles();
  }

  damageCrawler(team: TeamId, amount: number, attacker: SimPlayer | null, isCore: boolean): void {
    const crawler = this.crawlers[team];
    if (crawler.integrity <= 0) return;
    if (isCore) {
      const exposed = crawler.integrity <= C.core.exposedAfterIntegrity;
      let multiplier = exposed ? C.core.damageMultiplierWhenExposed : C.core.damageMultiplierWhenSealed;
      if (this.timeSec < crawler.coreShieldUntil) multiplier *= 1 - LU.spend.coreShield.absorb;
      const applied = amount * multiplier;
      crawler.coreHealth = Math.max(0, crawler.coreHealth - applied);
      if (attacker) {
        attacker.stats.crawlerDamage += applied;
        this.addUltimate(attacker, applied * ULT.chargePerDamage * 0.35);
      }
      this.push({
        type: 'core_damaged',
        team,
        coreHealth: crawler.coreHealth,
        attackerId: attacker?.id ?? '',
      });
    } else {
      const before = crawler.integrity;
      crawler.integrity = Math.max(0, crawler.integrity - amount / (C.core.health / C.integrityMax) * 0.35);
      if (attacker) attacker.stats.crawlerDamage += amount;
      if (Math.floor(before) !== Math.floor(crawler.integrity)) {
        this.push({ type: 'crawler_damaged', team, integrity: crawler.integrity, reason: 'core' });
      }
    }
  }

  // ───────────────────────────── شروط الفوز / win check ──────────────────────

  private checkWinConditions(): void {
    if (this.phase !== 'live') return;

    if (this.mode === 'shadowhunt') {
      if (this.teamScore[0] >= this.killTarget) return this.endMatch(0, 'kill_target');
      if (this.teamScore[1] >= this.killTarget) return this.endMatch(1, 'kill_target');
      if (this.timeSec >= this.durationSec) {
        if (this.teamScore[0] === this.teamScore[1]) return this.endMatch(null, 'draw');
        return this.endMatch(this.teamScore[0] > this.teamScore[1] ? 0 : 1, 'kill_target');
      }
      return;
    }

    // 1) تدمير النواة
    for (const crawler of this.crawlers) {
      if (crawler.coreHealth <= 0) return this.endMatch((1 - crawler.team) as TeamId, 'core_destroyed');
      if (crawler.integrity <= 0) return this.endMatch((1 - crawler.team) as TeamId, 'crawler_destroyed');
    }

    // 3) انتهاء الوقت: الأعلى متانة
    if (this.timeSec >= this.durationSec) {
      const a = this.crawlers[0].integrity;
      const b = this.crawlers[1].integrity;
      if (Math.abs(a - b) < 0.001) return this.endMatch(null, 'draw');
      return this.endMatch(a > b ? 0 : 1, 'integrity_lead');
    }
  }

  private endMatch(winner: TeamId | null, reason: WinReason): void {
    this.phase = 'ended';
    this.winnerTeam = winner;
    this.winReason = reason;
    this.push({ type: 'match_end', winnerTeam: winner, reason });
  }

  /** إنهاء قسري (انسحاب/إغلاق الغرفة). */
  forceEnd(winner: TeamId | null, reason: WinReason = 'forfeit'): void {
    if (this.phase === 'ended') return;
    this.endMatch(winner, reason);
  }

  // ───────────────────────────── اللقطة / snapshot ───────────────────────────

  snapshot(): MatchSnapshot {
    const players: PlayerPublicState[] = [];
    for (const p of this.players.values()) players.push(this.publicState(p));
    return {
      tick: this.tick,
      timeSec: this.timeSec,
      duskX: duskLineX(this.timeSec),
      players,
      crawlers: this.crawlers.map((c) => ({ ...c, position: { ...c.position } })),
      wells: this.wells.map((w) => ({ ...w, position: { ...w.position } })),
      structures: [...this.structures.values()].map((s) => ({ ...s, position: { ...s.position } })),
      teamLumen: [...this.teamLumen] as [number, number],
      teamScore: [...this.teamScore] as [number, number],
      phase: this.phase,
    };
  }

  publicState(p: SimPlayer): PlayerPublicState {
    return {
      id: p.id,
      userId: p.userId,
      name: p.name,
      team: p.team,
      classKey: p.classKey,
      position: { ...p.motion.position },
      velocity: { ...p.motion.velocity },
      yaw: p.motion.yaw,
      pitch: p.motion.pitch,
      grounded: p.motion.grounded,
      crouching: p.motion.crouching,
      lastSeq: p.lastAckSeq,
      health: p.health,
      maxHealth: p.maxHealth,
      shield: p.shield,
      lumen: p.lumen,
      light: p.light,
      zone: p.zone,
      heat: p.heat,
      cold: p.cold,
      cloaked: p.cloakedUntil > this.timeSec,
      marked: p.markedUntil > this.timeSec,
      alive: p.alive,
      respawnAt: p.respawnAt,
      ultimateCharge: p.ultimateCharge,
      kills: p.stats.kills,
      deaths: p.stats.deaths,
      assists: p.stats.assists,
      isBot: p.isBot,
      ping: p.latencyMs,
    };
  }

  /** قنابل حيّة لعرضها على العميل. */
  activeGrenades(): { id: string; position: Vec3; team: TeamId }[] {
    return this.grenades.map((g) => ({ id: g.id, position: { ...g.position }, team: g.team }));
  }

  activeStrikes(): { id: string; position: Vec3; at: number; radius: number }[] {
    return this.strikes.map((s) => ({ id: s.id, position: { ...s.position }, at: s.at, radius: s.radius }));
  }
}

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
