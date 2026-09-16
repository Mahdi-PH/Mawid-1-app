/**
 * البوتات: شجرة سلوك واعية بالضوء.
 * Light-aware bots. They treat the dusk band as terrain: they flee the sun before it
 * cooks them, hunt in the dark when they are night-stalkers, and engineers aim their
 * mirrors at the darkness where cloaked enemies hide.
 */
import { balance, botBalance, classBalance } from '../balance.js';
import { distanceToDuskEdge, duskLineX, zoneAtX } from '../dusk.js';
import { clamp, clamp01, directionFromAngles, distance3 } from '../math.js';
import { hasLineOfSight } from '../physics.js';
import { Rng } from '../rng.js';
import { MAP_HALF, clampToMap, terrainHeight } from '../terrain.js';
import {
  InputButton,
  type Difficulty,
  type InputCommand,
  type TeamId,
  type Vec3,
} from '../types.js';
import { canFire, magazineSize, weaponRange } from '../weapons.js';
import { Action, Condition, Selector, Sequence, type BTNode, type NodeStatus } from './behavior-tree.js';
import { getNavGrid, type NavGrid } from './navgrid.js';
import type { MatchSimulation } from './simulation.js';
import type { SimPlayer } from './state.js';

const B = balance.bots;
const P = balance.player;
const Z = balance.zones;

interface BotBlackboard {
  path: Vec3[];
  pathIndex: number;
  repathAt: number;
  targetId: string | null;
  targetSeenAt: number;
  targetLastPos: Vec3 | null;
  reactionReadyAt: number;
  desiredYaw: number;
  desiredPitch: number;
  wantsFire: boolean;
  wantsJump: boolean;
  wantsSprint: boolean;
  wantsCrouch: boolean;
  strafe: number;
  strafeUntil: number;
  objective: Vec3 | null;
  objectiveKind: 'well' | 'crawler_escort' | 'enemy_crawler' | 'shade' | 'regroup' | 'hunt' | 'none';
  nextAbilityAt: Record<'q' | 'e' | 'f', number>;
  seq: number;
  /** كشف التعثّر: آخر موضع وزمن قياسه */
  lastPos: Vec3 | null;
  lastProgressAt: number;
  unstickUntil: number;
}

interface BotContext {
  sim: MatchSimulation;
  bot: SimPlayer;
  bb: BotBlackboard;
  nav: NavGrid;
  dt: number;
  now: number;
  tuning: ReturnType<typeof botBalance>;
  rng: Rng;
  enemies: SimPlayer[];
  visibleEnemies: SimPlayer[];
  intel: Map<string, EnemyIntel>;
}

/** معلومة استخبارية يتشاركها الفريق عن عدوّ شوهد مؤخرًا. */
interface EnemyIntel {
  position: Vec3;
  at: number;
}

/** يدير كل بوتات المباراة / drives every bot in a simulation. */
export class BotDirector {
  private readonly blackboards = new Map<string, BotBlackboard>();
  private readonly nav = getNavGrid();
  private readonly rng: Rng;
  private readonly tree: BTNode<BotContext>;
  private difficulty: Difficulty;
  /** ما يعرفه كل فريق عن مواقع الأعداء (تنسيق البوتات) / per-team shared sightings. */
  private readonly intel: [Map<string, EnemyIntel>, Map<string, EnemyIntel>] = [new Map(), new Map()];

  constructor(difficulty: Difficulty = 'normal', seed = 1337) {
    this.difficulty = difficulty;
    this.rng = new Rng(seed);
    this.tree = buildTree();
  }

  setDifficulty(difficulty: Difficulty): void {
    this.difficulty = difficulty;
  }

