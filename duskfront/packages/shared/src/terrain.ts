/**
 * خريطة «وادي الرماد» — تضاريس إجرائية حتمية.
 * "Ash Valley" — deterministic procedural terrain shared by renderer and server.
 *
 * دالة الارتفاع التحليلية هي مصدر الحقيقة للاصطدام؛ العميل يرسم قطعًا (chunks)
 * تعتمد نفس الدالة، فلا يختلف ما تراه عمّا تصطدم به.
 * The analytic height function is the collision source of truth; the client meshes
 * chunks from the very same function, so what you see is what you collide with.
 */
import { balance } from './balance.js';
import { clamp, clamp01, lerp, smoothstep, vec3 } from './math.js';
import { Rng, hash2 } from './rng.js';
import type { Vec3 } from './types.js';

const MAP = balance.map;
export const MAP_SIZE = MAP.size;
export const MAP_HALF = MAP.size / 2;
export const WATER_LEVEL = MAP.waterLevel;

export interface BoxObstacle {
  id: string;
  kind: 'ruin' | 'bridge' | 'rock' | 'pillar' | 'wall';
  center: Vec3;
  half: Vec3;
  yaw: number;
  /** هل يحجب الرصاص؟ / does it block hitscan and movement */
  solid: boolean;
}

export interface CrystalInstance {
  position: Vec3;
  scale: number;
  yaw: number;
  hue: number;
}

export interface RuinInstance {
  position: Vec3;
  size: Vec3;
  yaw: number;
  kind: 'tower' | 'slab' | 'arch' | 'shell';
}

/** ضجيج قيمي ناعم / smooth value noise in [0,1]. */
function valueNoise(x: number, z: number, seed: number): number {
  const xi = Math.floor(x);
  const zi = Math.floor(z);
  const fx = x - xi;
  const fz = z - zi;
  const tx = fx * fx * (3 - 2 * fx);
  const tz = fz * fz * (3 - 2 * fz);
  const a = hash2(xi, zi, seed);
  const b = hash2(xi + 1, zi, seed);
  const c = hash2(xi, zi + 1, seed);
  const d = hash2(xi + 1, zi + 1, seed);
  return lerp(lerp(a, b, tx), lerp(c, d, tx), tz);
}

/** ضجيج متعدد الطبقات / fractional brownian motion. */
export function fbm(x: number, z: number, seed: number, octaves: number, gain = 0.5, lacunarity = 2): number {
  let amp = 1;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += valueNoise(x * freq, z * freq, seed + i * 1013) * amp;
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / norm;
}

/** ضجيج حَرْفي للحواف الحادة / ridged noise for sharp mesa edges. */
function ridged(x: number, z: number, seed: number, octaves: number): number {
  const n = fbm(x, z, seed, octaves);
  return 1 - Math.abs(n * 2 - 1);
}

/** مسار النهر المتعرّج عند إحداثي z / meandering river centre-line at a given z. */
export function riverCenterX(z: number): number {
  return Math.sin(z * 0.0042) * 130 + Math.cos(z * 0.0017) * 70;
}

/** ارتفاع ممر القلعة الزاحفة / the flattened crawler-lane profile. */
function laneProfile(x: number): number {
  return fbm(x / 640 + 11.3, 3.77, MAP.seed + 7717, 2) * 22 + 4;
}

/**
 * ارتفاع الأرض عند نقطة / analytic ground height at a world point.
 * حتمية تمامًا: نفس القيمة على الخادم والعميل.
 */
