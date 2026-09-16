/**
 * المحاكاة الموثوقة: شروط الفوز، القلعة الزاحفة، الآبار، القدرات، والأسلحة.
 * The authoritative simulation — win conditions, the crawler, wells, abilities, weapons.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  BotDirector,
  MatchSimulation,
  balance,
  duskLineX,
  explosionDamage,
  falloffMultiplier,
  hasLineOfSight,
  nominalDamage,
  resolveDamage,
  shotInterval,
  terrainHeight,
  type ClassKey,
  type SimEvent,
  type TeamId,
} from '@duskfront/shared';

function makeSim(options: Partial<{ mode: 'crawl' | 'shadowhunt'; durationSec: number }> = {}) {
  return new MatchSimulation({
    mode: options.mode ?? 'crawl',
    matchId: 'test',
    durationSec: options.durationSec ?? 120,
    seed: 4242,
  });
}

function addSquad(sim: MatchSimulation, perTeam = 2): void {
  const classes: ClassKey[] = ['guardian', 'sunshot', 'nightstalker', 'engineer'];
  for (const team of [0, 1] as TeamId[]) {
    for (let i = 0; i < perTeam; i++) {
      sim.addPlayer({
        id: `p${team}_${i}`,
        userId: `u${team}_${i}`,
        name: `P${team}${i}`,
        team,
        classKey: classes[i % classes.length]!,
      });
    }
  }
}

/** يتجاوز فترة التهيئة حتى تبدأ المباراة فعليًا. */
function runWarmup(sim: MatchSimulation): void {
  const step = 1 / balance.match.tickRate;
  while (sim.phase === 'warmup') sim.step(step);
}

describe('دورة حياة المباراة / match lifecycle', () => {
  it('تبدأ بالتهيئة ثم تنتقل إلى اللعب', () => {
    const sim = makeSim();
    addSquad(sim);
    expect(sim.phase).toBe('warmup');
    runWarmup(sim);
    expect(sim.phase).toBe('live');
    expect(sim.timeSec).toBeLessThan(1);
  });

  it('تنتهي عند نفاد الوقت لصالح الأعلى متانة', () => {
    const sim = makeSim({ durationSec: 20 });
    addSquad(sim);
    runWarmup(sim);
    sim.crawlers[1].integrity = 40;
    const step = 1 / balance.match.tickRate;
    for (let i = 0; i < 20 * balance.match.tickRate + 5 && sim.phase === 'live'; i++) sim.step(step);
    expect(sim.phase).toBe('ended');
    expect(sim.winnerTeam).toBe(0);
    expect(sim.winReason).toBe('integrity_lead');
  });

  it('تدمير النواة ينهي المباراة فورًا', () => {
    const sim = makeSim();
    addSquad(sim);
    runWarmup(sim);
    sim.crawlers[1].coreHealth = 0;
    sim.step(1 / balance.match.tickRate);
    expect(sim.phase).toBe('ended');
    expect(sim.winnerTeam).toBe(0);
    expect(sim.winReason).toBe('core_destroyed');
  });

  it('انهيار متانة القلعة ينهي المباراة', () => {
    const sim = makeSim();
    addSquad(sim);
    runWarmup(sim);
    sim.crawlers[0].integrity = 0;
    sim.step(1 / balance.match.tickRate);
    expect(sim.winnerTeam).toBe(1);
    expect(sim.winReason).toBe('crawler_destroyed');
  });

  it('وضع صيد الظلال ينتهي ببلوغ هدف القتلات', () => {
    const sim = makeSim({ mode: 'shadowhunt', durationSec: 600 });
    addSquad(sim);
    runWarmup(sim);
    sim.teamScore[0] = balance.match.shadowhunt.killTarget;
    sim.step(1 / balance.match.tickRate);
    expect(sim.phase).toBe('ended');
    expect(sim.winReason).toBe('kill_target');
  });
});

