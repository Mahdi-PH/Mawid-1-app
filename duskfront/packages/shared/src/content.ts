/**
 * محتوى اللعبة: الكتالوج التجميلي، الإنجازات، وبركة المهام اليومية.
 * Game content — the cosmetic catalogue, the achievements and the daily-mission pool.
 * It lives in the shared package so the seeder, the in-memory store and the Prisma
 * store all read one definition, and so it ships in the production image.
 */
import type { ClassKey, TeamId } from './types.js';

/**
 * أقلّ ما يلزم لحساب عدّادات المباراة. يُعرَّف هنا لا في الخادم حتى تبقى هذه
 * الوحدة خالية من اعتماديات الخادم، فتُنسخ ضمن dist المشتركة إلى حاوية الإنتاج.
 * Declared here (not in the server) so this module stays dependency-free and ships
 * inside the shared dist that the production image copies — which is what the
 * database seeder needs at container start-up.
 */
export interface ScoredParticipant {
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
  crawlerDestroyed: boolean;
  mirrorReveals: number;
  won: boolean;
}

export interface CatalogSeed {
  key: string;
  type: 'skin' | 'emblem' | 'banner' | 'emote';
  classKey: string | null;
  priceShards: number;
  rarity: 'common' | 'rare' | 'epic' | 'legendary';
  nameKeyAr: string;
  nameKeyEn: string;
  colorPrimary: string;
  colorAccent: string;
}

/** متجر تجميلي بحت — لا شيء هنا يغيّر رقمًا في balance.json. */
export const CATALOG: CatalogSeed[] = [
  { key: 'skin_guardian_dawnplate', type: 'skin', classKey: 'guardian', priceShards: 600, rarity: 'epic', nameKeyAr: 'درع الفجر', nameKeyEn: 'Dawnplate', colorPrimary: '#ffb347', colorAccent: '#fff0c2' },
  { key: 'skin_guardian_ashwarden', type: 'skin', classKey: 'guardian', priceShards: 350, rarity: 'rare', nameKeyAr: 'حارس الرماد', nameKeyEn: 'Ash Warden', colorPrimary: '#8a6a4f', colorAccent: '#ffd782' },
  { key: 'skin_sunshot_meridian', type: 'skin', classKey: 'sunshot', priceShards: 600, rarity: 'epic', nameKeyAr: 'خط الزوال', nameKeyEn: 'Meridian', colorPrimary: '#ff8a3d', colorAccent: '#ffe6a8' },
  { key: 'skin_sunshot_solareye', type: 'skin', classKey: 'sunshot', priceShards: 350, rarity: 'rare', nameKeyAr: 'عين الشمس', nameKeyEn: 'Solar Eye', colorPrimary: '#e85d26', colorAccent: '#ffd782' },
  { key: 'skin_nightstalker_umbra', type: 'skin', classKey: 'nightstalker', priceShards: 750, rarity: 'legendary', nameKeyAr: 'ظلّ الغسق', nameKeyEn: 'Umbra', colorPrimary: '#6d28d9', colorAccent: '#38bdf8' },
  { key: 'skin_nightstalker_coldvein', type: 'skin', classKey: 'nightstalker', priceShards: 350, rarity: 'rare', nameKeyAr: 'عِرق البرد', nameKeyEn: 'Coldvein', colorPrimary: '#1e3a8a', colorAccent: '#67e8f9' },
  { key: 'skin_engineer_prism', type: 'skin', classKey: 'engineer', priceShards: 600, rarity: 'epic', nameKeyAr: 'المنشور', nameKeyEn: 'Prism', colorPrimary: '#a855f7', colorAccent: '#fde68a' },
  { key: 'skin_engineer_scrapline', type: 'skin', classKey: 'engineer', priceShards: 350, rarity: 'rare', nameKeyAr: 'خط الخردة', nameKeyEn: 'Scrapline', colorPrimary: '#64748b', colorAccent: '#fb923c' },
  { key: 'emblem_terminator', type: 'emblem', classKey: null, priceShards: 200, rarity: 'rare', nameKeyAr: 'شارة الحد الفاصل', nameKeyEn: 'Terminator Sigil', colorPrimary: '#c64bff', colorAccent: '#ffb347' },
  { key: 'emblem_first_light', type: 'emblem', classKey: null, priceShards: 150, rarity: 'common', nameKeyAr: 'أول الضوء', nameKeyEn: 'First Light', colorPrimary: '#ffd782', colorAccent: '#ff8a3d' },
  { key: 'emblem_long_night', type: 'emblem', classKey: null, priceShards: 150, rarity: 'common', nameKeyAr: 'الليل الطويل', nameKeyEn: 'Long Night', colorPrimary: '#1a1b4b', colorAccent: '#38bdf8' },
  { key: 'banner_ash_valley', type: 'banner', classKey: null, priceShards: 250, rarity: 'rare', nameKeyAr: 'وادي الرماد', nameKeyEn: 'Ash Valley', colorPrimary: '#e85d26', colorAccent: '#7c3aed' },
  { key: 'banner_crawler_line', type: 'banner', classKey: null, priceShards: 250, rarity: 'rare', nameKeyAr: 'خطّ الزحف', nameKeyEn: 'Crawler Line', colorPrimary: '#0b1026', colorAccent: '#ffc93c' },
  { key: 'banner_mirror_field', type: 'banner', classKey: null, priceShards: 400, rarity: 'epic', nameKeyAr: 'حقل المرايا', nameKeyEn: 'Mirror Field', colorPrimary: '#38bdf8', colorAccent: '#ffe6a8' },
  { key: 'emote_salute', type: 'emote', classKey: null, priceShards: 120, rarity: 'common', nameKeyAr: 'تحية', nameKeyEn: 'Salute', colorPrimary: '#ffb347', colorAccent: '#ffffff' },
  { key: 'emote_shrug', type: 'emote', classKey: null, priceShards: 120, rarity: 'common', nameKeyAr: 'هزّ كتف', nameKeyEn: 'Shrug', colorPrimary: '#a855f7', colorAccent: '#ffffff' },
  { key: 'emote_sunrise', type: 'emote', classKey: null, priceShards: 300, rarity: 'epic', nameKeyAr: 'شروق', nameKeyEn: 'Sunrise', colorPrimary: '#ff8a3d', colorAccent: '#fde68a' },
  { key: 'emote_vanish', type: 'emote', classKey: null, priceShards: 300, rarity: 'epic', nameKeyAr: 'تلاشٍ', nameKeyEn: 'Vanish', colorPrimary: '#4c1d95', colorAccent: '#67e8f9' },
];

