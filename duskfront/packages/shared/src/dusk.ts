/**
 * نظام خط الغسق — الآلية التي تعيد تشكيل ساحة المعركة طوال المباراة.
 * The dusk-line system: the terminator crawls west→east across Ash Valley, so the
 * bright / dusk / dark bands sweep over every position on the map during a match.
 *
 * الاتجاه: الغرب مُضيء (الشمس)، الشرق مُظلم (القمر) — كما في اللوحة الفنية المرجعية.
 * Orientation: west is lit (sun), east is dark (moon) — matching the reference art.
 */
import { balance } from './balance.js';
import { clamp, clamp01, lerp, smoothstep } from './math.js';
import { MAP_HALF } from './terrain.js';
import type { StructureState, Vec3, ZoneKey } from './types.js';

const D = balance.dusk;
const Z = balance.zones;
const L = balance.light;

/** موضع خط الغسق على محور X عند زمن المباراة بالثواني. */
export function duskLineX(matchTimeSec: number): number {
  return -MAP_HALF + D.startOffset + D.speedMps * matchTimeSec;
}

/** المسافة الموقّعة من خط الغسق: موجب = شرق (نحو الليل). */
export function signedDistanceToDusk(x: number, matchTimeSec: number): number {
  return x - duskLineX(matchTimeSec);
}

/** تصنيف المنطقة عند إحداثي X / classify the band at a world x. */
export function zoneAtX(x: number, matchTimeSec: number): ZoneKey {
  const d = signedDistanceToDusk(x, matchTimeSec);
  const half = D.bandWidth / 2;
  if (d < -half) return 'bright';
  if (d > half) return 'dark';
  return 'dusk';
}

export function zoneAt(position: Vec3, matchTimeSec: number): ZoneKey {
  return zoneAtX(position.x, matchTimeSec);
}

/**
 * الضوء الأساسي حسب الموقع (متدرّج وليس قفزات).
 * Base light level from position — smoothly blended so the bands feel continuous.
 */
export function baseLightAtX(x: number, matchTimeSec: number): number {
  const d = signedDistanceToDusk(x, matchTimeSec);
  const half = D.bandWidth / 2;
  const soft = D.terminatorSoftness;
  if (d <= -half) {
    // داخل السطوع: يتشبّع كلما ابتعدنا غربًا
    return lerp(Z.dusk.baseLight, Z.bright.baseLight, smoothstep(-half, -half - soft, d));
  }
  if (d >= half) {
    return lerp(Z.dusk.baseLight, Z.dark.baseLight, smoothstep(half, half + soft, d));
  }
  // داخل الشفق: تدرّج من الحافة المضيئة إلى الحافة المظلمة حول القيمة الأساسية
  const t = clamp01((d + half) / D.bandWidth);
  return lerp(Z.dusk.baseLight * 1.35, Z.dusk.baseLight * 0.7, t);
}

/** ارتفاع الشمس بالراديان: موجب فوق الأفق (غرب الخريطة). */
export function sunAltitude(x: number, matchTimeSec: number): number {
  const d = signedDistanceToDusk(x, matchTimeSec);
  const t = clamp(-d / D.sunAltitudeSpan, -1, 1);
  return (t * Math.PI) / 2.25;
}

/** اتجاه الشمس المُستخدم في الإضاءة والظلال / sun direction for lighting + shadows. */
export function sunDirection(x: number, matchTimeSec: number): Vec3 {
  const alt = sunAltitude(x, matchTimeSec);
  // الشمس في الغرب دائمًا: مركّبة X سالبة
  return { x: -Math.cos(alt), y: Math.sin(alt), z: -0.22 };
}

/** كثافة النجوم 0..1 عند نقطة / star visibility at a position. */
export function starIntensity(x: number, matchTimeSec: number): number {
  const d = signedDistanceToDusk(x, matchTimeSec);
  return smoothstep(D.bandWidth / 2, D.bandWidth / 2 + D.starFadeDistance, d);
}

