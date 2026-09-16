/**
 * مخطّطات zod — كل مدخل من العميل يمرّ من هنا قبل أن يلمس المنطق أو قاعدة البيانات.
 * Every client-supplied payload is validated here before touching game logic or the DB.
 */
import { z } from 'zod';
import { balance } from './balance.js';

const classKeys = Object.keys(balance.classes) as [string, ...string[]];

export const zClassKey = z.enum(classKeys);
export const zLocale = z.enum(['ar', 'en']);
export const zDifficulty = z.enum(['easy', 'normal', 'hard']);
export const zGameMode = z.enum(['crawl', 'shadowhunt', 'campaign', 'tutorial']);

export const zEmail = z.string().trim().toLowerCase().email().max(190);
export const zPassword = z
  .string()
  .min(10, 'password must be at least 10 characters')
  .max(128)
  .refine((v) => /[a-z]/i.test(v) && /\d/.test(v), 'password needs a letter and a digit');

export const zDisplayName = z
  .string()
  .trim()
  .min(3)
  .max(20)
  .regex(/^[\p{L}\p{N}_ .-]+$/u, 'display name has unsupported characters');

export const zRegisterBody = z.object({
  email: zEmail,
  password: zPassword,
  displayName: zDisplayName.optional(),
  locale: zLocale.default('ar'),
});

export const zLoginBody = z.object({
  email: zEmail,
  password: z.string().min(1).max(128),
});

export const zGuestBody = z.object({
  displayName: zDisplayName.optional(),
  locale: zLocale.default('ar'),
});

export const zUpgradeBody = z.object({
  email: zEmail,
  password: zPassword,
});

export const zRefreshBody = z.object({
  refreshToken: z.string().min(20).max(512),
});

export const zProfilePatch = z.object({
  displayName: zDisplayName.optional(),
  avatarId: z.string().max(40).optional(),
  locale: zLocale.optional(),
});

export const zGraphicsSettings = z.object({
  tier: z.enum(['low', 'medium', 'high']),
  resolutionScale: z.number().min(0.4).max(2),
  shadows: z.boolean(),
  fov: z.number().min(balance.graphics.fovMin).max(balance.graphics.fovMax),
  fpsCap: z.number().int().min(24).max(360),
  bloom: z.boolean(),
});

export const zAudioSettings = z.object({
  master: z.number().min(0).max(1),
  music: z.number().min(0).max(1),
  sfx: z.number().min(0).max(1),
});

export const zControlSettings = z.object({
  sensitivity: z.number().min(0.05).max(10),
  adsSensitivity: z.number().min(0.05).max(10),
  invertY: z.boolean(),
  gamepadSensitivity: z.number().min(0.05).max(10),
  autoFireOnAim: z.boolean(),
  aimAssist: z.boolean(),
  bindings: z.record(z.string().max(32), z.string().max(48)).default({}),
  touchLayout: z
    .record(
      z.string().max(32),
      z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1), scale: z.number().min(0.4).max(2.5) }),
    )
    .default({}),
});

export const zAccessibilitySettings = z.object({
  colorBlindMode: z.enum(['none', 'protanopia', 'deuteranopia', 'tritanopia']),
  fontScale: z.number().min(0.75).max(1.8),
  subtitles: z.boolean(),
  reducedShake: z.boolean(),
  highContrastHud: z.boolean(),
});

export const zSettingsBundle = z.object({
  graphics: zGraphicsSettings,
  audio: zAudioSettings,
  controls: zControlSettings,
  accessibility: zAccessibilitySettings,
});

export const zLoadoutConfig = z.object({
  primarySkinKey: z.string().max(60).nullable().default(null),
  emblemKey: z.string().max(60).nullable().default(null),
  bannerKey: z.string().max(60).nullable().default(null),
  emoteKeys: z.array(z.string().max(60)).max(4).default([]),
});

export const zLoadoutPut = z.object({
  slot: z.number().int().min(1).max(3),
  config: zLoadoutConfig,
});

export const zCampaignCheckpoint = z.object({
  missionIndex: z.number().int().min(0).max(balance.campaign.missionCount - 1),
  objectiveIndex: z.number().int().min(0).max(64),
  playerHealth: z.number().min(0).max(1000),
  playerLumen: z.number().min(0).max(balance.lumen.personalMax),
  position: z.object({ x: z.number(), y: z.number(), z: z.number() }),
  flags: z.record(z.string().max(48), z.boolean()).default({}),
  score: z.number().int().min(0).max(10_000_000),
});

