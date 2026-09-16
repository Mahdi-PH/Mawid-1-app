/**
 * الوصول الوحيد المسموح به لأرقام التوازن.
 * The only sanctioned accessor for balance numbers — see packages/shared/src/balance.json.
 *
 * قاعدة المشروع: أي رقم توازن يجب أن يأتي من هنا، لا من الكود.
 * Project rule: every balance number comes from here, never inline in code.
 */
import { balanceData } from './balance.generated.js';
import type { ClassKey, Difficulty, GraphicsTier, WeaponKey, ZoneKey } from './types.js';

/** شكل ملف التوازن كما وُلِّد من balance.json */
export type BalanceFile = typeof balanceData;

export const balance: BalanceFile = balanceData;

/** إعدادات صنف / class tuning block. */
export function classBalance(key: ClassKey) {
  const c = balance.classes[key];
  if (!c) throw new Error(`[balance] unknown class "${key}"`);
  return c;
}

/** إعدادات سلاح / weapon tuning block. */
export function weaponBalance<K extends WeaponKey>(key: K): BalanceFile['weapons'][K] {
  const w = balance.weapons[key];
  if (!w) throw new Error(`[balance] unknown weapon "${key}"`);
  return w;
}

export function zoneBalance(zone: ZoneKey) {
  const z = balance.zones[zone];
  if (!z) throw new Error(`[balance] unknown zone "${zone}"`);
  return z;
}

export function botBalance(difficulty: Difficulty) {
  const b = balance.bots[difficulty];
  if (!b) throw new Error(`[balance] unknown bot difficulty "${difficulty}"`);
  return b;
}

export function graphicsBalance(tier: GraphicsTier) {
  const g = balance.graphics[tier];
  if (!g) throw new Error(`[balance] unknown graphics tier "${tier}"`);
  return g;
}

export const CLASS_KEYS: ClassKey[] = (Object.keys(balance.classes) as ClassKey[]).sort(
  (a, b) => balance.classes[a].order - balance.classes[b].order,
);

export const WEAPON_KEYS = Object.keys(balance.weapons) as WeaponKey[];

/** الذخيرة الابتدائية لسلاح حركي / starting magazine+reserve for a kinetic weapon. */
export function startingAmmo(key: WeaponKey): { magazine: number; reserve: number } {
  const w = balance.weapons[key] as { magazine?: number; reserve?: number };
  return { magazine: w.magazine ?? 0, reserve: w.reserve ?? 0 };
}

/** تأكيد سلامة ملف التوازن عند الإقلاع / fail fast on a malformed balance file. */
export function assertBalanceIntegrity(): void {
  const problems: string[] = [];
  for (const key of CLASS_KEYS) {
    const c = balance.classes[key];
    if (!(c.primary in balance.weapons)) problems.push(`class ${key} references unknown weapon ${c.primary}`);
    if (c.health <= 0) problems.push(`class ${key} has non-positive health`);
    if (c.speed <= 0) problems.push(`class ${key} has non-positive speed`);
  }
  if (balance.wells.positions.length !== balance.wells.count) {
    problems.push(`wells.count=${balance.wells.count} but positions=${balance.wells.positions.length}`);
  }
  const half = balance.map.size / 2;
  for (const p of balance.wells.positions) {
    if (Math.abs(p.x) > half || Math.abs(p.z) > half) problems.push(`well (${p.x},${p.z}) outside map`);
  }
  const traverseSec = balance.map.size / balance.dusk.speedMps;
  if (Math.abs(traverseSec - balance.match.crawl.durationSec) > 1) {
    problems.push(
      `dusk line crosses the map in ${traverseSec.toFixed(1)}s but a match lasts ${balance.match.crawl.durationSec}s`,
    );
  }
  if (balance.crawler.laneZ.length !== 2) problems.push('crawler.laneZ must hold exactly two lanes');
  if (problems.length) throw new Error(`[balance] integrity check failed:\n - ${problems.join('\n - ')}`);
}