describe('القلعة الزاحفة / the crawling fortress', () => {
  it('تبقى داخل الشفق عندما تتبع خط الغسق', () => {
    const sim = makeSim({ durationSec: 200 });
    addSquad(sim);
    runWarmup(sim);
    const step = 1 / balance.match.tickRate;
    for (let i = 0; i < 150 * balance.match.tickRate; i++) sim.step(step);
    for (const crawler of sim.crawlers) {
      expect(crawler.zone).toBe('dusk');
      expect(crawler.integrity).toBe(balance.crawler.integrityMax);
    }
  });

  it('تتآكل متانتها خارج الشفق بعد مهلة السماح فقط', () => {
    const sim = makeSim({ durationSec: 600 });
    addSquad(sim);
    runWarmup(sim);
    const step = 1 / balance.match.tickRate;

    // ندفعها عميقًا داخل العتمة ونمنعها من العودة
    const crawler = sim.crawlers[0];
    const parked = duskLineX(sim.timeSec) + balance.dusk.bandWidth;
    crawler.position.x = parked;
    crawler.outsideSince = sim.timeSec;

    // قبل انتهاء المهلة: لا ضرر
    for (let i = 0; i < Math.floor(balance.crawler.outsideGraceSec * balance.match.tickRate) - 2; i++) {
      crawler.position.x = duskLineX(sim.timeSec) + balance.dusk.bandWidth;
      sim.step(step);
    }
    expect(crawler.integrity).toBeCloseTo(balance.crawler.integrityMax, 1);

    // بعدها: تتناقص بالمعدّل المنصوص عليه
    for (let i = 0; i < 5 * balance.match.tickRate; i++) {
      crawler.position.x = duskLineX(sim.timeSec) + balance.dusk.bandWidth;
      sim.step(step);
    }
    expect(crawler.integrity).toBeLessThan(balance.crawler.integrityMax);
    expect(crawler.integrity).toBeGreaterThan(balance.crawler.integrityMax - 6);
  });

  it('النواة محميّة حتى تهبط المتانة دون عتبة الكشف', () => {
    const sim = makeSim();
    addSquad(sim);
    runWarmup(sim);
    const crawler = sim.crawlers[1];

    crawler.integrity = balance.crawler.integrityMax;
    const before = crawler.coreHealth;
    sim.damageCrawler(1, 1000, null, true);
    const sealedLoss = before - crawler.coreHealth;

    crawler.coreHealth = balance.crawler.core.health;
    crawler.integrity = balance.crawler.core.exposedAfterIntegrity - 1;
    sim.damageCrawler(1, 1000, null, true);
    const exposedLoss = balance.crawler.core.health - crawler.coreHealth;

    expect(exposedLoss).toBeGreaterThan(sealedLoss);
    expect(sealedLoss).toBeCloseTo(1000 * balance.crawler.core.damageMultiplierWhenSealed, 1);
  });
});

describe('لومِن الفريق والآبار / team lumen and wells', () => {
  it('الوقوف قرب بئر يستولي عليه بعد المدة المحدّدة', () => {
    const sim = makeSim({ durationSec: 600 });
    sim.addPlayer({ id: 'a', userId: 'a', name: 'A', team: 0, classKey: 'guardian' });
    runWarmup(sim);
    const well = balance.wells.positions[0]!;
    const player = sim.getPlayer('a')!;
    const step = 1 / balance.match.tickRate;

    const captured: SimEvent[] = [];
    for (let i = 0; i < (balance.wells.captureSec + 1) * balance.match.tickRate; i++) {
      player.motion.position.x = well.x;
      player.motion.position.z = well.z;
      captured.push(...sim.step(step).filter((event) => event.type === 'well_captured'));
    }
    expect(captured.length).toBeGreaterThan(0);
    expect(sim.wells[0]!.owner).toBe(0);
    expect(player.stats.wellsCaptured).toBeGreaterThan(0);
  });

  it('البئر المملوك يولّد لومِن الفريق بالمعدّل المنصوص عليه', () => {
    const sim = makeSim({ durationSec: 600 });
    addSquad(sim, 1);
    runWarmup(sim);
    sim.wells[0]!.owner = 0;
    const before = sim.teamLumen[0];
    const step = 1 / balance.match.tickRate;
    for (let i = 0; i < balance.match.tickRate; i++) sim.step(step);
    expect(sim.teamLumen[0] - before).toBeCloseTo(balance.lumen.wellRatePerSec, 0);
  });

  it('إنفاق لومِن الفريق يخصم التكلفة ويرفض ما لا يُدفع', () => {
    const sim = makeSim();
    addSquad(sim, 1);
    runWarmup(sim);
    sim.teamLumen[0] = balance.lumen.spend.coreShield.cost;
    expect(sim.teamSpend(0, 'coreShield')).toBe(true);
    expect(sim.teamLumen[0]).toBe(0);
    expect(sim.crawlers[0].coreShieldUntil).toBeGreaterThan(sim.timeSec);
    expect(sim.teamSpend(0, 'coreShield')).toBe(false);
  });

  it('الإصلاح يرفع المتانة بالنسبة المعلنة', () => {
    const sim = makeSim();
    addSquad(sim, 1);
    runWarmup(sim);
    sim.crawlers[0].integrity = 50;
    sim.teamLumen[0] = balance.lumen.spend.crawlerRepair.cost;
    expect(sim.teamSpend(0, 'crawlerRepair')).toBe(true);
    expect(sim.crawlers[0].integrity).toBeCloseTo(50 + balance.lumen.spend.crawlerRepair.integrityPercent, 5);
  });
});