export interface AchievementSeed {
  key: string;
  target: number;
  rewardShards: number;
  metric: string;
}

/** 20 إنجازًا — القسم 13 من المواصفات. */
export const ACHIEVEMENTS: AchievementSeed[] = [
  { key: 'ach.dawnmaker', target: 50, rewardShards: 400, metric: 'mirrorReveals' },
  { key: 'ach.child_of_night', target: 1, rewardShards: 400, metric: 'nightWin' },
  { key: 'ach.first_blood', target: 1, rewardShards: 50, metric: 'kills' },
  { key: 'ach.centurion', target: 100, rewardShards: 250, metric: 'kills' },
  { key: 'ach.executioner', target: 500, rewardShards: 600, metric: 'kills' },
  { key: 'ach.headhunter', target: 100, rewardShards: 300, metric: 'headshots' },
  { key: 'ach.field_medic', target: 100, rewardShards: 200, metric: 'assists' },
  { key: 'ach.well_runner', target: 25, rewardShards: 200, metric: 'wellsCaptured' },
  { key: 'ach.well_baron', target: 100, rewardShards: 450, metric: 'wellsCaptured' },
  { key: 'ach.siege_breaker', target: 5, rewardShards: 500, metric: 'crawlersDestroyed' },
  { key: 'ach.mirror_architect', target: 200, rewardShards: 300, metric: 'mirrorsPlaced' },
  { key: 'ach.sunwalker', target: 3600, rewardShards: 250, metric: 'timeInSunS' },
  { key: 'ach.shadow_dweller', target: 3600, rewardShards: 250, metric: 'timeInDarkS' },
  { key: 'ach.veteran', target: 50, rewardShards: 300, metric: 'matches' },
  { key: 'ach.champion', target: 25, rewardShards: 400, metric: 'wins' },
  { key: 'ach.unbroken', target: 10, rewardShards: 350, metric: 'flawlessWin' },
  { key: 'ach.lumen_engine', target: 50000, rewardShards: 300, metric: 'lumenGenerated' },
  { key: 'ach.demolition', target: 250000, rewardShards: 350, metric: 'damageDealt' },
  { key: 'ach.noon_judge', target: 1, rewardShards: 200, metric: 'sunWin' },
  { key: 'ach.long_haul', target: 200, rewardShards: 500, metric: 'matches' },
];