  /** حدّث كل البوتات وأرسل مدخلاتها إلى المحاكاة. */
  update(sim: MatchSimulation, dt: number): void {
    const now = sim.timeSec;

    // 0) اللاعبون البشريون يُرصدون أيضًا: كل ما يراه أي عضو في الفريق يصبح معلومة مشتركة
    for (const observer of sim.players.values()) {
      if (!observer.isBot || !observer.alive) continue;
      const book = this.intel[observer.team];
      for (const other of sim.players.values()) {
        if (other.team === observer.team || !other.alive) continue;
        if (canSee(sim, observer, other)) {
          book.set(other.id, { position: { ...other.motion.position }, at: now });
        }
      }
    }
    for (const book of this.intel) {
      for (const [id, entry] of book) if (now - entry.at > 20) book.delete(id);
    }

    for (const bot of sim.players.values()) {
      if (!bot.isBot) continue;
      if (!bot.alive) continue;
      const bb = this.blackboard(bot.id);
      const enemies: SimPlayer[] = [];
      for (const other of sim.players.values()) {
        if (other.team !== bot.team && other.alive) enemies.push(other);
      }
      const ctx: BotContext = {
        sim,
        bot,
        bb,
        nav: this.nav,
        dt,
        now,
        tuning: botBalance(bot.botDifficulty ?? this.difficulty),
        rng: this.rng,
        enemies,
        visibleEnemies: enemies.filter((e) => canSee(sim, bot, e)),
        intel: this.intel[bot.team],
      };
      this.detectStuck(ctx);
      if (now < bb.unstickUntil) {
        // في وضع فكّ التعثّر نتجاهل الشجرة ونكمل مسار الهروب
        faceMovement(ctx);
      } else {
        this.tree.tick(ctx);
      }
      this.emitInput(ctx);
    }
  }

  /**
   * كشف التعثّر والتعافي منه.
   * A bot wedged against geometry would otherwise stand still while the dusk line
   * slides past it and the sun cooks it, so watch real displacement, not intent.
   */
  private detectStuck(ctx: BotContext): void {
    const { bot, bb, now, sim } = ctx;
    const pos = bot.motion.position;
    if (!bb.lastPos) {
      bb.lastPos = { ...pos };
      bb.lastProgressAt = now;
      return;
    }
    const moved = Math.hypot(pos.x - bb.lastPos.x, pos.z - bb.lastPos.z);
    if (moved > 1.2) {
      bb.lastPos = { ...pos };
      bb.lastProgressAt = now;
      return;
    }
    if (now - bb.lastProgressAt < 2.5) return;
    if (now < bb.unstickUntil) return;

    // تعثّر مؤكّد: اقفز واتجه شرقًا (مع خط الغسق) إلى نقطة قريبة سالكة
    bb.unstickUntil = now + 1.6;
    bb.wantsJump = true;
    bb.path = [];
    bb.pathIndex = 0;
    bb.repathAt = 0;
    const angle = ctx.rng.range(-Math.PI / 2, Math.PI / 2);
    const east = duskLineX(sim.timeSec) > pos.x ? 1 : -1;
    const dist = ctx.rng.range(18, 34);
    const target = clampToMap(pos.x + Math.cos(angle) * dist * east, pos.z + Math.sin(angle) * dist);
    bb.path = [{ x: target.x, y: terrainHeight(target.x, target.z), z: target.z }];
    bb.lastPos = { ...pos };
    bb.lastProgressAt = now;
  }

  /** آخر موقع معروف لعدوّ لدى فريق (للاختبارات والواجهة التكتيكية). */
  knownEnemies(team: TeamId): { id: string; position: Vec3; at: number }[] {
    return [...this.intel[team].entries()].map(([id, e]) => ({ id, position: e.position, at: e.at }));
  }

  private blackboard(id: string): BotBlackboard {
    let bb = this.blackboards.get(id);
    if (!bb) {
      bb = {
        path: [],
        pathIndex: 0,
        repathAt: 0,
        targetId: null,
        targetSeenAt: -999,
        targetLastPos: null,
        reactionReadyAt: 0,
        desiredYaw: 0,
        desiredPitch: 0,
        wantsFire: false,
        wantsJump: false,
        wantsSprint: false,
        wantsCrouch: false,
        strafe: 0,
        strafeUntil: 0,
        objective: null,
        objectiveKind: 'none',
        nextAbilityAt: { q: 0, e: 0, f: 0 },
        seq: 1,
        lastPos: null,
        lastProgressAt: 0,
        unstickUntil: 0,
      };
      this.blackboards.set(id, bb);
    }
    return bb;
  }

  /** يحوّل قرارات الشجرة إلى أمر إدخال حقيقي يمرّ بنفس مسار اللاعب البشري. */
  private emitInput(ctx: BotContext): void {
    const { bot, bb, dt, sim } = ctx;
    const pos = bot.motion.position;

    // 1) التوجّه نحو نقطة الطريق التالية
    let moveX = 0;
    let moveZ = 0;
    const waypoint = bb.path[bb.pathIndex];
    if (waypoint) {
      const dx = waypoint.x - pos.x;
      const dz = waypoint.z - pos.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 4) {
        bb.pathIndex++;
      } else {
        const moveYaw = Math.atan2(-dx, -dz);
        const rel = moveYaw - bb.desiredYaw;
        moveZ = Math.cos(rel);
        moveX = -Math.sin(rel);
      }
    }

