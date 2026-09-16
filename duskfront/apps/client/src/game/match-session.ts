/**
 * جلسة المباراة: واجهة واحدة، تنفيذان.
 *   - OnlineMatch: خادم موثوق عبر Colyseus، مع تنبؤ محلي وتصحيح واستيفاء.
 *   - LocalMatch:  نفس المحاكاة المشتركة تعمل داخل المتصفّح (تدريب/حملة/مناوشة).
 * One interface, two backends. Because both run the identical shared simulation, the
 * renderer, the HUD and the input layer cannot tell them apart — which is also what
 * makes offline play a genuine rehearsal for the networked game rather than a mock-up.
 */
import {
  BotDirector,
  ClientMessage,
  CollisionWorld,
  MatchSimulation,
  balance,
  classBalance,
  getObstacles,
  magazineSize,
  startingAmmo,
  type ClassKey,
  type Difficulty,
  type GameMode,
  type InputCommand,
  type MatchSnapshot,
  type PlayerPublicState,
  type SimEvent,
  type TeamId,
  type Vec3,
  type WeaponKey,
} from '@duskfront/shared';
import { RoomClient, readLocalWeaponState } from '../net/room-client.js';
import { SnapshotInterpolator } from './interpolation.js';
import { LocalPredictor } from './prediction.js';

export interface MatchEventSink {
  onKillfeed(entry: {
    killerName: string;
    killerTeam: number;
    victimName: string;
    victimTeam: number;
    weapon: string;
    headshot: boolean;
  }): void;
  onAnnounce(key: string, severity: 'info' | 'warning' | 'critical', params?: Record<string, string | number>): void;
  onHitConfirm(payload: { damage: number; headshot: boolean; killed: boolean }): void;
  onDamaged(payload: { amount: number; fromYaw: number; source: string }): void;
  onShot(payload: { playerId: string; weapon: WeaponKey; origin: Vec3; direction: Vec3; hit: Vec3 | null }): void;
  onExplosion(payload: { position: Vec3; radius: number }): void;
  onStructurePlaced(payload: { position: Vec3 }): void;
  onMatchEnd(payload: { winnerTeam: number | null; reason: string }): void;
  onReward(payload: { xp: number; shards: number; newLevel: number; unlockedAchievements: string[] }): void;
  onDisconnected(reason: string): void;
}

export interface LocalWeaponView {
  weapon: WeaponKey;
  magazine: number;
  reserve: number;
  grenades: number;
  reloading: boolean;
  cooldownQ: number;
  cooldownE: number;
  ultimateCharge: number;
}

export interface MatchSession {
  readonly isOnline: boolean;
  readonly localId: string;
  readonly localTeam: TeamId;
  readonly durationSec: number;
  readonly mode: GameMode;
  /** لقطة جاهزة للرسم (مستوفاة في الوضع الشبكي). */
  snapshot(): MatchSnapshot | null;
  /** حالة اللاعب المحلي بعد التنبؤ المحلي. */
  localState(): PlayerPublicState | null;
  weaponView(): LocalWeaponView;
  update(dt: number, command: Omit<InputCommand, 'seq'>): void;
  fire(origin: Vec3, direction: Vec3, chargeSec: number): void;
  ability(slot: 'q' | 'e' | 'f', aim: Vec3, yaw: number): void;
  reload(): void;
  grenade(direction: Vec3): void;
  voteCrawler(offset: number): void;
  teamSpend(action: 'crawlerBoost' | 'coreShield' | 'crawlerRepair'): void;
  pingMark(x: number, z: number, kind: string): void;
  switchClass(classKey: ClassKey): void;
  leave(): Promise<void>;
  readonly ping: number;
  /** ينفّذ في كل إطار بعد التحديث: يستهلك أحداث المحاكاة المحلية. */
  drainEvents?(): SimEvent[];
}

// ═══════════════════════════ الوضع الشبكي ═══════════════════════════════════

export class OnlineMatch implements MatchSession {
  readonly isOnline = true;
  localId = '';
  localTeam: TeamId = 0;
  mode: GameMode;

  private readonly room = new RoomClient();
  private readonly interpolator = new SnapshotInterpolator();
  private predictor: LocalPredictor | null = null;
  private readonly world = new CollisionWorld(getObstacles());
  private classKey: ClassKey;
  private lastSnapshot: MatchSnapshot | null = null;
  private inputBatch: InputCommand[] = [];
  private sendAccumulator = 0;
  private weaponKey: WeaponKey;
  private reloadingUntil = 0;

  constructor(
    mode: GameMode,
    classKey: ClassKey,
    private readonly sink: MatchEventSink,
  ) {
    this.mode = mode;
    this.classKey = classKey;
    this.weaponKey = classBalance(classKey).primary as WeaponKey;
  }