describe('القدرات / abilities', () => {
  it('المهندس ينشر مرآة ويدفع تكلفتها', () => {
    const sim = makeSim();
    sim.addPlayer({ id: 'e', userId: 'e', name: 'E', team: 0, classKey: 'engineer' });
    runWarmup(sim);
    const engineer = sim.getPlayer('e')!;
    engineer.lumen = balance.lumen.personalMax;

    const result = sim.requestAbility('e', { slot: 'q', aim: { x: 0, y: -0.2, z: -1 }, yaw: 0 });
    expect(result.accepted).toBe(true);
    expect(engineer.lumen).toBeCloseTo(
      balance.lumen.personalMax - balance.classes.engineer.abilities.q.lumenCost,
      5,
    );
    expect([...sim.structures.values()].filter((s) => s.kind === 'mirror')).toHaveLength(1);
    expect(engineer.stats.mirrorsPlaced).toBe(1);
  });

  it('لا يتجاوز المهندس الحد الأقصى للمرايا', () => {
    const sim = makeSim();
    sim.addPlayer({ id: 'e', userId: 'e', name: 'E', team: 0, classKey: 'engineer' });
    runWarmup(sim);
    const engineer = sim.getPlayer('e')!;
    for (let i = 0; i < balance.classes.engineer.abilities.q.maxActive + 3; i++) {
      engineer.lumen = balance.lumen.personalMax;
      engineer.abilities.q.readyAt = 0;
      sim.requestAbility('e', { slot: 'q', aim: { x: 0, y: -0.2, z: -1 }, yaw: i });
    }
    const mirrors = [...sim.structures.values()].filter((s) => s.kind === 'mirror');
    expect(mirrors.length).toBeLessThanOrEqual(balance.classes.engineer.abilities.q.maxActive);
  });

  it('التخفي يطول ×2 داخل العتمة', () => {
    const sim = makeSim({ durationSec: 600 });
    sim.addPlayer({ id: 'n', userId: 'n', name: 'N', team: 0, classKey: 'nightstalker' });
    runWarmup(sim);
    const stalker = sim.getPlayer('n')!;
    const cloak = balance.classes.nightstalker.abilities.q;

    stalker.zone = 'dusk';
    sim.requestAbility('n', { slot: 'q', aim: { x: 0, y: 0, z: -1 }, yaw: 0 });
    const normalDuration = stalker.cloakedUntil - sim.timeSec;

    stalker.cloakedUntil = 0;
    stalker.abilities.q.readyAt = 0;
    stalker.zone = 'dark';
    sim.requestAbility('n', { slot: 'q', aim: { x: 0, y: 0, z: -1 }, yaw: 0 });
    const darkDuration = stalker.cloakedUntil - sim.timeSec;

    expect(normalDuration).toBeCloseTo(cloak.durationSec, 3);
    expect(darkDuration).toBeCloseTo(cloak.durationSec * cloak.darkDurationMultiplier, 3);
  });

  it('الخارقة تتطلّب شحنًا كاملًا وتستهلكه', () => {
    const sim = makeSim();
    sim.addPlayer({ id: 'g', userId: 'g', name: 'G', team: 0, classKey: 'guardian' });
    runWarmup(sim);
    const guardian = sim.getPlayer('g')!;

    guardian.ultimateCharge = balance.ultimate.chargeTarget - 1;
    expect(sim.requestAbility('g', { slot: 'f', aim: { x: 0, y: 0, z: -1 }, yaw: 0 }).reason).toBe('not_charged');

    guardian.ultimateCharge = balance.ultimate.chargeTarget;
    expect(sim.requestAbility('g', { slot: 'f', aim: { x: 0, y: 0, z: -1 }, yaw: 0 }).accepted).toBe(true);
    expect(guardian.ultimateCharge).toBe(0);
  });

  it('مدة التبريد تمنع التكرار الفوري', () => {
    const sim = makeSim();
    sim.addPlayer({ id: 'g', userId: 'g', name: 'G', team: 0, classKey: 'guardian' });
    runWarmup(sim);
    expect(sim.requestAbility('g', { slot: 'q', aim: { x: 0, y: 0, z: -1 }, yaw: 0 }).accepted).toBe(true);
    expect(sim.requestAbility('g', { slot: 'q', aim: { x: 0, y: 0, z: -1 }, yaw: 0 }).reason).toBe('cooldown');
  });
});

