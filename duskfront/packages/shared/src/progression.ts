/**
 * التقدّم والاقتصاد — يُحسب على الخادم وحده، والعميل يعرض النتيجة فقط.
 * Progression and economy maths. The server is the only caller that persists results;
 * the client imports the same functions purely to render previews.
 */
import { balance } from './balance.js';
import { clamp } from './math.js';
import type { MatchParticipantResult, TeamId } from './types.js';

const PR = balance.progression;

/** الخبرة اللازمة للانتقال من مستوى إلى الذي يليه. */
export function xpForNextLevel(level: number): number {
  return PR.xpBase + PR.xpPerLevel * clamp(level, 1, PR.maxLevel);
}

/** المستوى والتقدّم من إجمالي الخبرة / total xp → level + progress. */
export function levelFromXp(totalXp: number): { level: number; xpIntoLevel: number; xpForNext: number } {
  let level = 1;
  let remaining = Math.max(0, Math.floor(totalXp));
  while (level < PR.maxLevel) {
    const need = xpForNextLevel(level);
    if (remaining < need) break;
    remaining -= need;
    level++;
  }
  return { level, xpIntoLevel: remaining, xpForNext: level >= PR.maxLevel ? 0 : xpForNextLevel(level) };
}

export interface MatchRewardInput {
  participant: MatchParticipantResult;
  winnerTeam: TeamId | null;
  /** نسبة متانة قلعة الفريق عند النهاية 0..100 */
  crawlerIntegrity: number;
  isFirstWinOfDay: boolean;
}

export interface MatchReward {
  xp: number;
  shards: number;
  breakdown: Record<string, number>;
}

/** مكافأة نهاية المباراة / end-of-match XP and shard award. */
export function computeMatchReward(input: MatchRewardInput): MatchReward {
  const { participant: p, winnerTeam } = input;
  const won = winnerTeam !== null && winnerTeam === p.team;
  const breakdown: Record<string, number> = {};

  breakdown.base = won ? PR.matchXp.win : PR.matchXp.loss;
  breakdown.kills = p.kills * PR.matchXp.perKill;
  breakdown.assists = p.assists * PR.matchXp.perAssist;
  breakdown.wells = p.wellsCaptured * PR.matchXp.perWellCapture;
  breakdown.crawler = Math.round((input.crawlerIntegrity / 100) * PR.matchXp.perCrawlerPercent * 10);

  const xp = Object.values(breakdown).reduce((a, b) => a + b, 0);

  let shards = won ? PR.shards.win : PR.shards.loss;
  if (won && input.isFirstWinOfDay) shards += PR.shards.firstWinOfDay;

  return { xp: Math.max(0, Math.round(xp)), shards: Math.max(0, Math.round(shards)), breakdown };
}

/** تقدّم إتقان الصنف / per-class mastery progression. */
export function masteryLevelFromXp(xp: number): number {
  const perLevel = PR.masteryXpPerMatch * 4;
  return clamp(1 + Math.floor(xp / perLevel), 1, PR.masteryLevels);
}

/** تصنيف Elo بعد مباراة / Elo update after a match. */
export function updateElo(rating: number, opponentRating: number, won: boolean, k = 24): number {
  const expected = 1 / (1 + Math.pow(10, (opponentRating - rating) / 400));
  const score = won ? 1 : 0;
  return Math.round(rating + k * (score - expected));
}

/** مفتاح اليوم بتوقيت UTC لتجديد المهام اليومية. */
export function utcDayKey(date: Date = new Date()): string {
  const shifted = new Date(date.getTime() - balance.economy.dailyResetUtcHour * 3600_000);
  return shifted.toISOString().slice(0, 10);
}