    // 2) مناورة جانبية أثناء القتال
    if (bb.targetId && ctx.now < bb.strafeUntil) {
      moveX = clamp(moveX + bb.strafe, -1, 1);
    }

    const buttons =
      (bb.wantsSprint && !bb.targetId ? InputButton.Sprint : 0) |
      (bb.wantsCrouch ? InputButton.Crouch : 0) |
      (bb.wantsJump ? InputButton.Jump : 0) |
      (bb.targetId ? InputButton.Aim : 0);

    const command: InputCommand = {
      seq: bb.seq++,
      dt,
      moveX,
      moveZ,
      yaw: bb.desiredYaw,
      pitch: bb.desiredPitch,
      buttons,
      clientTimeMs: ctx.now * 1000,
    };
    sim.enqueueInput(bot.id, command);
    bb.wantsJump = false;

    // 3) الإطلاق يمرّ عبر نفس بوابة الخادم
    if (bb.wantsFire && ctx.now >= bb.reactionReadyAt) {
      const gate = canFire({
        weapon: bot.weapon.key,
        nowSec: ctx.now,
        nextFireAt: bot.weapon.nextFireAt,
        magazine: bot.weapon.magazine,
        lumen: bot.lumen,
        reloading: bot.weapon.reloadEndsAt > 0,
        zone: bot.zone,
        solarChargeMultiplier: 1,
      });
      if (gate.allowed) {
        const eye = sim.eyePosition(bot);
        const spreadJitter = (ctx.tuning.aimErrorDeg * Math.PI) / 180;
        const yaw = bb.desiredYaw + ctx.rng.gaussian(0, spreadJitter * 0.5);
        const pitch = bb.desiredPitch + ctx.rng.gaussian(0, spreadJitter * 0.5);
        const dir = directionFromAngles(yaw, pitch);
        sim.requestFire(bot.id, {
          seq: command.seq,
          origin: eye,
          direction: dir,
          chargeSec: bot.weapon.key === 'beam_rifle' ? balance.weapons.beam_rifle.chargeSecMax : 0,
          clientTimeMs: ctx.now * 1000,
        });
      } else if (gate.reason === 'no_ammo') {
        sim.requestReload(bot.id);
      }
    }
    bb.wantsFire = false;
  }
}

// ───────────────────────────── الإدراك / perception ──────────────────────────

function canSee(sim: MatchSimulation, viewer: SimPlayer, target: SimPlayer): boolean {
  if (!target.alive) return false;
  const eye = sim.eyePosition(viewer);
  const targetCenter = {
    x: target.motion.position.x,
    y: target.motion.position.y + P.height * 0.6,
    z: target.motion.position.z,
  };
  const dist = distance3(eye, targetCenter);
  if (dist > B.visionRange) return false;

  // الخفاء والعتمة يقلّلان مدى الكشف
  if (target.cloakedUntil > sim.timeSec && !(target.markedUntil > sim.timeSec)) {
    if (dist > P.interactRange * 2) return false;
  }
  if (target.zone === 'dark' && target.light < balance.light.revealThreshold) {
    if (dist > Z.dark.nameplateRange * 2.2 && !(target.markedUntil > sim.timeSec)) return false;
  }

  // إدراك محيطي: العدو القريب جدًا يُلاحَظ حتى خارج مخروط الرؤية (صوت خطى/إطلاق)
  const peripheral = dist <= B.visionRange * 0.3;
  if (!peripheral) {
    const forward = directionFromAngles(viewer.motion.yaw, viewer.motion.pitch);
    const toTarget = {
      x: (targetCenter.x - eye.x) / dist,
      y: (targetCenter.y - eye.y) / dist,
      z: (targetCenter.z - eye.z) / dist,
    };
    const cosAngle = forward.x * toTarget.x + forward.y * toTarget.y + forward.z * toTarget.z;
    if (cosAngle < Math.cos((B.fovDeg * Math.PI) / 360)) return false;
  }

  return hasLineOfSight(eye, targetCenter, sim.world);
}

// ───────────────────────────── بناء الشجرة / tree ────────────────────────────