describe('الأسلحة / weapons', () => {
  it('الأسلحة الشمسية تستهلك لومِن لا ذخيرة', () => {
    const sim = makeSim();
    sim.addPlayer({ id: 's', userId: 's', name: 'S', team: 0, classKey: 'sunshot' });
    runWarmup(sim);
    const shooter = sim.getPlayer('s')!;
    shooter.lumen = balance.lumen.personalMax;
    const eye = sim.eyePosition(shooter);

    const result = sim.requestFire('s', {
      seq: 1,
      origin: eye,
      direction: { x: 0, y: 0, z: -1 },
      chargeSec: 1.5,
      clientTimeMs: 0,
    });
    expect(result.accepted).toBe(true);
    expect(shooter.lumen).toBeCloseTo(
      balance.lumen.personalMax - balance.weapons.beam_rifle.lumenPerShot,
      5,
    );
  });

  it('يرفض الإطلاق من نقطة انطلاق بعيدة عن موضع اللاعب', () => {
    const sim = makeSim();
    sim.addPlayer({ id: 's', userId: 's', name: 'S', team: 0, classKey: 'sunshot' });
    runWarmup(sim);
    const shooter = sim.getPlayer('s')!;
    shooter.lumen = balance.lumen.personalMax;
    const result = sim.requestFire('s', {
      seq: 1,
      origin: { x: shooter.motion.position.x + 80, y: 0, z: 0 },
      direction: { x: 0, y: 0, z: -1 },
      chargeSec: 0,
      clientTimeMs: 0,
    });
    expect(result.accepted).toBe(false);
    expect(result.reason).toBe('origin_mismatch');
  });

  it('يحترم معدّل الإطلاق', () => {
    const sim = makeSim();
    sim.addPlayer({ id: 'n', userId: 'n', name: 'N', team: 0, classKey: 'nightstalker' });
    runWarmup(sim);
    const shooter = sim.getPlayer('n')!;
    const eye = sim.eyePosition(shooter);
    const fire = () =>
      sim.requestFire('n', { seq: 1, origin: eye, direction: { x: 0, y: 0, z: -1 }, chargeSec: 0, clientTimeMs: 0 });
    expect(fire().accepted).toBe(true);
    expect(fire().reason).toBe('cooldown');
    expect(shotInterval('kinetic_smg')).toBeCloseTo(1 / balance.weapons.kinetic_smg.fireRate, 6);
  });

  it('سقوط الضرر مع المسافة خطي بعد العتبة', () => {
    const range = balance.weapons.kinetic_dmr.range;
    const start = range * balance.player.falloffStartFraction;
    expect(falloffMultiplier('kinetic_dmr', start - 1)).toBe(1);
    expect(falloffMultiplier('kinetic_dmr', range)).toBeCloseTo(balance.player.falloffMinMultiplier, 5);
    const middle = falloffMultiplier('kinetic_dmr', (start + range) / 2);
    expect(middle).toBeLessThan(1);
    expect(middle).toBeGreaterThan(balance.player.falloffMinMultiplier);
  });

  it('مضاعف إصابة الرأس مطبّق', () => {
    const body = resolveDamage({ weapon: 'kinetic_dmr', distance: 1, region: 'body' });
    const head = resolveDamage({ weapon: 'kinetic_dmr', distance: 1, region: 'head' });
    expect(head / body).toBeCloseTo(balance.player.headshotMultiplier, 5);
  });

  it('شحن بندقية الشعاع يرفع الضرر بين الحدّين', () => {
    expect(nominalDamage('beam_rifle', 0)).toBeCloseTo(balance.weapons.beam_rifle.damageMin, 5);
    expect(nominalDamage('beam_rifle', 1)).toBeCloseTo(balance.weapons.beam_rifle.damageMax, 5);
  });

  it('ضرر الانفجار يتناقص من المركز إلى الحافة', () => {
    const g = balance.weapons.frag_grenade;
    expect(explosionDamage(0)).toBeCloseTo(g.damageCenter, 5);
    expect(explosionDamage(g.radius - 0.001)).toBeCloseTo(g.damageEdge, 1);
    expect(explosionDamage(g.radius + 1)).toBe(0);
  });
});