export interface MissionSeed {
  key: string;
  target: number;
  rewardXp: number;
  rewardShards: number;
  metric: string;
}

/** بركة المهام اليومية — تُختار منها 3 يوميًا لكل لاعب. */
export const DAILY_MISSIONS: MissionSeed[] = [
  { key: 'mis.kills_10', target: 10, rewardXp: 300, rewardShards: 40, metric: 'kills' },
  { key: 'mis.assists_8', target: 8, rewardXp: 250, rewardShards: 35, metric: 'assists' },
  { key: 'mis.wells_3', target: 3, rewardXp: 350, rewardShards: 45, metric: 'wellsCaptured' },
  { key: 'mis.mirrors_6', target: 6, rewardXp: 250, rewardShards: 35, metric: 'mirrorsPlaced' },
  { key: 'mis.reveals_5', target: 5, rewardXp: 300, rewardShards: 40, metric: 'mirrorReveals' },
  { key: 'mis.play_3', target: 3, rewardXp: 200, rewardShards: 30, metric: 'matches' },
  { key: 'mis.win_2', target: 2, rewardXp: 400, rewardShards: 60, metric: 'wins' },
  { key: 'mis.damage_4000', target: 4000, rewardXp: 300, rewardShards: 40, metric: 'damageDealt' },
  { key: 'mis.headshots_5', target: 5, rewardXp: 320, rewardShards: 45, metric: 'headshots' },
  { key: 'mis.dark_300', target: 300, rewardXp: 250, rewardShards: 35, metric: 'timeInDarkS' },
  { key: 'mis.sun_300', target: 300, rewardXp: 250, rewardShards: 35, metric: 'timeInSunS' },
  { key: 'mis.lumen_2000', target: 2000, rewardXp: 300, rewardShards: 40, metric: 'lumenGenerated' },
];

/** عدّادات مباراة واحدة لتغذية الإنجازات والمهام. */
export function metricsFromParticipant(p: ScoredParticipant): Record<string, number> {
  return {
    kills: Math.max(0, p.kills),
    deaths: p.deaths,
    assists: p.assists,
    damageDealt: Math.round(p.damageDealt),
    lumenGenerated: Math.round(p.lumenGenerated),
    mirrorsPlaced: p.mirrorsPlaced,
    mirrorReveals: p.mirrorReveals,
    wellsCaptured: p.wellsCaptured,
    timeInSunS: Math.round(p.timeInSunS),
    timeInDarkS: Math.round(p.timeInDarkS),
    headshots: 0,
    matches: 1,
    wins: p.won ? 1 : 0,
    crawlersDestroyed: p.crawlerDestroyed ? 1 : 0,
    // «ابن الليل»: فوز دون أن يطأ اللاعب منطقة السطوع
    nightWin: p.won && p.timeInSunS < 5 ? 1 : 0,
    // «حكم الظهيرة»: فوز دون دخول العتمة
    sunWin: p.won && p.timeInDarkS < 5 ? 1 : 0,
    flawlessWin: p.won && p.deaths === 0 ? 1 : 0,
  };
}

/** يختار 3 مهام يومية ثابتة لكل لاعب في يوم معيّن. */
export function pickDailyMissions(userId: string, day: string, count: number): MissionSeed[] {
  let hash = 2166136261;
  const source = `${userId}:${day}`;
  for (let i = 0; i < source.length; i++) {
    hash ^= source.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const pool = [...DAILY_MISSIONS];
  const picked: MissionSeed[] = [];
  let state = hash >>> 0;
  for (let i = 0; i < count && pool.length > 0; i++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const index = state % pool.length;
    picked.push(pool.splice(index, 1)[0]!);
  }
  return picked;
}