function buildTree(): BTNode<BotContext> {
  return new Selector<BotContext>('root', [
    // 1) الأولوية القصوى: الخروج من بيئة تقتلنا الآن ونحن ضعفاء أو بلا اشتباك
    new Sequence('survive_environment', [
      new Condition('environment_is_lethal', isEnvironmentLethal),
      new Action('seek_safe_band', seekSafeBand),
    ]),
    new Sequence('retreat_when_hurt', [
      new Condition('badly_hurt', (c) => c.bot.health < c.bot.maxHealth * 0.28 && c.visibleEnemies.length > 0),
      new Action('retreat', retreat),
    ]),
    // 2) القتال يسبق الراحة: البقاء في السطوع ثمن مقبول مقابل قتلة
    new Sequence('fight', [
      new Condition('has_target', acquireTarget),
      new Action('engage', engage),
    ]),
    // 3) المهندس ينشر بنيته حتى خارج الاشتباك
    new Sequence('deploy_support', [
      new Condition('is_engineer_ready', (c) => c.bot.classKey === 'engineer' && c.now >= c.bb.nextAbilityAt.q),
      new Action('deploy', deploySupport),
    ]),
    // 4) تجنّب استباقي للحرارة/البرد قبل أن تتحوّل إلى ضرر
    new Sequence('avoid_environment', [
      new Condition('environment_is_uncomfortable', isEnvironmentUncomfortable),
      new Action('drift_to_safety', seekSafeBand),
    ]),
    new Sequence('hunt_known_enemy', [
      new Condition('team_has_intel', hasFreshIntel),
      new Action('hunt', huntKnownEnemy),
    ]),
    new Sequence('objective', [
      new Condition('has_objective', pickObjective),
      new Action('advance', advanceToObjective),
    ]),
    new Action('wander', wander),
  ]);
}

// ───────────────────────────── السلوكيات / behaviours ────────────────────────

/** البيئة تقتلنا فعلًا الآن، ولا يوجد سبب أقوى للبقاء. */
function isEnvironmentLethal(ctx: BotContext): boolean {
  const { bot } = ctx;
  const burning = bot.zone === 'bright' && bot.heat > Z.bright.heatGraceSec;
  const freezing = bot.zone === 'dark' && bot.cold > Z.dark.coldGraceSec;
  if (!burning && !freezing) return false;
  // مع وجود عدو مرئي وصحة جيدة، يستمر القتال ويتحمّل الضرر
  if (ctx.visibleEnemies.length > 0 && bot.health > bot.maxHealth * 0.5) return false;
  return true;
}

/** اقتربنا من عتبة الضرر البيئي: تحرّك الآن بدل أن ننتظر. */
function isEnvironmentUncomfortable(ctx: BotContext): boolean {
  const { bot } = ctx;
  // نتحرّك عند منتصف مهلة الأمان، لا عند حافتها: العودة إلى الشفق تستغرق وقتًا
  if (bot.zone === 'bright') return bot.heat > Z.bright.heatGraceSec * 0.35;
  if (bot.zone === 'dark') {
    // المتسلل الليلي يتحمّل العتمة أطول لأنها ملعبه
    const factor = bot.classKey === 'nightstalker' ? 0.75 : 0.35;
    return bot.cold > Z.dark.coldGraceSec * factor;
  }
  return false;
}

/** نشر المرايا وأبراج الظل خارج الاشتباك (سلوك المهندس الأساسي). */
function deploySupport(ctx: BotContext): NodeStatus {
  const { sim, bot, bb, now } = ctx;
  const mine = [...sim.structures.values()].filter((s) => s.ownerId === bot.id);
  const mirrors = mine.filter((s) => s.kind === 'mirror').length;
  const towers = mine.filter((s) => s.kind === 'shadow_tower').length;

  // مرآة موجّهة نحو العتمة تكشف المتخفّين وتشحن الحلفاء
  if (mirrors < balance.classes.engineer.abilities.q.maxActive && bot.lumen >= balance.classes.engineer.abilities.q.lumenCost) {
    const towardDark = 1;
    const yaw = Math.atan2(-towardDark, 0);
    const res = sim.requestAbility(bot.id, { slot: 'q', aim: directionFromAngles(bb.desiredYaw, -0.35), yaw });
    bb.nextAbilityAt.q = now + (res.accepted ? 4 : 2);
    if (res.accepted) return 'success';
  }

  // برج ظل عند الحاجة للاحتماء من الشمس
  if (
    bot.zone === 'bright' &&
    towers < balance.classes.engineer.abilities.e.maxActive &&
    now >= bb.nextAbilityAt.e &&
    bot.lumen >= balance.classes.engineer.abilities.e.lumenCost
  ) {
    const res = sim.requestAbility(bot.id, { slot: 'e', aim: directionFromAngles(bb.desiredYaw, -0.4), yaw: bb.desiredYaw });
    bb.nextAbilityAt.e = now + (res.accepted ? 6 : 2);
    if (res.accepted) return 'success';
  }

  return 'failure';
}