describe('الضرر والقتل / damage and death', () => {
  let sim: MatchSimulation;

  beforeEach(() => {
    sim = makeSim();
    addSquad(sim, 1);
    runWarmup(sim);
  });

  it('الدرع يمتصّ الضرر قبل الصحة', () => {
    const victim = sim.getPlayer('p1_0')!;
    const attacker = sim.getPlayer('p0_0')!;
    const health = victim.health;
    sim.damagePlayer(victim, 40, attacker, 'player', 'kinetic_dmr', false);
    expect(victim.shield).toBeLessThan(balance.player.shieldMax);
    expect(victim.health).toBe(health);
  });

  it('القتل يمنح القاتل نقاطًا ولومِن الفريق', () => {
    const victim = sim.getPlayer('p1_0')!;
    const attacker = sim.getPlayer('p0_0')!;
    const lumenBefore = sim.teamLumen[0];
    sim.damagePlayer(victim, 10_000, attacker, 'player', 'kinetic_dmr', false);
    expect(victim.alive).toBe(false);
    expect(attacker.stats.kills).toBe(1);
    expect(sim.teamScore[0]).toBe(1);
    expect(sim.teamLumen[0] - lumenBefore).toBeCloseTo(balance.lumen.killReward, 5);
  });

  it('اللاعب يعود بعد مدة الظهور', () => {
    const victim = sim.getPlayer('p1_0')!;
    sim.damagePlayer(victim, 10_000, null, 'player', 'kinetic_dmr', false);
    expect(victim.alive).toBe(false);
    const step = 1 / balance.match.tickRate;
    for (let i = 0; i < (balance.match.crawl.respawnSec + 1) * balance.match.tickRate; i++) sim.step(step);
    expect(victim.alive).toBe(true);
    expect(victim.health).toBe(victim.maxHealth);
  });

  it('قتل الحليف يخصم من رصيد القاتل', () => {
    const teammate = sim.getPlayer('p0_0')!;
    const other = sim.addPlayer({ id: 'x', userId: 'x', name: 'X', team: 0, classKey: 'guardian' });
    sim.damagePlayer(teammate, 10_000, other, 'player', 'kinetic_dmr', false);
    expect(other.stats.kills).toBe(-1);
  });
});