  async connect(roomName: string, joinOptions: Record<string, unknown>, accessToken: string | null): Promise<void> {
    await this.room.join(roomName, joinOptions, accessToken, {
      onWelcome: (payload) => {
        this.localId = payload.sessionId;
        this.localTeam = payload.team;
      },
      onKillfeed: (payload) => this.sink.onKillfeed(payload),
      onAnnounce: (payload) => this.sink.onAnnounce(payload.key, payload.severity, payload.params),
      onHitConfirm: (payload) => this.sink.onHitConfirm(payload),
      onDamaged: (payload) => this.sink.onDamaged(payload),
      onMatchEnd: (payload) => this.sink.onMatchEnd(payload),
      onReward: (payload) => this.sink.onReward(payload),
      onLeave: (code) => this.sink.onDisconnected(`code_${code}`),
      onError: (message) => this.sink.onDisconnected(message),
      onReject: () => undefined,
    });
  }

  get durationSec(): number {
    return this.room.durationSec;
  }

  get ping(): number {
    return this.room.ping;
  }

  snapshot(): MatchSnapshot | null {
    const authoritative = this.room.snapshot();
    if (authoritative) {
      this.interpolator.push(authoritative);
      this.lastSnapshot = authoritative;
    }
    const interpolated = this.interpolator.sample();
    if (!interpolated) return null;

    // اللاعب المحلي يُرسم من التنبؤ لا من اللقطة المتأخرة
    const predicted = this.localState();
    if (!predicted) return interpolated;
    return {
      ...interpolated,
      players: interpolated.players.map((player) => (player.id === this.localId ? predicted : player)),
    };
  }

  localState(): PlayerPublicState | null {
    const authoritative = this.lastSnapshot?.players.find((player) => player.id === this.localId) ?? null;
    if (!authoritative) return null;
    if (!this.predictor) {
      this.predictor = new LocalPredictor(this.world, authoritative.classKey, authoritative.position);
      this.predictor.motion.yaw = authoritative.yaw;
    }
    // التصحيح: نأخذ موضع الخادم عند آخر أمر أقرّه، ونعيد تطبيق الباقي
    this.predictor.reconcile(
      { position: authoritative.position, velocity: authoritative.velocity, grounded: authoritative.grounded },
      authoritative.lastSeq,
    );
    return {
      ...authoritative,
      position: { ...this.predictor.motion.position },
      velocity: { ...this.predictor.motion.velocity },
      yaw: this.predictor.motion.yaw,
      pitch: this.predictor.motion.pitch,
      crouching: this.predictor.motion.crouching,
      grounded: this.predictor.motion.grounded,
    };
  }

  weaponView(): LocalWeaponView {
    const authoritative = readLocalWeaponState(this.room, this.localId);
    const local = this.lastSnapshot?.players.find((player) => player.id === this.localId);
    return {
      weapon: this.weaponKey,
      magazine: authoritative?.magazine ?? 0,
      reserve: authoritative?.reserve ?? 0,
      grenades: authoritative?.grenades ?? 0,
      reloading: performance.now() / 1000 < this.reloadingUntil,
      cooldownQ: authoritative?.cooldownQ ?? 0,
      cooldownE: authoritative?.cooldownE ?? 0,
      ultimateCharge: local?.ultimateCharge ?? 0,
    };
  }

  update(dt: number, command: Omit<InputCommand, 'seq'>): void {
    if (!this.predictor) return;
    const full = this.predictor.createAndApply(command);
    this.inputBatch.push(full);

    // نرسل دفعات بمعدّل الشبكة بدل رسالة لكل إطار
    this.sendAccumulator += dt;
    const interval = 1 / balance.network.sendRateHz;
    if (this.sendAccumulator >= interval && this.inputBatch.length > 0) {
      this.sendAccumulator = 0;
      const commands = this.inputBatch.slice(-balance.network.maxInputsPerPacket);
      this.inputBatch = [];
      this.room.send(ClientMessage.Input, { commands });
    }
  }

  fire(origin: Vec3, direction: Vec3, chargeSec: number): void {
    this.room.send(ClientMessage.Fire, {
      seq: this.predictor?.motion.lastSeq ?? 0,
      originX: origin.x,
      originY: origin.y,
      originZ: origin.z,
      dirX: direction.x,
      dirY: direction.y,
      dirZ: direction.z,
      chargeSec,
      clientTimeMs: Date.now(),
    });
  }

  ability(slot: 'q' | 'e' | 'f', aim: Vec3, yaw: number): void {
    this.room.send(ClientMessage.Ability, { slot, aimX: aim.x, aimY: aim.y, aimZ: aim.z, yaw });
  }

  reload(): void {
    this.room.send(ClientMessage.Reload, {});
    const seconds = (balance.weapons[this.weaponKey] as { reloadSec?: number }).reloadSec ?? 0;
    if (seconds > 0) this.reloadingUntil = performance.now() / 1000 + seconds;
  }