/** يتجه نحو أقرب أمان: ظل صناعي، جيب ضوء، أو شريط الشفق. */
function seekSafeBand(ctx: BotContext): NodeStatus {
  const { bot, sim, bb } = ctx;
  const pos = bot.motion.position;

  // 1) أقرب بنية مفيدة (برج ظل إن كنا نحترق، مرآة إن كنا نتجمّد)
  const wantShade = bot.zone === 'bright';
  let best: Vec3 | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const s of sim.structures.values()) {
    const useful = wantShade ? s.kind === 'shadow_tower' : s.kind === 'mirror' || s.kind === 'dawn_wall';
    if (!useful) continue;
    // ملاذ قريب فقط: البنية التي تبعد أكثر من ذلك قد تختفي قبل الوصول
    const d = distance3(pos, s.position);
    if (d < bestDist && d < 60) {
      best = s.position;
      bestDist = d;
    }
  }

  if (!best) {
    // 2) اتجه عموديًا نحو شريط الشفق
    const duskX = duskLineX(sim.timeSec);
    const target = clampToMap(duskX + (wantShade ? 40 : -40), pos.z);
    best = { x: target.x, y: terrainHeight(target.x, target.z), z: target.z };
  }

  bb.objectiveKind = 'shade';
  bb.objective = best;
  bb.wantsSprint = true;
  setPath(ctx, best);
  faceMovement(ctx);
  return 'running';
}

function retreat(ctx: BotContext): NodeStatus {
  const { bot, sim, bb } = ctx;
  const threat = ctx.visibleEnemies[0];
  const pos = bot.motion.position;
  let away: Vec3;
  if (sim.mode === 'crawl') {
    away = sim.crawlers[bot.team].position;
  } else if (threat) {
    const dx = pos.x - threat.motion.position.x;
    const dz = pos.z - threat.motion.position.z;
    const len = Math.hypot(dx, dz) || 1;
    const c = clampToMap(pos.x + (dx / len) * 70, pos.z + (dz / len) * 70);
    away = { x: c.x, y: terrainHeight(c.x, c.z), z: c.z };
  } else {
    away = pos;
  }
  bb.wantsSprint = true;
  bb.objectiveKind = 'regroup';
  setPath(ctx, away);
  // ينظر للخلف أحيانًا ليطلق النار أثناء الانسحاب
  if (threat && ctx.rng.next() < 0.35) faceTarget(ctx, threat);
  else faceMovement(ctx);
  return 'running';
}

function acquireTarget(ctx: BotContext): boolean {
  const { bb, bot, now } = ctx;
  const visible = ctx.visibleEnemies;
  if (visible.length === 0) {
    // نتذكّر آخر موقع للهدف لفترة قصيرة
    if (bb.targetId && now - bb.targetSeenAt < 3) return true;
    bb.targetId = null;
    bb.targetLastPos = null;
    return false;
  }

  let best = visible[0]!;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const enemy of visible) {
    const d = distance3(bot.motion.position, enemy.motion.position);
    // الأقرب والأضعف أولوية، والمُعلَّم أولوية أعلى
    const score = d * (enemy.markedUntil > now ? 0.5 : 1) * (enemy.health / enemy.maxHealth + 0.4);
    if (score < bestScore) {
      bestScore = score;
      best = enemy;
    }
  }

  if (bb.targetId !== best.id) {
    bb.targetId = best.id;
    bb.reactionReadyAt = now + ctx.tuning.reactionMs / 1000;
  }
  bb.targetSeenAt = now;
  bb.targetLastPos = { ...best.motion.position };
  return true;
}