describe('البوتات / bots', () => {
  it('تتحرّك في الخريطة', () => {
    const sim = makeSim({ durationSec: 180 });
    const director = new BotDirector('normal', 77);
    const classes: ClassKey[] = ['guardian', 'sunshot', 'nightstalker', 'engineer'];
    for (const team of [0, 1] as TeamId[]) {
      for (let i = 0; i < 3; i++) {
        sim.addPlayer({
          id: `b${team}_${i}`,
          userId: `b${team}_${i}`,
          name: `B${team}${i}`,
          team,
          classKey: classes[i % classes.length]!,
          isBot: true,
        });
      }
    }
    runWarmup(sim);
    const start = sim.snapshot().players.map((p) => ({ ...p.position }));
    const step = 1 / balance.match.tickRate;
    for (let i = 0; i < 120 * balance.match.tickRate; i++) {
      director.update(sim, step);
      sim.step(step);
    }
    const end = sim.snapshot().players.map((p) => ({ ...p.position }));
    const moved = start.some(
      (position, index) => Math.hypot(position.x - end[index]!.x, position.z - end[index]!.z) > 25,
    );
    expect(moved).toBe(true);
  });

  it('تشتبك فعليًا عندما يلتقي الفريقان', () => {
    const sim = makeSim({ durationSec: 300 });
    const director = new BotDirector('hard', 91);
    for (const team of [0, 1] as TeamId[]) {
      for (let i = 0; i < 2; i++) {
        sim.addPlayer({
          id: `b${team}_${i}`,
          userId: `b${team}_${i}`,
          name: `B${team}${i}`,
          team,
          classKey: 'guardian',
          isBot: true,
        });
      }
    }
    runWarmup(sim);

    /*
      نضع الفريقين وجهًا لوجه داخل شريط الشفق بدل انتظار أن يلتقيا بالمصادفة عبر
      خريطة 1600م — الهدف اختبار منطق الاشتباك لا حظّ التجوال. الإزاحة +40 تبقيهما
      داخل حدود الخريطة عند بداية المباراة حيث يقف خط الغسق على الحافة الغربية.
    */
    const line = duskLineX(sim.timeSec) + 40;
    let index = 0;
    for (const player of sim.players.values()) {
      const offset = player.team === 0 ? -16 : 16;
      player.motion.position.x = line + offset;
      player.motion.position.z = (index % 2) * 5;
      player.motion.position.y = terrainHeight(player.motion.position.x, player.motion.position.z) + 0.2;
      player.motion.yaw = player.team === 0 ? -Math.PI / 2 : Math.PI / 2;
      index++;
    }
    expect(
      hasLineOfSight(
        { x: line - 16, y: terrainHeight(line - 16, 0) + 1.6, z: 0 },
        { x: line + 16, y: terrainHeight(line + 16, 0) + 1.1, z: 0 },
        sim.world,
      ),
    ).toBe(true);

    const step = 1 / balance.match.tickRate;
    let shots = 0;
    let hits = 0;
    for (let i = 0; i < 30 * balance.match.tickRate; i++) {
      director.update(sim, step);
      for (const event of sim.step(step)) {
        if (event.type === 'shot') shots++;
        if (event.type === 'hit') hits++;
      }
    }
    expect(shots).toBeGreaterThan(0);
    expect(hits).toBeGreaterThan(0);
  });

  it('لا تبقى عالقة خارج شريط الشفق حتى تموت', () => {
    const sim = makeSim({ durationSec: 300 });
    const director = new BotDirector('normal', 13);
    for (let i = 0; i < 4; i++) {
      sim.addPlayer({
        id: `b${i}`,
        userId: `b${i}`,
        name: `B${i}`,
        team: (i % 2) as TeamId,
        classKey: 'guardian',
        isBot: true,
      });
    }
    runWarmup(sim);
    const step = 1 / balance.match.tickRate;
    for (let i = 0; i < 250 * balance.match.tickRate; i++) {
      director.update(sim, step);
      sim.step(step);
    }
    const line = duskLineX(sim.timeSec);
    for (const player of sim.players.values()) {
      if (!player.alive) continue;
      // تبقى ضمن ممر معقول حول خط الغسق
      expect(Math.abs(player.motion.position.x - line)).toBeLessThan(500);
    }
  });
});
