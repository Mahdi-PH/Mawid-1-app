/**
 * منطق الأسلحة: الضرر، السقوط مع المسافة، إصابات الرأس، الشحن.
 * Weapon resolution shared by the server (authoritative) and the client (prediction/FX).
 */
import { balance, weaponBalance } from './balance.js';
import { clamp, clamp01, lerp } from './math.js';
import type { ClassKey, Vec3, WeaponKey, ZoneKey } from './types.js';

const P = balance.player;

export type HitRegion = 'head' | 'body' | 'limb';

export interface DamageQuery {
  weapon: WeaponKey;
  distance: number;
  region: HitRegion;
  /** 0..1 مدة الشحن النسبية لبندقية الشعاع */
  chargeRatio?: number;
  /** مضاعف من العلامة الحرارية مثلًا */
  amplify?: number;
}

/** الضرر الأساسي لسلاح قبل المسافة والإصابة / nominal damage before modifiers. */
export function nominalDamage(weapon: WeaponKey, chargeRatio = 0): number {
  const w = balance.weapons[weapon] as {
    damage?: number;
    damageMin?: number;
    damageMax?: number;
    damageCenter?: number;
  };
  if (typeof w.damage === 'number') return w.damage;
  if (typeof w.damageMin === 'number' && typeof w.damageMax === 'number') {
    return lerp(w.damageMin, w.damageMax, clamp01(chargeRatio));
  }
  if (typeof w.damageCenter === 'number') return w.damageCenter;
  throw new Error(`[weapons] weapon "${weapon}" declares no damage`);
}

/** مضاعف سقوط الضرر مع المسافة / linear falloff past a fraction of range. */
export function falloffMultiplier(weapon: WeaponKey, distance: number): number {
  const w = balance.weapons[weapon] as { range?: number };
  const range = w.range ?? 0;
  if (range <= 0) return 1;
  const start = range * P.falloffStartFraction;
  if (distance <= start) return 1;
  if (distance >= range) return P.falloffMinMultiplier;
  const t = (distance - start) / (range - start);
  return lerp(1, P.falloffMinMultiplier, t);
}

export function regionMultiplier(region: HitRegion): number {
  if (region === 'head') return P.headshotMultiplier;
  return 1;
}

/** الضرر النهائي لإصابة واحدة / final damage for one resolved hit. */
export function resolveDamage(query: DamageQuery): number {
  const base = nominalDamage(query.weapon, query.chargeRatio ?? 0);
  const dmg = base * falloffMultiplier(query.weapon, query.distance) * regionMultiplier(query.region);
  return dmg * (query.amplify ?? 1);
}

/** ضرر انفجار متناقص مع نصف القطر / explosion falloff from centre to edge. */
export function explosionDamage(distance: number): number {
  const g = weaponBalance('frag_grenade');
  if (distance >= g.radius) return 0;
  const t = clamp01(distance / g.radius);
  return lerp(g.damageCenter, g.damageEdge, t);
}

/** المدى الأقصى الفعلي للسلاح / effective max range used for hitscan. */
export function weaponRange(weapon: WeaponKey): number {
  const w = balance.weapons[weapon] as { range?: number };
  return w.range ?? 0;
}

/** الفاصل الزمني بين الطلقات بالثواني / seconds between shots. */
export function shotInterval(weapon: WeaponKey): number {
  const w = balance.weapons[weapon] as { fireRate?: number };
  const rate = w.fireRate ?? 0;
  return rate > 0 ? 1 / rate : 0;
}

/** كم طلقة يمكن إطلاقها في مدة (لمكافحة الغش) / max legal shots within a window. */
export function maxShotsInWindow(weapon: WeaponKey, seconds: number): number {
  const interval = shotInterval(weapon);
  if (interval <= 0) return 1;
  return Math.floor(seconds / interval * balance.anticheat.maxFireRateTolerance) + 1;
}

export function isSolar(weapon: WeaponKey): boolean {
  return (balance.weapons[weapon] as { family: string }).family === 'solar';
}

export function lumenCost(weapon: WeaponKey): number {
  return (balance.weapons[weapon] as { lumenPerShot?: number }).lumenPerShot ?? 0;
}

