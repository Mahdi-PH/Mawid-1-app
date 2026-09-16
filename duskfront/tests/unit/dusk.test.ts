/**
 * خط الغسق: الآلية التي تبني عليها اللعبة كلها.
 * The dusk line is the mechanic everything else stands on, so it gets the most tests.
 */
import { describe, expect, it } from 'vitest';
import {
  MAP_HALF,
  MAP_SIZE,
  balance,
  baseLightAtX,
  computeLightLevel,
  distanceToDuskEdge,
  duskLineX,
  nameplateRange,
  solarChargeMultiplier,
  starIntensity,
  stepExposure,
  sunDirection,
  visibleOnMinimap,
  zoneAtX,
  type StructureState,
} from '@duskfront/shared';

const DURATION = balance.match.crawl.durationSec;

describe('حركة خط الغسق / dusk line travel', () => {
  it('يبدأ عند الحافة الغربية وينتهي عند الشرقية خلال مدة المباراة', () => {
    expect(duskLineX(0)).toBeCloseTo(-MAP_HALF, 5);
    expect(duskLineX(DURATION)).toBeCloseTo(MAP_HALF, 0);
  });

  it('يعبر الخريطة بالسرعة المنصوص عليها بالضبط', () => {
    const travelled = duskLineX(DURATION) - duskLineX(0);
    expect(travelled).toBeCloseTo(MAP_SIZE, 0);
    expect(balance.dusk.speedMps * DURATION).toBeCloseTo(MAP_SIZE, 0);
  });

  it('يتحرك غربًا→شرقًا بلا رجوع', () => {
    let previous = duskLineX(0);
    for (let t = 10; t <= DURATION; t += 10) {
      const current = duskLineX(t);
      expect(current).toBeGreaterThan(previous);
      previous = current;
    }
  });
});

describe('تصنيف المناطق / zone classification', () => {
  it('الغرب سطوع والشرق عتمة وبينهما شريط الشفق', () => {
    const t = DURATION / 2;
    const line = duskLineX(t);
    const half = balance.dusk.bandWidth / 2;
    expect(zoneAtX(line - half - 1, t)).toBe('bright');
    expect(zoneAtX(line, t)).toBe('dusk');
    expect(zoneAtX(line + half + 1, t)).toBe('dark');
  });

  it('عرض شريط الشفق يساوي القيمة المعلنة', () => {
    const t = DURATION / 2;
    const line = duskLineX(t);
    // العيّنات تشمل الطرفين، فنقيس المسافة بين أول وآخر عيّنة داخل الشريط
    const step = 0.5;
    let first: number | null = null;
    let last = 0;
    for (let x = line - 400; x <= line + 400; x += step) {
      if (zoneAtX(x, t) === 'dusk') {
        if (first === null) first = x;
        last = x;
      }
    }
    expect(first).not.toBeNull();
    expect(last - (first as number)).toBeCloseTo(balance.dusk.bandWidth, 0);
  });

  it('نفس النقطة تمرّ بالمناطق الثلاث خلال المباراة', () => {
    const x = 0;
    const seen = new Set<string>();
    for (let t = 0; t <= DURATION; t += 5) seen.add(zoneAtX(x, t));
    expect(seen).toEqual(new Set(['dark', 'dusk', 'bright']));
  });
});

describe('مستوى الضوء L / light level', () => {
  it('السطوع أعلى من الشفق، والشفق أعلى من العتمة', () => {
    const t = DURATION / 2;
    const line = duskLineX(t);
    const bright = baseLightAtX(line - 400, t);
    const dusk = baseLightAtX(line, t);
    const dark = baseLightAtX(line + 400, t);
    expect(bright).toBeGreaterThan(dusk);
    expect(dusk).toBeGreaterThan(dark);
    expect(bright).toBeLessThanOrEqual(1);
    expect(dark).toBeGreaterThanOrEqual(0);
  });

  it('المرآة تصنع جيب ضوء داخل العتمة', () => {
    const t = DURATION / 2;
    const line = duskLineX(t);
    const darkPoint = { x: line + 200, y: 0, z: 0 };
    const withoutMirror = computeLightLevel(darkPoint, t, [], t).light;

    const mirror: StructureState = {
      id: 'm1',
      kind: 'mirror',
      ownerId: 'p1',
      team: 0,
      // المرآة نفسها داخل الشفق حتى تصلها الشمس
      position: { x: line, y: 0, z: 0 },
      yaw: 0,
      health: 120,
      maxHealth: 120,
      expiresAt: 0,
    };
    const near = computeLightLevel({ x: line + 8, y: 0, z: 0 }, t, [mirror], t);
    expect(near.light).toBeGreaterThan(withoutMirror);
    expect(near.inMirrorPocket).toBe(true);
  });

  it('برج الظل يخفض الضوء داخل السطوع', () => {
    const t = DURATION / 2;
    const line = duskLineX(t);
    const brightPoint = { x: line - 400, y: 0, z: 0 };
    const plain = computeLightLevel(brightPoint, t, [], t).light;
    const tower: StructureState = {
      id: 's1',
      kind: 'shadow_tower',
      ownerId: 'p1',
      team: 0,
      position: brightPoint,
      yaw: 0,
      health: 150,
      maxHealth: 150,
      expiresAt: 0,
    };
    const shaded = computeLightLevel(brightPoint, t, [tower], t);
    expect(shaded.light).toBeLessThan(plain);
    expect(shaded.inArtificialShadow).toBe(true);
  });

  it('البنية المنتهية الصلاحية لا تؤثر', () => {
    const t = 100;
    const expired: StructureState = {
      id: 'm2',
      kind: 'mirror',
      ownerId: 'p1',
      team: 0,
      position: { x: duskLineX(t), y: 0, z: 0 },
      yaw: 0,
      health: 120,
      maxHealth: 120,
      expiresAt: t - 1,
    };
    const result = computeLightLevel({ x: duskLineX(t) + 5, y: 0, z: 0 }, t, [expired], t);
    expect(result.mirrorBonus).toBe(0);
  });
});