  grenade(direction: Vec3): void {
    this.room.send(ClientMessage.Grenade, {
      slot: 'q',
      aimX: direction.x,
      aimY: direction.y,
      aimZ: direction.z,
      yaw: this.predictor?.motion.yaw ?? 0,
    });
  }

  voteCrawler(offset: number): void {
    this.room.send(ClientMessage.CrawlerVote, { offset });
  }

  teamSpend(action: 'crawlerBoost' | 'coreShield' | 'crawlerRepair'): void {
    this.room.send(ClientMessage.TeamSpend, { action });
  }

  pingMark(x: number, z: number, kind: string): void {
    this.room.send(ClientMessage.Ping, { x, z, kind });
  }

  switchClass(classKey: ClassKey): void {
    this.classKey = classKey;
    this.weaponKey = classBalance(classKey).primary as WeaponKey;
    this.predictor?.setClass(classKey);
    this.room.send(ClientMessage.SwitchClass, { classKey });
  }

  projectiles(): ReturnType<RoomClient['projectiles']> {
    return this.room.projectiles();
  }

  async leave(): Promise<void> {
    await this.room.leave();
    this.interpolator.clear();
  }
}

// ═══════════════════════════ الوضع المحلي ═══════════════════════════════════

export interface LocalMatchOptions {
  mode: GameMode;
  classKey: ClassKey;
  difficulty: Difficulty;
  playerName: string;
  /** عدد البوتات في كل فريق (يشمل فريق اللاعب) */
  teamSize?: number;
  durationSec?: number;
  seed?: number;
}

export class LocalMatch implements MatchSession {
  readonly isOnline = false;
  readonly localId = 'local_player';
  readonly localTeam: TeamId = 0;
  readonly mode: GameMode;
  readonly sim: MatchSimulation;

  private readonly bots: BotDirector;
  private readonly sink: MatchEventSink;
  private pendingEvents: SimEvent[] = [];
  private accumulator = 0;
  private classKey: ClassKey;
  private weaponKey: WeaponKey;
  private nextSeq = 1;
  private ended = false;

  constructor(options: LocalMatchOptions, sink: MatchEventSink) {
    this.mode = options.mode;
    this.sink = sink;
    this.classKey = options.classKey;
    this.weaponKey = classBalance(options.classKey).primary as WeaponKey;

    const simMode: GameMode = options.mode === 'shadowhunt' ? 'shadowhunt' : 'crawl';
    this.sim = new MatchSimulation({
      mode: simMode,
      matchId: `local-${Date.now().toString(36)}`,
      seed: options.seed,
      durationSec: options.durationSec,
    });
    this.bots = new BotDirector(options.difficulty, (options.seed ?? Date.now()) & 0x7fffffff);

    this.sim.addPlayer({
      id: this.localId,
      userId: this.localId,
      name: options.playerName,
      team: 0,
      classKey: options.classKey,
    });

    const perTeam = options.teamSize ?? balance.match.crawl.teamSize;
    const classes: ClassKey[] = ['guardian', 'sunshot', 'nightstalker', 'engineer'];
    const names0 = ['رافن', 'زايرو', 'خالد', 'نوفا'];
    const names1 = ['شادو', 'فايبر', 'ريزر', 'أمبر', 'دلتا'];
    for (let i = 1; i < perTeam; i++) {
      this.sim.addPlayer({
        id: `bot_ally_${i}`,
        userId: `bot_ally_${i}`,
        name: names0[(i - 1) % names0.length]!,
        team: 0,
        classKey: classes[i % classes.length]!,
        isBot: true,
        botDifficulty: options.difficulty,
      });
    }
    for (let i = 0; i < perTeam; i++) {
      this.sim.addPlayer({
        id: `bot_enemy_${i}`,
        userId: `bot_enemy_${i}`,
        name: names1[i % names1.length]!,
        team: 1,
        classKey: classes[i % classes.length]!,
        isBot: true,
        botDifficulty: options.difficulty,
      });
    }
  }

  get durationSec(): number {
    return this.sim.durationSec;
  }

  get ping(): number {
    return 0;
  }

  snapshot(): MatchSnapshot | null {
    return this.sim.snapshot();
  }

  localState(): PlayerPublicState | null {
    const player = this.sim.getPlayer(this.localId);
    return player ? this.sim.publicState(player) : null;
  }