export function pelletCount(weapon: WeaponKey): number {
  return (balance.weapons[weapon] as { pellets?: number }).pellets ?? 1;
}

export function magazineSize(weapon: WeaponKey): number {
  return (balance.weapons[weapon] as { magazine?: number }).magazine ?? 0;
}

export function reloadSeconds(weapon: WeaponKey): number {
  return (balance.weapons[weapon] as { reloadSec?: number }).reloadSec ?? 0;
}

export function spreadRadians(weapon: WeaponKey, aiming: boolean): number {
  const w = balance.weapons[weapon] as { spreadDeg?: number; adsSpreadDeg?: number };
  const deg = aiming ? (w.adsSpreadDeg ?? 0) : (w.spreadDeg ?? 0);
  return (deg * Math.PI) / 180;
}

/**
 * نسبة شحن بندقية الشعاع / beam-rifle charge ratio for a hold duration.
 */
export function chargeRatio(weapon: WeaponKey, heldSeconds: number): number {
  const w = balance.weapons[weapon] as { chargeSecMin?: number; chargeSecMax?: number };
  if (w.chargeSecMax === undefined) return 0;
  const min = w.chargeSecMin ?? 0;
  return clamp01((heldSeconds - min) / Math.max(w.chargeSecMax - min, 1e-6));
}

/**
 * هل يستطيع اللاعب الإطلاق الآن؟ (لومِن/ذخيرة/تبريد)
 * Gate a shot on ammo, lumen and fire-rate — used identically on both sides.
 */
export interface FireGateInput {
  weapon: WeaponKey;
  nowSec: number;
  nextFireAt: number;
  magazine: number;
  lumen: number;
  reloading: boolean;
  zone: ZoneKey;
  solarChargeMultiplier: number;
}

export interface FireGateResult {
  allowed: boolean;
  reason: 'ok' | 'cooldown' | 'no_ammo' | 'no_lumen' | 'reloading' | 'no_solar_charge';
}

export function canFire(input: FireGateInput): FireGateResult {
  if (input.reloading) return { allowed: false, reason: 'reloading' };
  if (input.nowSec < input.nextFireAt) return { allowed: false, reason: 'cooldown' };
  if (isSolar(input.weapon)) {
    if (input.lumen < lumenCost(input.weapon)) return { allowed: false, reason: 'no_lumen' };
  } else if (magazineSize(input.weapon) > 0 && input.magazine <= 0) {
    return { allowed: false, reason: 'no_ammo' };
  }
  return { allowed: true, reason: 'ok' };
}

/** سرعة توليد اللومِن الشخصي / personal lumen regen per second at light level L. */
export function lumenRegenPerSecond(light: number): number {
  return light * balance.lumen.personalRegenPerLight;
}

/** الصحة القصوى لصنف / class max health. */
export function classMaxHealth(classKey: ClassKey): number {
  return balance.classes[classKey].health;
}

/** منطقة الإصابة من نقطة الاصطدام / hit region from an impact point on a target. */
export function hitRegionFor(impact: Vec3, targetFeet: Vec3, crouching: boolean): HitRegion {
  const height = crouching ? P.crouchEyeHeight + 0.2 : P.height;
  const rel = impact.y - targetFeet.y;
  if (rel > height * 0.82) return 'head';
  if (rel < height * 0.35) return 'limb';
  return 'body';
}

/** ضرر السقوط / fall damage from landing speed. */
export function fallDamage(landingSpeed: number): number {
  if (landingSpeed <= P.fallDamageMinSpeed) return 0;
  return (landingSpeed - P.fallDamageMinSpeed) * P.fallDamagePerSpeed;
}

/** يوزّع الضرر على الدرع ثم الصحة / apply damage to shield first, then health. */
export function applyDamage(
  health: number,
  shield: number,
  amount: number,
): { health: number; shield: number; absorbed: number } {
  const absorbed = Math.min(shield, amount);
  const rest = amount - absorbed;
  return { shield: shield - absorbed, health: clamp(health - rest, 0, Number.MAX_SAFE_INTEGER), absorbed };
}
