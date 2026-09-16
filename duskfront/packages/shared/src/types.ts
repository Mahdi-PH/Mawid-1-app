/**
 * أنواع مشتركة بين العميل والخادم.
 * Shared domain types for client and server. No balance numbers live here.
 */

export type TeamId = 0 | 1;
export type ClassKey = 'guardian' | 'sunshot' | 'nightstalker' | 'engineer';
export type WeaponKey =
  | 'lumen_cannon'
  | 'beam_rifle'
  | 'kinetic_smg'
  | 'kinetic_dmr'
  | 'frag_grenade';
export type ZoneKey = 'bright' | 'dusk' | 'dark';
export type GameMode = 'crawl' | 'shadowhunt' | 'campaign' | 'tutorial';
export type Difficulty = 'easy' | 'normal' | 'hard';
export type GraphicsTier = 'low' | 'medium' | 'high';
export type AbilitySlot = 'q' | 'e' | 'f';
export type StructureKind = 'mirror' | 'shadow_tower' | 'dawn_wall' | 'decoy';
export type WinReason =
  | 'core_destroyed'
  | 'crawler_destroyed'
  | 'integrity_lead'
  | 'kill_target'
  | 'forfeit'
  | 'draw';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Vec2 {
  x: number;
  z: number;
}

/** أزرار المدخلات كقناع بتّي / Input buttons as a bitmask. */
export const InputButton = {
  Fire: 1 << 0,
  Aim: 1 << 1,
  Jump: 1 << 2,
  Crouch: 1 << 3,
  Sprint: 1 << 4,
  Reload: 1 << 5,
  AbilityQ: 1 << 6,
  AbilityE: 1 << 7,
  AbilityF: 1 << 8,
  Grenade: 1 << 9,
  Melee: 1 << 10,
  Interact: 1 << 11,
} as const;
export type InputButtonKey = keyof typeof InputButton;

/** أمر إدخال واحد من العميل / one client input command (sent at input rate). */
export interface InputCommand {
  /** رقم تسلسلي متزايد / monotonically increasing sequence number */
  seq: number;
  /** مدة الإطار بالثواني / frame duration in seconds */
  dt: number;
  /** محور الحركة الجانبي -1..1 */
  moveX: number;
  /** محور الحركة الأمامي -1..1 */
  moveZ: number;
  /** الدوران الأفقي بالراديان */
  yaw: number;
  /** الميل الرأسي بالراديان */
  pitch: number;
  buttons: number;
  /** زمن العميل بالميلي ثانية، يُستخدم في تعويض التأخير */
  clientTimeMs: number;
}

export interface PlayerMotionState {
  position: Vec3;
  velocity: Vec3;
  yaw: number;
  pitch: number;
  grounded: boolean;
  crouching: boolean;
  /** آخر رقم إدخال طُبِّق / last applied input sequence */
  lastSeq: number;
}

export interface WeaponRuntimeState {
  key: WeaponKey;
  magazine: number;
  reserve: number;
  reloadEndsAt: number;
  nextFireAt: number;
  chargeStartedAt: number;
}

export interface AbilityRuntimeState {
  readyAt: number;
  activeUntil: number;
  charges: number;
}

export interface StructureState {
  id: string;
  kind: StructureKind;
  ownerId: string;
  team: TeamId;
  position: Vec3;
  yaw: number;
  health: number;
  maxHealth: number;
  /** زمن المباراة بالثواني الذي تنتهي عنده البنية (0 = دائمة) */
  expiresAt: number;
  /** نصف قطر التأثير، يتجاوز القيمة الافتراضية في balance.json عند الحاجة */
  radius?: number;
  /** حقول إضافية خاصة بنوع البنية (مثل سرعة النسخة الوهمية) */
  meta?: Record<string, number>;
}

export interface WellState {
  id: number;
  position: Vec2;
  owner: TeamId | -1;
  /** 0..1 تقدّم الاستيلاء للفريق capturingTeam */
  progress: number;
  capturingTeam: TeamId | -1;
}

export interface CrawlerState {
  team: TeamId;
  position: Vec3;
  integrity: number;
  coreHealth: number;
  coreMaxHealth: number;
  coreShieldUntil: number;
  outsideSince: number;
  steerOffset: number;
  boostUntil: number;
  zone: ZoneKey;
}

export interface PlayerPublicState extends PlayerMotionState {
  id: string;
  userId: string;
  name: string;
  team: TeamId;
  classKey: ClassKey;
  health: number;
  maxHealth: number;
  shield: number;
  lumen: number;
  light: number;
  zone: ZoneKey;
  heat: number;
  cold: number;
  cloaked: boolean;
  marked: boolean;
  alive: boolean;
  respawnAt: number;
  ultimateCharge: number;
  kills: number;
  deaths: number;
  assists: number;
  isBot: boolean;
  ping: number;
}

export interface MatchSnapshot {
  tick: number;
  timeSec: number;
  duskX: number;
  players: PlayerPublicState[];
  crawlers: CrawlerState[];
  wells: WellState[];
  structures: StructureState[];
  teamLumen: [number, number];
  teamScore: [number, number];
  phase: MatchPhase;
}

export type MatchPhase = 'warmup' | 'live' | 'ended';

export interface KillFeedEntry {
  id: number;
  killerName: string;
  killerTeam: TeamId;
  victimName: string;
  victimTeam: TeamId;
  weapon: WeaponKey | 'ability' | 'environment';
  headshot: boolean;
  atSec: number;
}

export interface MatchResult {
  matchId: string;
  mode: GameMode;
  mapKey: string;
  winnerTeam: TeamId | null;
  winReason: WinReason;
  durationSec: number;
  participants: MatchParticipantResult[];
}

export interface MatchParticipantResult {
  userId: string;
  team: TeamId;
  classKey: ClassKey;
  kills: number;
  deaths: number;
  assists: number;
  damageDealt: number;
  lumenGenerated: number;
  mirrorsPlaced: number;
  wellsCaptured: number;
  timeInSunS: number;
  timeInDarkS: number;
  isBot: boolean;
}

export interface AccessibilitySettings {
  colorBlindMode: 'none' | 'protanopia' | 'deuteranopia' | 'tritanopia';
  fontScale: number;
  subtitles: boolean;
  reducedShake: boolean;
  highContrastHud: boolean;
}

export interface GraphicsSettings {
  tier: GraphicsTier;
  resolutionScale: number;
  shadows: boolean;
  fov: number;
  fpsCap: number;
  bloom: boolean;
}

export interface AudioSettings {
  master: number;
  music: number;
  sfx: number;
}

export interface ControlSettings {
  sensitivity: number;
  adsSensitivity: number;
  invertY: boolean;
  gamepadSensitivity: number;
  autoFireOnAim: boolean;
  aimAssist: boolean;
  bindings: Record<string, string>;
  touchLayout: Record<string, { x: number; y: number; scale: number }>;
}

export interface PlayerSettingsBundle {
  graphics: GraphicsSettings;
  audio: AudioSettings;
  controls: ControlSettings;
  accessibility: AccessibilitySettings;
}

export interface CampaignCheckpoint {
  missionIndex: number;
  objectiveIndex: number;
  playerHealth: number;
  playerLumen: number;
  position: Vec3;
  flags: Record<string, boolean>;
  score: number;
}

export interface CampaignSaveDto {
  slot: number;
  missionIndex: number;
  checkpoint: CampaignCheckpoint;
  difficulty: Difficulty;
  playTimeS: number;
  version: number;
  updatedAt: string;
}
