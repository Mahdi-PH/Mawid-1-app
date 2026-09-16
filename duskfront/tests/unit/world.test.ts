/**
 * العالم المشترك: التضاريس، الحركة، التنقّل، والتوازن.
 * The shared world: terrain determinism, the character controller, navigation and the
 * integrity of balance.json itself.
 */
import { describe, expect, it } from 'vitest';
import {
  CollisionWorld,
  MAP_HALF,
  NavGrid,
  Rng,
  assertBalanceIntegrity,
  balance,
  clampToMap,
  getBridges,
  getCrystals,
  getObstacles,
  getRuins,
  hasLineOfSight,
  isWalkable,
  raycastWorld,
  riverCenterX,
  stepCharacter,
  teamSpawnPoint,
  terrainHeight,
  terrainNormal,
  type InputCommand,
  type PlayerMotionState,
  type TeamId,
} from '@duskfront/shared';

function motionAt(x: number, z: number): PlayerMotionState {
  return {
    position: { x, y: terrainHeight(x, z) + 0.2, z },
    velocity: { x: 0, y: 0, z: 0 },
    yaw: 0,
    pitch: 0,
    grounded: true,
    crouching: false,
    lastSeq: 0,
  };
}

function command(overrides: Partial<InputCommand> = {}): InputCommand {
  return {
    seq: 1,
    dt: 1 / 60,
    moveX: 0,
    moveZ: 0,
    yaw: 0,
    pitch: 0,
    buttons: 0,
    clientTimeMs: 0,
    ...overrides,
  };
}

describe('ملف التوازن / balance file', () => {
  it('يجتاز فحص السلامة', () => {
    expect(() => assertBalanceIntegrity()).not.toThrow();
  });

  it('كل صنف يشير إلى سلاح موجود ويملك ثلاث قدرات', () => {
    for (const [key, cls] of Object.entries(balance.classes)) {
      expect(balance.weapons, `class ${key}`).toHaveProperty(cls.primary);
      expect(cls.abilities.q).toBeDefined();
      expect(cls.abilities.e).toBeDefined();
      expect(cls.abilities.f).toBeDefined();
      expect(cls.health).toBeGreaterThan(0);
    }
  });

  it('عدد الآبار يطابق عدد المواقع وكلها داخل الخريطة', () => {
    expect(balance.wells.positions).toHaveLength(balance.wells.count);
    for (const position of balance.wells.positions) {
      expect(Math.abs(position.x)).toBeLessThan(MAP_HALF);
      expect(Math.abs(position.z)).toBeLessThan(MAP_HALF);
    }
  });
});