  weaponView(): LocalWeaponView {
    const player = this.sim.getPlayer(this.localId);
    if (!player) {
      const ammo = startingAmmo(this.weaponKey);
      return {
        weapon: this.weaponKey,
        magazine: ammo.magazine,
        reserve: ammo.reserve,
        grenades: 0,
        reloading: false,
        cooldownQ: 0,
        cooldownE: 0,
        ultimateCharge: 0,
      };
    }
    return {
      weapon: player.weapon.key,
      magazine: player.weapon.magazine,
      reserve: player.weapon.reserve,
      grenades: player.grenades,
      reloading: player.weapon.reloadEndsAt > this.sim.timeSec,
      cooldownQ: Math.max(0, player.abilities.q.readyAt - this.sim.timeSec),
      cooldownE: Math.max(0, player.abilities.e.readyAt - this.sim.timeSec),
      ultimateCharge: player.ultimateCharge,
    };
  }

  /** يشغّل المحاكاة بخطوة ثابتة (20Hz) مهما كان معدّل إطارات العرض. */
  update(dt: number, command: Omit<InputCommand, 'seq'>): void {
    this.sim.enqueueInput(this.localId, { ...command, seq: this.nextSeq++ });

    const step = 1 / balance.match.tickRate;
    this.accumulator += dt;
    let guard = 0;
    while (this.accumulator >= step && guard++ < 5) {
      this.accumulator -= step;
      this.bots.update(this.sim, step);
      const events = this.sim.step(step);
      this.pendingEvents.push(...events);
      this.dispatch(events);
    }
  }

  private dispatch(events: SimEvent[]): void {
    for (const event of events) {
      switch (event.type) {
        case 'kill': {
          const killer = event.killerId ? this.sim.getPlayer(event.killerId) : null;
          const victim = this.sim.getPlayer(event.victimId);
          this.sink.onKillfeed({
            killerName: killer?.name ?? '',
            killerTeam: killer?.team ?? -1,
            victimName: victim?.name ?? '',
            victimTeam: victim?.team ?? -1,
            weapon: String(event.weapon),
            headshot: event.headshot,
          });
          break;
        }
        case 'hit':
          if (event.attackerId === this.localId) {
            this.sink.onHitConfirm({ damage: event.damage, headshot: event.headshot, killed: event.killed });
          }
          break;
        case 'damaged':
          if (event.targetId === this.localId) {
            this.sink.onDamaged({ amount: event.amount, fromYaw: event.fromYaw, source: event.source });
          }
          break;
        case 'announce':
          this.sink.onAnnounce(event.key, event.severity, event.params);
          break;
        case 'explosion':
          this.sink.onExplosion({ position: event.position, radius: event.radius });
          break;
        case 'structure_placed':
          this.sink.onStructurePlaced({ position: event.structure.position });
          break;
        case 'crawler_zone':
          this.sink.onAnnounce(
            event.zone === 'dusk' ? 'announce.crawler_safe' : 'announce.crawler_exposed',
            event.zone === 'dusk' ? 'info' : 'critical',
          );
          break;
        case 'match_end':
          if (!this.ended) {
            this.ended = true;
            this.sink.onMatchEnd({ winnerTeam: event.winnerTeam, reason: event.reason });
          }
          break;
        default:
          break;
      }
    }
  }

  drainEvents(): SimEvent[] {
    const events = this.pendingEvents;
    this.pendingEvents = [];
    return events;
  }

  fire(origin: Vec3, direction: Vec3, chargeSec: number): void {
    const result = this.sim.requestFire(this.localId, {
      seq: this.nextSeq,
      origin,
      direction,
      chargeSec,
      clientTimeMs: performance.now(),
    });
    if (result.accepted) {
      const player = this.sim.getPlayer(this.localId);
      this.sink.onShot({
        playerId: this.localId,
        weapon: player?.weapon.key ?? this.weaponKey,
        origin,
        direction,
        hit: null,
      });
    }
  }

  ability(slot: 'q' | 'e' | 'f', aim: Vec3, yaw: number): void {
    this.sim.requestAbility(this.localId, { slot, aim, yaw });
  }

  reload(): void {
    this.sim.requestReload(this.localId);
  }

  grenade(direction: Vec3): void {
    this.sim.throwGrenade(this.localId, direction);
  }

  voteCrawler(offset: number): void {
    this.sim.voteCrawler(this.localId, offset);
  }

  teamSpend(action: 'crawlerBoost' | 'coreShield' | 'crawlerRepair'): void {
    this.sim.teamSpend(this.localTeam, action);
  }

  pingMark(): void {
    /* لا شبكة في الوضع المحلي */
  }

  switchClass(classKey: ClassKey): void {
    if (this.sim.switchClass(this.localId, classKey)) {
      this.classKey = classKey;
      this.weaponKey = classBalance(classKey).primary as WeaponKey;
    }
  }

  async leave(): Promise<void> {
    this.sim.forceEnd(null, 'forfeit');
  }

  /** ذخيرة المخزن القصوى — تستخدمها الواجهة لحساب النسب. */
  get magazineCapacity(): number {
    return magazineSize(this.weaponKey);
  }
}
