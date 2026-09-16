/** حالة لاعب داخل المحاكاة (تشمل حقولًا لا تُرسَل للعميل). */
import type {
  AbilityRuntimeState,
  AbilitySlot,
  ClassKey,
  Difficulty,
  InputCommand,
  PlayerMotionState,
  TeamId,
  Vec3,
  WeaponKey,
  WeaponRuntimeState,
  ZoneKey,
} from '../types.js';

export interface PlayerStatAccumulator {
  kills: number;
  deaths: number;
  assists: number;
  damageDealt: number;
  lumenGenerated: number;
  mirrorsPlaced: number;
  wellsCaptured: number;
  timeInSunS: number;
  timeInDarkS: number;
  revealsByMirror: number;
  headshots: number;
  crawlerDamage: number;
}

/** لقطة موضع محفوظة لتعويض التأخير / stored pose used for lag compensation. */
export interface PoseHistoryEntry {
  t: number;
  x: number;
  y: number;
  z: number;
  crouching: boolean;
  alive: boolean;
}

export interface SimPlayer {
  id: string;
  userId: string;
  name: string;
  team: TeamId;
  classKey: ClassKey;
  isBot: boolean;
  botDifficulty: Difficulty;

  motion: PlayerMotionState;
  health: number;
  maxHealth: number;
  shield: number;
  maxShield: number;
  lumen: number;
  light: number;
  zone: ZoneKey;
  heat: number;
  cold: number;
  temperatureC: number;

  alive: boolean;
  respawnAt: number;
  ultimateCharge: number;

  weapon: WeaponRuntimeState;
  abilities: Record<AbilitySlot, AbilityRuntimeState>;
  grenades: number;

  cloakedUntil: number;
  markedUntil: number;
  markedBy: string | null;
  mirrorShieldUntil: number;
  dashUntil: number;
  dashDir: Vec3;
  knockdownUntil: number;
  speedMultiplier: number;
  workshopUntil: number;

  lastDamageAt: number;
  lastShieldDamageAt: number;
  /** من ألحق ضررًا مؤخرًا → لحساب المساعدات */
  recentDamagers: Map<string, { at: number; amount: number }>;

  inputQueue: InputCommand[];
  lastAckSeq: number;
  latencyMs: number;
  history: PoseHistoryEntry[];

  stats: PlayerStatAccumulator;
  connected: boolean;
  /** أعلام مؤقتة يستخدمها الذكاء الاصطناعي */
  botMemory: Record<string, number>;
}

export function emptyStats(): PlayerStatAccumulator {
  return {
    kills: 0,
    deaths: 0,
    assists: 0,
    damageDealt: 0,
    lumenGenerated: 0,
    mirrorsPlaced: 0,
    wellsCaptured: 0,
    timeInSunS: 0,
    timeInDarkS: 0,
    revealsByMirror: 0,
    headshots: 0,
    crawlerDamage: 0,
  };
}

export function emptyMotion(position: Vec3): PlayerMotionState {
  return {
    position: { ...position },
    velocity: { x: 0, y: 0, z: 0 },
    yaw: 0,
    pitch: 0,
    grounded: true,
    crouching: false,
    lastSeq: 0,
  };
}

export function emptyWeaponState(key: WeaponKey, magazine: number, reserve: number): WeaponRuntimeState {
  return { key, magazine, reserve, reloadEndsAt: 0, nextFireAt: 0, chargeStartedAt: 0 };
}

export function emptyAbility(): AbilityRuntimeState {
  return { readyAt: 0, activeUntil: 0, charges: 1 };
}