export interface LightContribution {
  /** مستوى الضوء النهائي L من 0 إلى 1 */
  light: number;
  base: number;
  mirrorBonus: number;
  shadowPenalty: number;
  zone: ZoneKey;
  /** هل هذه النقطة داخل «جيب ضوء» صنعته مرآة؟ */
  inMirrorPocket: boolean;
  /** هل هذه النقطة داخل ظل صناعي؟ */
  inArtificialShadow: boolean;
}

/**
 * الحساب الرسمي لمستوى الضوء L على الخادم:
 *   L = الضوء الأساسي + أثر المرايا القريبة − أثر أبراج الظل
 * Authoritative light level for a point, mirrors add, shadow towers subtract.
 */
export function computeLightLevel(
  position: Vec3,
  matchTimeSec: number,
  structures: readonly StructureState[],
  /** زمن المباراة بالثواني / current match time in seconds */
  now: number,
): LightContribution {
  const zone = zoneAt(position, matchTimeSec);
  const base = baseLightAtX(position.x, matchTimeSec);

  let mirror = 0;
  let shadow = 0;
  for (const s of structures) {
    if (s.expiresAt > 0 && s.expiresAt < now) continue;
    if (s.health <= 0) continue;
    if (s.kind === 'mirror') {
      // المرايا لا تضيء إلا إذا كانت هي نفسها تصل إليها الشمس
      const mirrorZone = zoneAt(s.position, matchTimeSec);
      if (mirrorZone === 'dark') continue;
      const d = Math.hypot(position.x - s.position.x, position.z - s.position.z);
      const reach = s.radius ?? L.mirrorRadius;
      const radial = 1 - smoothstep(reach * 0.35, reach, d);
      const beam = mirrorBeamFactor(position, s);
      mirror = Math.max(mirror, L.mirrorBonus * Math.max(radial, beam));
    } else if (s.kind === 'shadow_tower') {
      const d = Math.hypot(position.x - s.position.x, position.z - s.position.z);
      const reach = s.radius ?? L.shadowRadius;
      const radial = 1 - smoothstep(reach * 0.45, reach, d);
      shadow = Math.max(shadow, L.shadowPenalty * radial);
    } else if (s.kind === 'dawn_wall') {
      const d = Math.hypot(position.x - s.position.x, position.z - s.position.z);
      const radial = 1 - smoothstep(4, balance.classes.guardian.abilities.f.length * 0.75, d);
      mirror = Math.max(mirror, balance.classes.guardian.abilities.f.alliesLightBonus * radial);
    }
  }

  const light = clamp(base + mirror - shadow, L.min, L.max);
  return {
    light,
    base,
    mirrorBonus: mirror,
    shadowPenalty: shadow,
    zone,
    inMirrorPocket: mirror > 0.05,
    inArtificialShadow: shadow > 0.05,
  };
}

/** شدّة شعاع المرآة عند نقطة: مستطيل ضيّق ممتد شرقًا من المرآة. */
function mirrorBeamFactor(position: Vec3, mirror: StructureState): number {
  const dx = position.x - mirror.position.x;
  const dz = position.z - mirror.position.z;
  const dir = { x: -Math.sin(mirror.yaw), z: -Math.cos(mirror.yaw) };
  const along = dx * dir.x + dz * dir.z;
  if (along < 0 || along > L.mirrorBeamLength) return 0;
  const lateral = Math.abs(dx * -dir.z + dz * dir.x);
  const width = L.mirrorBeamWidth * (0.45 + (along / L.mirrorBeamLength) * 0.75);
  if (lateral > width) return 0;
  const fade = 1 - smoothstep(L.mirrorBeamLength * 0.6, L.mirrorBeamLength, along);
  const edge = 1 - smoothstep(width * 0.55, width, lateral);
  return fade * edge;
}

/** مضاعف شحن الأسلحة الشمسية / solar charge multiplier for a zone. */
export function solarChargeMultiplier(zone: ZoneKey, light: number): number {
  const zoneMul = Z[zone].solarChargeMultiplier;
  if (zone === 'dark') {
    // جيب الضوء يعيد الشحن داخل العتمة / a mirror pocket restores charging in the dark
    return light >= L.revealThreshold ? Z.dusk.solarChargeMultiplier : zoneMul;
  }
  return zoneMul;
}