describe('حتمية التضاريس / terrain determinism', () => {
  it('تعطي نفس الارتفاع دائمًا لنفس النقطة', () => {
    for (const [x, z] of [[0, 0], [123.4, -456.7], [-700, 700]] as [number, number][]) {
      const first = terrainHeight(x, z);
      for (let i = 0; i < 20; i++) expect(terrainHeight(x, z)).toBe(first);
    }
  });

  it('الارتفاعات محدودة ضمن نطاق معقول', () => {
    let min = Infinity;
    let max = -Infinity;
    for (let x = -MAP_HALF; x <= MAP_HALF; x += 37) {
      for (let z = -MAP_HALF; z <= MAP_HALF; z += 37) {
        const height = terrainHeight(x, z);
        expect(Number.isFinite(height)).toBe(true);
        min = Math.min(min, height);
        max = Math.max(max, height);
      }
    }
    expect(min).toBeGreaterThan(-60);
    expect(max).toBeLessThan(balance.map.borderHeight + 60);
  });

  it('قاع النهر منخفض عند مستوى الماء خارج ممرّات القلعة', () => {
    /*
      تسوية ممرّات القلعة تُطبَّق بعد حفر الوادي وترفعه عمدًا لتعبره الجنازير
      (ومن هناك تأتي الجسور)، لذلك نقيس بعيدًا عن الممرّين.
    */
    let samples = 0;
    for (let z = -700; z <= 700; z += 17) {
      const nearLane = balance.crawler.laneZ.some((laneZ) => Math.abs(z - laneZ) < 110);
      if (nearLane) continue;
      const centre = riverCenterX(z);
      // متوسط ارتفاع التضاريس \~40م، فبقاء القاع قرب مستوى الماء دليل قاطع على الحفر
      expect(terrainHeight(centre, z)).toBeLessThanOrEqual(balance.map.waterLevel + 8);
      samples++;
    }
    expect(samples).toBeGreaterThan(40);
  });

  it('الوادي أخفض من متوسط ضفافه', () => {
    let lower = 0;
    let total = 0;
    for (let z = -600; z <= 600; z += 23) {
      const centre = riverCenterX(z);
      const banks =
        (terrainHeight(centre - balance.map.riverHalfWidth * 1.5, z) +
          terrainHeight(centre + balance.map.riverHalfWidth * 1.5, z)) /
        2;
      if (terrainHeight(centre, z) < banks) lower++;
      total++;
    }
    // الأغلبية الساحقة من المقاطع يكون فيها القاع أخفض من الضفتين
    expect(lower / total).toBeGreaterThan(0.85);
  });

  it('الحدود مرتفعة فتمنع الخروج', () => {
    expect(terrainHeight(MAP_HALF - 5, 0)).toBeGreaterThan(balance.map.borderHeight * 0.5);
    expect(isWalkable(MAP_HALF - 5, 0)).toBe(false);
  });

  it('المتّجه العمودي موحّد الطول', () => {
    const normal = terrainNormal(120, -240);
    expect(Math.hypot(normal.x, normal.y, normal.z)).toBeCloseTo(1, 6);
  });

  it('العناصر الإجرائية ثابتة بين الاستدعاءات', () => {
    expect(getRuins().length).toBe(getRuins().length);
    expect(getCrystals()[0]).toEqual(getCrystals()[0]);
    expect(getBridges()).toHaveLength(balance.map.bridgeCount);
    expect(getObstacles().length).toBeGreaterThan(0);
  });

  it('نقاط الظهور خارج هيكل القلعة وداخل الخريطة', () => {
    for (const team of [0, 1] as TeamId[]) {
      for (let index = 0; index < 5; index++) {
        const spawn = teamSpawnPoint(team, index, -MAP_HALF);
        const laneZ = balance.crawler.laneZ[team]!;
        expect(Math.abs(spawn.z - laneZ)).toBeGreaterThan(balance.crawler.halfWidth);
        expect(Math.abs(spawn.x)).toBeLessThan(MAP_HALF);
      }
    }
  });

  it('القصّ يبقي النقاط داخل الحدود', () => {
    const clamped = clampToMap(9999, -9999);
    expect(Math.abs(clamped.x)).toBeLessThan(MAP_HALF);
    expect(Math.abs(clamped.z)).toBeLessThan(MAP_HALF);
  });
});

describe('محرّك الحركة / character controller', () => {
  const world = new CollisionWorld();

  it('يصل إلى السرعة المقصودة بالضبط أيًا كان معدّل التحديث', () => {
    for (const dt of [1 / 144, 1 / 60, 1 / 20]) {
      const state = motionAt(0, 0);
      for (let i = 0; i < Math.round(3 / dt); i++) {
        stepCharacter(
          state,
          command({ dt, moveZ: 1, seq: i }),
          { baseSpeed: 5.5, speedMultiplier: 1, canSprint: true, canJump: true },
          world,
          dt,
        );
      }
      expect(Math.hypot(state.velocity.x, state.velocity.z)).toBeCloseTo(5.5, 2);
    }
  });

  it('الجري يطبّق المضاعف المنصوص عليه', () => {
    const dt = 1 / 60;
    const state = motionAt(20, 20);
    for (let i = 0; i < 200; i++) {
      stepCharacter(
        state,
        command({ dt, moveZ: 1, buttons: 16, seq: i }),
        { baseSpeed: 5, speedMultiplier: 1, canSprint: true, canJump: true },
        world,
        dt,
      );
    }
    expect(Math.hypot(state.velocity.x, state.velocity.z)).toBeCloseTo(5 * balance.player.sprintMultiplier, 1);
  });

  it('لا ينزل اللاعب تحت سطح الأرض', () => {
    const dt = 1 / 60;
    const state = motionAt(-100, 50);
    state.position.y += 60;
    state.grounded = false;
    for (let i = 0; i < 600; i++) {
      stepCharacter(
        state,
        command({ dt, seq: i }),
        { baseSpeed: 5, speedMultiplier: 1, canSprint: true, canJump: true },
        world,
        dt,
      );
      expect(state.position.y).toBeGreaterThanOrEqual(terrainHeight(state.position.x, state.position.z) - 0.01);
    }
    expect(state.grounded).toBe(true);
  });

  it('لا يخرج اللاعب من حدود الخريطة', () => {
    const dt = 1 / 60;
    const state = motionAt(MAP_HALF - 90, 0);
    for (let i = 0; i < 1200; i++) {
      stepCharacter(
        state,
        command({ dt, moveZ: 1, yaw: -Math.PI / 2, buttons: 16, seq: i }),
        { baseSpeed: 6.5, speedMultiplier: 1, canSprint: true, canJump: true },
        world,
        dt,
      );
    }
    expect(Math.abs(state.position.x)).toBeLessThanOrEqual(MAP_HALF);
  });

  it('القفز يرفع اللاعب ثم يعيده إلى الأرض', () => {
    const dt = 1 / 60;
    const state = motionAt(40, 40);
    const ground = state.position.y;
    stepCharacter(
      state,
      command({ dt, buttons: 4 }),
      { baseSpeed: 5, speedMultiplier: 1, canSprint: true, canJump: true },
      world,
      dt,
    );
    expect(state.velocity.y).toBeGreaterThan(0);
    for (let i = 0; i < 400; i++) {
      stepCharacter(
        state,
        command({ dt, seq: i + 2 }),
        { baseSpeed: 5, speedMultiplier: 1, canSprint: true, canJump: true },
        world,
        dt,
      );
    }
    expect(state.position.y).toBeCloseTo(ground - 0.2, 0);
  });

  it('نفس المدخلات تعطي نفس النتيجة (حتمية التنبؤ)', () => {
    const dt = 1 / 60;
    const run = (): PlayerMotionState => {
      const state = motionAt(-200, 120);
      for (let i = 0; i < 300; i++) {
        stepCharacter(
          state,
          command({ dt, moveX: 0.6, moveZ: 0.8, yaw: i * 0.01, seq: i }),
          { baseSpeed: 5.5, speedMultiplier: 1, canSprint: true, canJump: true },
          world,
          dt,
        );
      }
      return state;
    };
    expect(run().position).toEqual(run().position);
  });
});