export function terrainHeight(x: number, z: number): number {
  const seed = MAP.seed;

  // 1) البنية القارية / continental shape
  let h = (fbm(x / 620, z / 620, seed, 3) - 0.34) * MAP.maxHeight * 1.2;

  // 2) هضاب ومرتفعات / mesas and ridge lines
  const ridgeMask = clamp01(fbm(x / 780 + 4.1, z / 780 - 2.3, seed + 91, 2) * 1.6 - 0.35);
  h += ridged(x / 190, z / 190, seed + 331, 3) * 34 * ridgeMask;

  // 3) تفاصيل صغيرة / small-scale detail
  h += (fbm(x / 46, z / 46, seed + 577, 3) - 0.5) * 7.5;

  // 4) حفر الوادي والنهر / carve the valley and its river
  const dRiver = Math.abs(x - riverCenterX(z));
  const valley = 1 - smoothstep(34, MAP.riverHalfWidth, dRiver);
  const riverFloor = WATER_LEVEL - 3 + smoothstep(0, 34, dRiver) * 9;
  h = lerp(h, riverFloor, valley * 0.88);

  // 5) تسوية ممرات القلعتين / flatten the two crawler lanes
  for (const laneZ of balance.crawler.laneZ) {
    const laneMask = 1 - smoothstep(30, 78, Math.abs(z - laneZ));
    if (laneMask > 0) h = lerp(h, laneProfile(x), laneMask * 0.9);
  }

  // 6) منصّات آبار اللومِن / level pads under the lumen wells
  for (const w of balance.wells.positions) {
    const d = Math.hypot(x - w.x, z - w.z);
    const mask = 1 - smoothstep(10, 30, d);
    if (mask > 0) h = lerp(h, wellPadHeight(w.x, w.z), mask);
  }

  // 7) جدار جبلي على الحدود / mountain wall at the map border
  const edge = Math.max(Math.abs(x), Math.abs(z));
  const border = smoothstep(MAP_HALF - MAP.borderMargin, MAP_HALF + 24, edge);
  h = lerp(h, MAP.borderHeight, border);

  return h;
}

/** ارتفاع منصّة البئر (بدون تكرار لا نهائي) / well pad height without recursion. */
function wellPadHeight(x: number, z: number): number {
  const seed = MAP.seed;
  let h = (fbm(x / 620, z / 620, seed, 3) - 0.34) * MAP.maxHeight * 1.2;
  const dRiver = Math.abs(x - riverCenterX(z));
  const valley = 1 - smoothstep(34, MAP.riverHalfWidth, dRiver);
  h = lerp(h, WATER_LEVEL - 3 + smoothstep(0, 34, dRiver) * 9, valley * 0.88);
  return h + 1.2;
}

/** الميل السطحي / surface normal via central differences. */
export function terrainNormal(x: number, z: number, epsilon = 1): Vec3 {
  const hL = terrainHeight(x - epsilon, z);
  const hR = terrainHeight(x + epsilon, z);
  const hD = terrainHeight(x, z - epsilon);
  const hU = terrainHeight(x, z + epsilon);
  const nx = hL - hR;
  const nz = hD - hU;
  const ny = 2 * epsilon;
  const len = Math.hypot(nx, ny, nz) || 1;
  return vec3(nx / len, ny / len, nz / len);
}

/** هل الموضع قابل للسير؟ / slope-based walkability, used by the bot nav grid. */
export function isWalkable(x: number, z: number): boolean {
  if (Math.abs(x) > MAP_HALF - MAP.borderMargin || Math.abs(z) > MAP_HALF - MAP.borderMargin) return false;
  const n = terrainNormal(x, z, 1.5);
  if (n.y < MAP.walkableSlope) return false;
  return terrainHeight(x, z) > WATER_LEVEL - 1.5;
}

export function clampToMap(x: number, z: number): { x: number; z: number } {
  const lim = MAP_HALF - MAP.borderMargin * 0.55;
  return { x: clamp(x, -lim, lim), z: clamp(z, -lim, lim) };
}

/**
 * تقاطع شعاع مع التضاريس / ray-march the terrain.
 * يعيد المسافة أو -1 / returns distance along the ray, or -1 when it misses.
 */