function engage(ctx: BotContext): NodeStatus {
  const { sim, bot, bb, now } = ctx;
  const target = bb.targetId ? sim.getPlayer(bb.targetId) : null;
  const aimAt = target?.alive ? target.motion.position : bb.targetLastPos;
  if (!aimAt) return 'failure';

  const dist = distance3(bot.motion.position, aimAt);
  const range = weaponRange(bot.weapon.key);

  // 1) توجيه النظر مع خطأ تصويب حسب الصعوبة
  if (target?.alive) faceTarget(ctx, target);
  else faceAt(ctx, aimAt);

  // 2) الحركة القتالية: اقترب إذا بعيد، ناور إذا قريب
  if (dist > range * 0.75) {
    setPath(ctx, aimAt);
  } else {
    bb.path = [];
    bb.pathIndex = 0;
    if (now > bb.strafeUntil) {
      bb.strafe = ctx.rng.next() < 0.5 ? -1 : 1;
      bb.strafeUntil = now + ctx.rng.range(0.5, 1.4);
    }
  }
  bb.wantsSprint = false;
  bb.wantsCrouch = dist > range * 0.6 && ctx.tuning.burstAccuracy > 0.6 && bot.motion.grounded;

  // 3) إعادة التعبئة قبل الاشتباك القريب
  const mag = magazineSize(bot.weapon.key);
  if (mag > 0 && bot.weapon.magazine <= mag * 0.15 && dist > 12) {
    sim.requestReload(bot.id);
  }

  // 4) استخدام القدرات
  useAbilities(ctx, target ?? null, dist);

  // 5) قرار الإطلاق
  const inRange = dist <= range;
  const wantsShoot = inRange && !!target?.alive && ctx.rng.next() < ctx.tuning.burstAccuracy;
  bb.wantsFire = wantsShoot;
  return 'running';
}

function useAbilities(ctx: BotContext, target: SimPlayer | null, dist: number): void {
  const { sim, bot, bb, now } = ctx;
  const cls = classBalance(bot.classKey);
  const aim = directionFromAngles(bb.desiredYaw, bb.desiredPitch);

  const tryAbility = (slot: 'q' | 'e' | 'f'): boolean => {
    if (now < bb.nextAbilityAt[slot]) return false;
    const res = sim.requestAbility(bot.id, { slot, aim, yaw: bb.desiredYaw });
    bb.nextAbilityAt[slot] = now + (res.accepted ? 0.6 : 1.5);
    return res.accepted;
  };

  // الخارقة عند توفّر الشحن وهدف واضح
  if (bot.ultimateCharge >= balance.ultimate.chargeTarget && (target || bot.classKey === 'engineer')) {
    if (ctx.rng.next() < ctx.tuning.coordination) tryAbility('f');
  }

  switch (bot.classKey) {
    case 'guardian':
      if (target && dist < 16 && ctx.rng.next() < 0.35) tryAbility('e');
      if (target && bot.health < bot.maxHealth * 0.6) tryAbility('q');
      break;
    case 'sunshot':
      if (target && dist > 30 && ctx.rng.next() < 0.4) tryAbility('q');
      if (!target && bot.motion.grounded && ctx.rng.next() < 0.05) tryAbility('e');
      break;
    case 'nightstalker':
      if (bot.health < bot.maxHealth * 0.45) tryAbility('q');
      if (target && dist < 20 && bot.zone !== 'dark' && ctx.rng.next() < 0.25) tryAbility('e');
      break;
    case 'engineer': {
      // المهندس ينشر المرايا نحو العتمة حيث يختبئ المتخفّون
      const towardDark = duskLineX(sim.timeSec) + balance.dusk.bandWidth;
      const facingDark = bot.motion.position.x < towardDark;
      if (facingDark && ctx.rng.next() < 0.22) {
        const yaw = Math.atan2(-(towardDark - bot.motion.position.x), 0);
        const res = sim.requestAbility(bot.id, { slot: 'q', aim: directionFromAngles(yaw, -0.25), yaw });
        if (res.accepted) bb.nextAbilityAt.q = now + 2;
      }
      if (bot.zone === 'bright' && bot.heat > Z.bright.heatGraceSec * 0.5) tryAbility('e');
      break;
    }
    default:
      break;
  }
  void cls;
}

/** هل لدى الفريق رصد حديث لعدوّ قريب؟ */
function hasFreshIntel(ctx: BotContext): boolean {
  const { intel, now, bot, tuning } = ctx;
  if (ctx.rng.next() > tuning.coordination) return false;
  let best: EnemyIntel | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const entry of intel.values()) {
    if (now - entry.at > 12) continue;
    const d = distance3(bot.motion.position, entry.position);
    if (d < bestDist && d < 420) {
      bestDist = d;
      best = entry;
    }
  }
  if (!best) return false;
  ctx.bb.objective = { ...best.position };
  ctx.bb.objectiveKind = 'hunt';
  return true;
}

function huntKnownEnemy(ctx: BotContext): NodeStatus {
  const { bb } = ctx;
  if (!bb.objective) return 'failure';
  setPath(ctx, bb.objective);
  faceMovement(ctx);
  bb.wantsSprint = true;
  return 'running';
}