export interface ExposureState {
  /** ثوانٍ متواصلة في السطوع / continuous seconds exposed to full sun */
  heat: number;
  /** ثوانٍ متواصلة في العتمة / continuous seconds exposed to deep dark */
  cold: number;
}

export interface ExposureResult extends ExposureState {
  /** ضرر هذا التحديث / environmental damage applied this step */
  damage: number;
  source: 'heat' | 'cold' | 'none';
  /** الحرارة المعروضة في الواجهة بالدرجات المئوية */
  temperatureC: number;
}

/**
 * يحدّث عدّادات التعرّض ويطبّق ضرر الحرارة/البرد.
 * Advances heat/cold exposure and returns the environmental damage for this step.
 *
 * الظل الصناعي أو المركبة يوقفان تراكم الحرارة، وجيب الضوء يوقف تراكم البرد.
 */
export function stepExposure(
  state: ExposureState,
  zone: ZoneKey,
  dt: number,
  options: { sheltered: boolean; light: number },
): ExposureResult {
  let { heat, cold } = state;
  let damage = 0;
  let source: 'heat' | 'cold' | 'none' = 'none';

  const shelteredFromSun = options.sheltered || options.light < L.revealThreshold;
  const warmedInDark = options.light >= L.revealThreshold;

  if (zone === 'bright' && !shelteredFromSun) {
    heat += dt;
    if (heat > Z.bright.heatGraceSec) {
      damage = Z.bright.heatDps * dt;
      source = 'heat';
    }
  } else {
    heat = Math.max(0, heat - dt * Z.bright.heatCooldownRate);
  }

  if (zone === 'dark' && !warmedInDark) {
    cold += dt;
    if (cold > Z.dark.coldGraceSec) {
      damage = Z.dark.coldDps * dt;
      source = 'cold';
    }
  } else {
    cold = Math.max(0, cold - dt * Z.dark.coldCooldownRate);
  }

  const ambient = Z[zone].ambientTempC;
  const heatT = clamp01(heat / Math.max(Z.bright.heatGraceSec, 1));
  const coldT = clamp01(cold / Math.max(Z.dark.coldGraceSec, 1));
  const temperatureC =
    zone === 'bright'
      ? lerp(Z.dusk.ambientTempC, ambient, heatT)
      : zone === 'dark'
        ? lerp(Z.dusk.ambientTempC, ambient, coldT)
        : ambient;

  return { heat, cold, damage, source, temperatureC };
}

/** هل يظهر اللاعب على الخريطة المصغّرة؟ / minimap visibility rule. */
export function visibleOnMinimap(zone: ZoneKey, light: number, cloaked: boolean, marked: boolean): boolean {
  if (marked) return true;
  if (cloaked) return false;
  if (zone === 'dark' && Z.dark.hideFromMinimap) return light >= L.revealThreshold;
  return true;
}

/** أقصى مدى لظهور الاسم فوق الرأس / nameplate draw distance for a target. */
export function nameplateRange(zone: ZoneKey, light: number): number {
  if (zone === 'dark' && light < L.revealThreshold) return Z.dark.nameplateRange;
  return Number.POSITIVE_INFINITY;
}

/** نسبة تقدّم الغسق 0..1 خلال المباراة / normalised dusk progress across the match. */
export function duskProgress(matchTimeSec: number, durationSec: number): number {
  return clamp01(matchTimeSec / durationSec);
}

/** المسافة إلى أقرب حافة شفق (تُعرض في الواجهة). */
export function distanceToDuskEdge(x: number, matchTimeSec: number): number {
  const d = signedDistanceToDusk(x, matchTimeSec);
  const half = D.bandWidth / 2;
  if (d < -half) return -half - d;
  if (d > half) return d - half;
  return -(half - Math.abs(d));
}