export function raycastTerrain(origin: Vec3, dir: Vec3, maxDist: number, step = 1.25): number {
  let t = 0;
  let prevT = 0;
  let prevAbove = origin.y - terrainHeight(origin.x, origin.z);
  if (prevAbove <= 0) return 0;
  while (t < maxDist) {
    t = Math.min(t + step, maxDist);
    const px = origin.x + dir.x * t;
    const py = origin.y + dir.y * t;
    const pz = origin.z + dir.z * t;
    const above = py - terrainHeight(px, pz);
    if (above <= 0) {
      // تنقيح ثنائي / bisection refine
      let lo = prevT;
      let hi = t;
      for (let i = 0; i < 12; i++) {
        const mid = (lo + hi) * 0.5;
        const my = origin.y + dir.y * mid;
        const mh = terrainHeight(origin.x + dir.x * mid, origin.z + dir.z * mid);
        if (my - mh <= 0) hi = mid;
        else lo = mid;
      }
      return hi;
    }
    prevT = t;
    prevAbove = above;
    // خطوة متكيفة: كلما ارتفعنا كلما كبرت الخطوة
    step = clamp(above * 0.9, 1.25, 14);
  }
  return -1;
}

let cachedRuins: RuinInstance[] | null = null;
let cachedCrystals: CrystalInstance[] | null = null;
let cachedObstacles: BoxObstacle[] | null = null;

/** أطلال المدينة المنتشرة / deterministic ruin scatter (city cluster + outskirts). */
export function getRuins(): RuinInstance[] {
  if (cachedRuins) return cachedRuins;
  const rng = new Rng(MAP.seed ^ 0x51a2);
  const out: RuinInstance[] = [];
  const kinds: RuinInstance['kind'][] = ['tower', 'slab', 'arch', 'shell'];
  let guard = 0;
  while (out.length < MAP.ruinCountMax && guard++ < MAP.ruinCountMax * 40) {
    const inCity = rng.next() < 0.62;
    let x: number;
    let z: number;
    if (inCity) {
      const a = rng.next() * Math.PI * 2;
      const r = Math.sqrt(rng.next()) * MAP.cityRadius;
      x = MAP.cityCenter.x + Math.cos(a) * r;
      z = MAP.cityCenter.z + Math.sin(a) * r;
    } else {
      x = rng.range(-MAP_HALF + 120, MAP_HALF - 120);
      z = rng.range(-MAP_HALF + 120, MAP_HALF - 120);
    }
    const y = terrainHeight(x, z);
    if (y < WATER_LEVEL + 1) continue;
    if (Math.abs(x - riverCenterX(z)) < 48) continue;
    let inLane = false;
    for (const laneZ of balance.crawler.laneZ) if (Math.abs(z - laneZ) < 58) inLane = true;
    if (inLane) continue;
    let nearWell = false;
    for (const w of balance.wells.positions) if (Math.hypot(x - w.x, z - w.z) < 22) nearWell = true;
    if (nearWell) continue;

    const kind = rng.pick(kinds);
    const tall = kind === 'tower';
    const size = vec3(
      rng.range(3.5, tall ? 9 : 16),
      tall ? rng.range(14, 46) : rng.range(3, 11),
      rng.range(3.5, tall ? 9 : 16),
    );
    out.push({ position: vec3(x, y, z), size, yaw: rng.range(0, Math.PI * 2), kind });
  }
  cachedRuins = out;
  return out;
}

/** حقل البلورات المتوهّجة / glowing crystal field (brightest on the night side). */
export function getCrystals(): CrystalInstance[] {
  if (cachedCrystals) return cachedCrystals;
  const rng = new Rng(MAP.seed ^ 0x7c31);
  const out: CrystalInstance[] = [];
  let guard = 0;
  while (out.length < MAP.crystalCountMax && guard++ < MAP.crystalCountMax * 40) {
    const x = rng.range(-MAP_HALF + 90, MAP_HALF - 90);
    const z = rng.range(-MAP_HALF + 90, MAP_HALF - 90);
    const dRiver = Math.abs(x - riverCenterX(z));
    // البلورات تحب ضفاف الوادي / crystals favour the valley banks
    if (dRiver > MAP.riverHalfWidth * 1.25 && rng.next() > 0.22) continue;
    const y = terrainHeight(x, z);
    if (y < WATER_LEVEL - 0.5) continue;
    out.push({
      position: vec3(x, y, z),
      scale: rng.range(0.9, 4.4),
      yaw: rng.range(0, Math.PI * 2),
      hue: rng.range(0.5, 0.62),
    });
  }
  cachedCrystals = out;
  return out;
}