function pickObjective(ctx: BotContext): boolean {
  const { sim, bot, bb, now } = ctx;
  if (bb.objective && bb.objectiveKind !== 'none' && now < bb.repathAt) return true;

  const pos = bot.motion.position;
  const roll = ctx.rng.next();

  if (sim.mode === 'crawl') {
    const ourCrawler = sim.crawlers[bot.team];
    const enemyCrawler = sim.crawlers[(1 - bot.team) as TeamId];

    // إن كانت قلعتنا خارج الشفق فالأولوية القصوى للعودة إليها
    if (ourCrawler.zone !== 'dusk' || ourCrawler.integrity < balance.crawler.integrityMax * 0.5) {
      bb.objectiveKind = 'crawler_escort';
      bb.objective = { ...ourCrawler.position };
      bb.repathAt = now + B.repathSec;
      return true;
    }
    if (roll < B.crawlerPriority * 0.4) {
      bb.objectiveKind = 'enemy_crawler';
      bb.objective = { ...enemyCrawler.position };
      bb.repathAt = now + B.repathSec * 3;
      return true;
    }
  }

  // الآبار: نوازن بين القرب منّا والقرب من شريط الشفق، فيتنازع الفريقان البئر نفسه
  const duskNow = duskLineX(sim.timeSec);
  let bestWell: Vec3 | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const well of sim.wells) {
    if (well.owner === bot.team) continue;
    const toUs = Math.hypot(well.position.x - pos.x, well.position.z - pos.z);
    const toDusk = Math.abs(well.position.x - duskNow);
    const score = toUs * 0.45 + toDusk * 1.35;
    if (score < bestDist) {
      bestDist = score;
      bestWell = { x: well.position.x, y: terrainHeight(well.position.x, well.position.z), z: well.position.z };
    }
  }
  if (bestWell && roll < B.wellPriority + 0.35) {
    bb.objectiveKind = 'well';
    bb.objective = bestWell;
    bb.repathAt = now + B.repathSec * 2;
    return true;
  }

  if (sim.mode !== 'crawl') {
    // في «صيد الظلال» اتجه نحو مركز الخريطة والتحام
    const c = clampToMap(ctx.rng.range(-200, 200), ctx.rng.range(-200, 200));
    bb.objectiveKind = 'regroup';
    bb.objective = { x: c.x, y: terrainHeight(c.x, c.z), z: c.z };
    bb.repathAt = now + B.repathSec * 3;
    return true;
  }

  bb.objectiveKind = 'crawler_escort';
  bb.objective = { ...sim.crawlers[bot.team].position };
  bb.repathAt = now + B.repathSec * 2;
  return true;
}

function advanceToObjective(ctx: BotContext): NodeStatus {
  const { bb } = ctx;
  if (!bb.objective) return 'failure';
  // تجنّب المشي داخل السطوع أو العتمة إن أمكن
  const safe = biasTowardDusk(ctx, bb.objective);
  setPath(ctx, safe);
  faceMovement(ctx);
  bb.wantsSprint = true;
  return 'running';
}

function wander(ctx: BotContext): NodeStatus {
  const { bot, bb, now, sim } = ctx;
  if (bb.path.length === 0 || bb.pathIndex >= bb.path.length || now > bb.repathAt) {
    const duskX = duskLineX(sim.timeSec);
    const x = clamp(duskX + ctx.rng.range(-120, 120), -MAP_HALF + 90, MAP_HALF - 90);
    const z = clamp(bot.motion.position.z + ctx.rng.range(-160, 160), -MAP_HALF + 90, MAP_HALF - 90);
    setPath(ctx, { x, y: terrainHeight(x, z), z });
    bb.repathAt = now + B.repathSec * 4;
  }
  faceMovement(ctx);
  return 'running';
}

// ───────────────────────────── أدوات / helpers ───────────────────────────────

/** يزيح الهدف نحو شريط الشفق لتقليل زمن التعرّض. */
function biasTowardDusk(ctx: BotContext, target: Vec3): Vec3 {
  const { sim } = ctx;
  const zone = zoneAtX(target.x, sim.timeSec);
  if (zone === 'dusk') return target;
  if (ctx.bot.classKey === 'nightstalker' && zone === 'dark') return target;
  const duskX = duskLineX(sim.timeSec);
  const edge = duskX + Math.sign(target.x - duskX) * (balance.dusk.bandWidth * 0.4);
  const c = clampToMap(edge, target.z);
  return { x: c.x, y: terrainHeight(c.x, c.z), z: c.z };
}