export const zCampaignSavePut = z.object({
  missionIndex: z.number().int().min(0).max(balance.campaign.missionCount - 1),
  checkpoint: zCampaignCheckpoint,
  difficulty: zDifficulty,
  playTimeS: z.number().int().min(0).max(10_000_000),
  /**
   * رقم النسخة للقفل التفاؤلي. الصفر يعني «لم أقرأ نسخة من الخادم بعد»، وهو ما
   * يرسله العميل عند أول حفظ في خانة فارغة — رفضه يجعل إنشاء أي حفظ مستحيلًا.
   * Zero means "I have never read a server version", which is what the client sends
   * for the first save into an empty slot.
   */
  version: z.number().int().min(0),
});

export const zSlotParam = z.object({ slot: z.coerce.number().int().min(1).max(balance.campaign.saveSlots) });

export const zLeaderboardQuery = z.object({
  mode: z.enum(['crawl', 'shadowhunt']).default('crawl'),
  page: z.coerce.number().int().min(1).max(500).default(1),
  pageSize: z.coerce.number().int().min(5).max(100).default(25),
});

export const zFriendBody = z.object({ friendId: z.string().uuid() });

export const zReportBody = z.object({
  reportedId: z.string().uuid(),
  matchId: z.string().uuid().nullable().default(null),
  reason: z.enum(['cheating', 'abuse', 'griefing', 'name', 'other']),
  details: z.string().max(500).optional(),
});

export const zShopBuyParam = z.object({ itemKey: z.string().min(1).max(60) });

export const zMatchmakeBody = z.object({
  mode: zGameMode,
  classKey: zClassKey,
  difficulty: zDifficulty.default('normal'),
  /** يسمح بمباراة فردية ضد البوتات فورًا */
  soloVsBots: z.boolean().default(false),
});

/** أمر إدخال واحد قادم من العميل — يُقيَّد بحدود منطقية. */
export const zInputCommand = z.object({
  seq: z.number().int().min(0).max(2_000_000_000),
  // الحدّ الأعلى يطابق ما يقصّه العميل تمامًا؛ أي اختلاف يجعل كل إطار بطيء
  // يبدو حمولة فاسدة لدى مكافحة الغش.
  dt: z.number().min(1 / 240).max(1 / 12),
  moveX: z.number().min(-1).max(1),
  moveZ: z.number().min(-1).max(1),
  yaw: z.number().min(-Math.PI * 2).max(Math.PI * 2),
  pitch: z.number().min(-Math.PI).max(Math.PI),
  buttons: z.number().int().min(0).max(0xffff),
  clientTimeMs: z.number().min(0),
});

export const zInputBatch = z.object({
  commands: z.array(zInputCommand).min(1).max(balance.network.maxInputsPerPacket),
});

export const zFireMessage = z.object({
  seq: z.number().int().min(0),
  originX: z.number(),
  originY: z.number(),
  originZ: z.number(),
  dirX: z.number().min(-1).max(1),
  dirY: z.number().min(-1).max(1),
  dirZ: z.number().min(-1).max(1),
  chargeSec: z.number().min(0).max(5),
  clientTimeMs: z.number().min(0),
});

export const zAbilityMessage = z.object({
  slot: z.enum(['q', 'e', 'f']),
  aimX: z.number(),
  aimY: z.number(),
  aimZ: z.number(),
  yaw: z.number(),
});

export const zCrawlerVote = z.object({ offset: z.number().min(-1).max(1) });
export const zPingMessage = z.object({
  x: z.number(),
  z: z.number(),
  kind: z.enum(['attack', 'defend', 'danger', 'help', 'well']),
});
export const zTeamSpendMessage = z.object({ action: z.enum(['crawlerBoost', 'coreShield', 'crawlerRepair']) });

export type RegisterBody = z.infer<typeof zRegisterBody>;
export type LoginBody = z.infer<typeof zLoginBody>;
export type SettingsBundleInput = z.infer<typeof zSettingsBundle>;
export type CampaignSavePut = z.infer<typeof zCampaignSavePut>;
export type InputCommandInput = z.infer<typeof zInputCommand>;
export type FireMessage = z.infer<typeof zFireMessage>;
export type AbilityMessage = z.infer<typeof zAbilityMessage>;