describe('الأشعة وخط الرؤية / raycasting', () => {
  const world = new CollisionWorld();

  it('الشعاع المتجه للأسفل يصيب الأرض', () => {
    const origin = { x: 10, y: terrainHeight(10, 10) + 50, z: 10 };
    const hit = raycastWorld(origin, { x: 0, y: -1, z: 0 }, 200, world);
    expect(hit).not.toBeNull();
    expect(hit!.kind).toBe('terrain');
    expect(hit!.point.y).toBeCloseTo(terrainHeight(10, 10), 0);
  });

  it('الشعاع المتجه للسماء لا يصيب شيئًا', () => {
    const origin = { x: 10, y: terrainHeight(10, 10) + 5, z: 10 };
    expect(raycastWorld(origin, { x: 0, y: 1, z: 0 }, 500, world)).toBeNull();
  });

  it('خط الرؤية مفتوح فوق أرض مستوية ومحجوب داخل التضاريس', () => {
    const a = { x: 0, y: terrainHeight(0, 0) + 1.6, z: 0 };
    const b = { x: 20, y: terrainHeight(20, 0) + 1.6, z: 0 };
    expect(hasLineOfSight(a, b, world)).toBe(true);
    const underground = { x: 20, y: terrainHeight(20, 0) - 30, z: 0 };
    expect(hasLineOfSight(a, underground, world)).toBe(false);
  });
});

describe('شبكة التنقّل / navigation grid', () => {
  it('تجد مسارًا بين نقطتين سالكتين', () => {
    const grid = new NavGrid();
    const from = { x: -200, y: 0, z: -100 };
    const to = { x: 120, y: 0, z: 140 };
    const path = grid.findPath(from, to);
    expect(path.length).toBeGreaterThan(0);
    const last = path[path.length - 1]!;
    expect(Math.hypot(last.x - to.x, last.z - to.z)).toBeLessThan(20);
  });

  it('تعيد أقرب خلية سالكة عند البدء من مكان غير سالك', () => {
    const grid = new NavGrid();
    const cell = grid.nearestFree(MAP_HALF - 10, MAP_HALF - 10);
    expect(grid.isFree(cell.ix, cell.iz)).toBe(true);
  });
});

describe('المولّد العشوائي / deterministic rng', () => {
  it('نفس البذرة تعطي نفس التسلسل', () => {
    const a = new Rng(1234);
    const b = new Rng(1234);
    for (let i = 0; i < 50; i++) expect(a.next()).toBe(b.next());
  });

  it('القيم ضمن المدى المطلوب', () => {
    const rng = new Rng(99);
    for (let i = 0; i < 200; i++) {
      const value = rng.next();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
      expect(rng.int(0, 5)).toBeLessThan(5);
    }
  });
});