/**
 * يقيّد أي وجهة داخل نطاق آمن حول شريط الشفق.
 * Every destination is clamped to a corridor around the dusk band: a bot that walks
 * 400 m into the sun cannot make it back before the heat kills it, so it never goes.
 */
function clampToSafeCorridor(ctx: BotContext, target: Vec3): Vec3 {
  const duskX = duskLineX(ctx.sim.timeSec);
  const half = balance.dusk.bandWidth * 0.5;
  const reach = half + 25;
  const darkReach = ctx.bot.classKey === 'nightstalker' ? half + 110 : reach;
  const x = clamp(target.x, duskX - reach, duskX + darkReach);
  if (x === target.x) return target;
  const c = clampToMap(x, target.z);
  return { x: c.x, y: terrainHeight(c.x, c.z), z: c.z };
}

function setPath(ctx: BotContext, rawTarget: Vec3): void {
  const { bb, bot, nav, now } = ctx;
  const target = clampToSafeCorridor(ctx, rawTarget);
  const current = bb.path[bb.path.length - 1];
  const needsRepath =
    bb.path.length === 0 ||
    bb.pathIndex >= bb.path.length ||
    now > bb.repathAt ||
    !current ||
    Math.hypot(current.x - target.x, current.z - target.z) > 18;
  if (!needsRepath) return;
  const path = nav.findPath(bot.motion.position, target);
  bb.path = path.length > 0 ? path : [target];
  bb.pathIndex = 0;
  bb.repathAt = now + B.repathSec;
}

function faceMovement(ctx: BotContext): void {
  const { bb, bot } = ctx;
  const waypoint = bb.path[bb.pathIndex];
  if (!waypoint) return;
  const dx = waypoint.x - bot.motion.position.x;
  const dz = waypoint.z - bot.motion.position.z;
  if (Math.hypot(dx, dz) < 0.01) return;
  const yaw = Math.atan2(-dx, -dz);
  bb.desiredYaw = turnToward(bb.desiredYaw || bot.motion.yaw, yaw, ctx.dt * 6);
  bb.desiredPitch = turnToward(bb.desiredPitch, 0, ctx.dt * 4);
}

function faceTarget(ctx: BotContext, target: SimPlayer): void {
  const aim = { ...target.motion.position };
  if (ctx.tuning.leadTargets) {
    const travel = distance3(ctx.bot.motion.position, target.motion.position) / 120;
    aim.x += target.motion.velocity.x * travel;
    aim.z += target.motion.velocity.z * travel;
  }
  aim.y += P.height * 0.62;
  faceAt(ctx, aim);
}

function faceAt(ctx: BotContext, point: Vec3): void {
  const { bb, sim, bot, dt, tuning } = ctx;
  const eye = sim.eyePosition(bot);
  const dx = point.x - eye.x;
  const dy = point.y - eye.y;
  const dz = point.z - eye.z;
  const horizontal = Math.hypot(dx, dz) || 1e-6;
  const yaw = Math.atan2(-dx, -dz);
  const pitch = Math.atan2(dy, horizontal);
  // سرعة الالتفات تتبع الصعوبة
  const turnRate = clamp(24 / Math.max(tuning.aimErrorDeg, 0.6), 4, 20);
  bb.desiredYaw = turnToward(bb.desiredYaw || bot.motion.yaw, yaw, dt * turnRate);
  bb.desiredPitch = clamp(turnToward(bb.desiredPitch, pitch, dt * turnRate), -1.4, 1.4);
}

function turnToward(current: number, target: number, maxDelta: number): number {
  let diff = (target - current) % (Math.PI * 2);
  if (diff > Math.PI) diff -= Math.PI * 2;
  if (diff < -Math.PI) diff += Math.PI * 2;
  if (Math.abs(diff) <= maxDelta) return target;
  return current + Math.sign(diff) * maxDelta;
}

/** لمحة إعلامية عن أمان الموقع (تُستخدم في الاختبارات والحملة). */
export function zoneSafetySeconds(x: number, matchTimeSec: number): number {
  const zone = zoneAtX(x, matchTimeSec);
  if (zone === 'dusk') return Number.POSITIVE_INFINITY;
  const dist = Math.abs(distanceToDuskEdge(x, matchTimeSec));
  return clamp01(dist / Math.max(balance.dusk.bandWidth, 1)) * 60;
}