describe('شحن الأسلحة الشمسية / solar charging', () => {
  it('يتضاعف في السطوع ويتوقّف في العتمة', () => {
    expect(solarChargeMultiplier('bright', 1)).toBe(balance.zones.bright.solarChargeMultiplier);
    expect(solarChargeMultiplier('dusk', 0.5)).toBe(balance.zones.dusk.solarChargeMultiplier);
    expect(solarChargeMultiplier('dark', 0)).toBe(0);
  });

  it('جيب الضوء يعيد الشحن داخل العتمة', () => {
    expect(solarChargeMultiplier('dark', 0.9)).toBe(balance.zones.dusk.solarChargeMultiplier);
  });
});

describe('ضرر الحرارة والبرد / heat and cold', () => {
  it('لا ضرر قبل انتهاء مهلة الأمان في السطوع', () => {
    let state = { heat: 0, cold: 0 };
    let total = 0;
    for (let i = 0; i < balance.zones.bright.heatGraceSec; i++) {
      const result = stepExposure(state, 'bright', 1, { sheltered: false, light: 1 });
      state = { heat: result.heat, cold: result.cold };
      total += result.damage;
    }
    expect(total).toBe(0);
  });

  it('يبدأ الضرر بعد المهلة بالمعدّل المنصوص عليه', () => {
    let state = { heat: balance.zones.bright.heatGraceSec + 1, cold: 0 };
    const result = stepExposure(state, 'bright', 1, { sheltered: false, light: 1 });
    expect(result.damage).toBeCloseTo(balance.zones.bright.heatDps, 5);
    expect(result.source).toBe('heat');
  });

  it('الظل الصناعي يوقف تراكم الحرارة', () => {
    let state = { heat: 10, cold: 0 };
    const result = stepExposure(state, 'bright', 1, { sheltered: true, light: 0.2 });
    expect(result.heat).toBeLessThan(10);
    expect(result.damage).toBe(0);
  });

  it('البرد يعمل بنفس المنطق في العتمة', () => {
    const state = { heat: 0, cold: balance.zones.dark.coldGraceSec + 1 };
    const result = stepExposure(state, 'dark', 1, { sheltered: false, light: 0 });
    expect(result.damage).toBeCloseTo(balance.zones.dark.coldDps, 5);
    expect(result.source).toBe('cold');
  });

  it('جيب الضوء يمنع ضرر البرد', () => {
    const state = { heat: 0, cold: balance.zones.dark.coldGraceSec + 5 };
    const result = stepExposure(state, 'dark', 1, { sheltered: false, light: 0.9 });
    expect(result.damage).toBe(0);
  });
});

describe('التخفي في العتمة / dark-zone concealment', () => {
  it('يختفي اللاعب من الخريطة المصغّرة في العتمة', () => {
    expect(visibleOnMinimap('dark', 0, false, false)).toBe(false);
    expect(visibleOnMinimap('dusk', 0.5, false, false)).toBe(true);
  });

  it('المرآة أو العلامة الحرارية تكشفه', () => {
    expect(visibleOnMinimap('dark', 0.9, false, false)).toBe(true);
    expect(visibleOnMinimap('dark', 0, false, true)).toBe(true);
  });

  it('مدى الاسم فوق الرأس محدود في العتمة', () => {
    expect(nameplateRange('dark', 0)).toBe(balance.zones.dark.nameplateRange);
    expect(nameplateRange('bright', 1)).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('مساعدات العرض / presentation helpers', () => {
  it('اتجاه الشمس دائمًا من الغرب', () => {
    const t = DURATION / 2;
    expect(sunDirection(duskLineX(t) - 200, t).x).toBeLessThan(0);
  });

  it('النجوم تشتد كلما توغّلنا شرقًا', () => {
    const t = DURATION / 2;
    const line = duskLineX(t);
    expect(starIntensity(line, t)).toBeLessThan(starIntensity(line + 400, t));
  });

  it('المسافة إلى حافة الشفق سالبة داخل الشريط وموجبة خارجه', () => {
    const t = DURATION / 2;
    const line = duskLineX(t);
    expect(distanceToDuskEdge(line, t)).toBeLessThan(0);
    expect(distanceToDuskEdge(line + 400, t)).toBeGreaterThan(0);
  });
});
