/**
 * التنبؤ المحلي والتصحيح.
 * Client-side prediction + reconciliation. The client runs the *same* shared character
 * controller the server runs, keeps every unacknowledged input, and on each authoritative
 * update rewinds to the server pose and replays the tail. Because both sides execute
 * identical code, the replay converges instead of oscillating.
 */
import {
  CollisionWorld,
  balance,
  classBalance,
  distance3,
  stepCharacter,
  type ClassKey,
  type InputCommand,
  type PlayerMotionState,
  type Vec3,
} from '@duskfront/shared';

const NET = balance.network;

export interface PredictionResult {
  /** فرق الموضع بين التنبؤ وما أقرّه الخادم */
  error: number;
  snapped: boolean;
}

export class LocalPredictor {
  readonly motion: PlayerMotionState;
  private readonly pending: InputCommand[] = [];
  private readonly world: CollisionWorld;
  private classKey: ClassKey;
  private nextSeq = 1;
  private lastError = 0;

  constructor(world: CollisionWorld, classKey: ClassKey, spawn: Vec3) {
    this.world = world;
    this.classKey = classKey;
    this.motion = {
      position: { ...spawn },
      velocity: { x: 0, y: 0, z: 0 },
      yaw: 0,
      pitch: 0,
      grounded: true,
      crouching: false,
      lastSeq: 0,
    };
  }

  setClass(classKey: ClassKey): void {
    this.classKey = classKey;
  }

  /** يعيد الحالة إلى موضع محدّد (ظهور جديد أو قفزة كبيرة). */
  teleport(position: Vec3): void {
    this.motion.position = { ...position };
    this.motion.velocity = { x: 0, y: 0, z: 0 };
    this.pending.length = 0;
  }

  get pendingCount(): number {
    return this.pending.length;
  }

  get error(): number {
    return this.lastError;
  }

  /** ينشئ أمر إدخال جديدًا، يطبّقه فورًا محليًا، ويحتفظ به للتصحيح. */
  createAndApply(command: Omit<InputCommand, 'seq'>): InputCommand {
    const full: InputCommand = { ...command, seq: this.nextSeq++ };
    this.applyLocally(full);
    this.pending.push(full);
    while (this.pending.length > NET.inputBufferSize) this.pending.shift();
    return full;
  }

  private applyLocally(command: InputCommand): void {
    const cls = classBalance(this.classKey);
    stepCharacter(
      this.motion,
      command,
      { baseSpeed: cls.speed, speedMultiplier: 1, canSprint: true, canJump: true },
      this.world,
    );
  }

  /**
   * يصحّح التنبؤ بحالة الخادم.
   * @param serverMotion موضع اللاعب لدى الخادم
   * @param acknowledgedSeq آخر أمر إدخال طبّقه الخادم
   */
  reconcile(serverMotion: { position: Vec3; velocity: Vec3; grounded: boolean }, acknowledgedSeq: number): PredictionResult {
    // أسقط الأوامر التي أقرّها الخادم
    while (this.pending.length > 0 && this.pending[0]!.seq <= acknowledgedSeq) this.pending.shift();

    const error = distance3(this.motion.position, serverMotion.position);
    this.lastError = error;

    if (error < NET.positionCorrectionThreshold) {
      return { error, snapped: false };
    }

    const snapped = error > NET.hardSnapThreshold;
    this.motion.position = { ...serverMotion.position };
    this.motion.velocity = { ...serverMotion.velocity };
    this.motion.grounded = serverMotion.grounded;

    // أعد تطبيق الأوامر التي لم يقرّها الخادم بعد
    for (const command of this.pending) this.applyLocally(command);

    return { error, snapped };
  }

  /** تنعيم بصري: يقرّب الموضع المعروض من الموضع المُصحَّح بدل القفز. */
  static smooth(displayed: Vec3, authoritative: Vec3, dt: number): Vec3 {
    const factor = Math.min(1, dt * 18);
    return {
      x: displayed.x + (authoritative.x - displayed.x) * factor,
      y: displayed.y + (authoritative.y - displayed.y) * factor,
      z: displayed.z + (authoritative.z - displayed.z) * factor,
    };
  }
}