/**
 * العوائق الصلبة: الأطلال الكبيرة + جسور تعبر الوادي.
 * Solid obstacles: large ruins plus the bridges that carry the lanes over the valley.
 */
export function getObstacles(): BoxObstacle[] {
  if (cachedObstacles) return cachedObstacles;
  const out: BoxObstacle[] = [];
  const ruins = getRuins();
  for (let i = 0; i < ruins.length; i++) {
    const r = ruins[i]!;
    // الأطلال الصغيرة زينة فقط، الكبيرة تصطدم / only sizeable ruins are collidable
    if (r.size.y < 5) continue;
    out.push({
      id: `ruin_${i}`,
      kind: 'ruin',
      center: vec3(r.position.x, r.position.y + r.size.y / 2, r.position.z),
      half: vec3(r.size.x / 2, r.size.y / 2, r.size.z / 2),
      yaw: r.yaw,
      solid: true,
    });
  }

  for (const b of getBridges()) {
    out.push(b);
  }

  cachedObstacles = out;
  return out;
}

/** جسور تعبر وادي النهر / bridge decks spanning the river valley. */
export function getBridges(): BoxObstacle[] {
  const bridges: BoxObstacle[] = [];
  const lanes = balance.crawler.laneZ;
  const extraZ = [-30, 150];
  const zs = [...lanes, ...extraZ].slice(0, MAP.bridgeCount);
  for (let i = 0; i < zs.length; i++) {
    const z = zs[i]!;
    const cx = riverCenterX(z);
    const span = MAP.riverHalfWidth * 1.15;
    const deckY = Math.max(terrainHeight(cx - span, z), terrainHeight(cx + span, z)) + 2.5;
    bridges.push({
      id: `bridge_${i}`,
      kind: 'bridge',
      center: vec3(cx, deckY, z),
      half: vec3(span, 1.1, 11),
      yaw: 0,
      solid: true,
    });
  }
  return bridges;
}

/**
 * نقطة ظهور آمنة للفريق — خارج هيكل القلعة الزاحفة وداخل شريط الشفق.
 * A safe spawn beside (never inside) the team's crawler hull, within the dusk band.
 */
export function teamSpawnPoint(team: 0 | 1, index: number, duskX: number): Vec3 {
  const laneZ = balance.crawler.laneZ[team]!;
  // مسافة أمان حقيقية: الظهور ملاصقًا للهيكل يملأ الشاشة بجدار أسود
  const clearance = balance.crawler.halfWidth + 30;
  const side = index % 2 === 0 ? 1 : -1;
  const rng = new Rng(MAP.seed ^ (team * 7919) ^ (index * 104729));
  for (let attempt = 0; attempt < 64; attempt++) {
    const x = duskX + rng.range(-MAP.spawnRadius, MAP.spawnRadius * 0.4);
    const z = laneZ + side * (clearance + rng.range(2, MAP.spawnRadius * 0.6));
    const c = clampToMap(x, z);
    if (isWalkable(c.x, c.z)) return vec3(c.x, terrainHeight(c.x, c.z), c.z);
  }
  const fallback = clampToMap(duskX, laneZ + side * (clearance + 6));
  return vec3(fallback.x, terrainHeight(fallback.x, fallback.z), fallback.z);
}

/** لمسح الذاكرة في الاختبارات / test helper: drop memoised world data. */
export function resetTerrainCaches(): void {
  cachedRuins = null;
  cachedCrystals = null;
  cachedObstacles = null;
}
