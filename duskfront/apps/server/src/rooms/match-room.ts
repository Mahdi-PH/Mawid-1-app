/**
 * غرفة المباراة الموثوقة — 20 تحديثًا في الثانية.
 * The authoritative match room. Every client message is validated (zod → anti-cheat →
 * simulation gate) before it can affect the world, and the world is mirrored into the
 * Colyseus schema so clients receive deltas rather than full snapshots.
 */
import { Client, Room } from 'colyseus';
import {
  BotDirector,
  ClientMessage,
  MatchSimulation,
  ServerMessage,
  balance,
  zAbilityMessage,
  zClassKey,
  zCrawlerVote,
  zFireMessage,
  zInputBatch,
  zPingMessage,
  zTeamSpendMessage,
  type ClassKey,
  type Difficulty,
  type GameMode,
  type SimEvent,
  type TeamId,
} from '@duskfront/shared';
import { randomUUID } from 'node:crypto';
import { AntiCheat } from '../anticheat/validator.js';
import { verifyAccessToken } from '../auth/tokens.js';
import type { Env } from '../env.js';
import { createLogger } from '../logger.js';
import type { ParticipantInput, Store } from '../persistence/types.js';
import { CrawlerSchema, GrenadeSchema, MatchState, PlayerSchema, StrikeSchema, StructureSchema, WellSchema } from './state.js';

const log = createLogger('room');
const TICK_MS = 1000 / balance.match.tickRate;

export interface MatchRoomOptions {
  mode?: GameMode;
  classKey?: ClassKey;
  difficulty?: Difficulty;
  soloVsBots?: boolean;
  accessToken?: string;
}

interface JoinedPlayer {
  userId: string;
  displayName: string;
  team: TeamId;
  classKey: ClassKey;
  isGuest: boolean;
  joinedAt: number;
  /** لحساب إزاحة اللاعب بين تحديثين (مكافحة الغش) */
  lastCheckedPosition: { x: number; y: number; z: number };
  lastCheckedAt: number;
  disconnectedAt: number | null;
}

export class MatchRoom extends Room<MatchState> {
  override maxClients = balance.match.crawl.teamSize * 2;

  private sim!: MatchSimulation;
  private bots!: BotDirector;
  private readonly antiCheat = new AntiCheat();
  private readonly joined = new Map<string, JoinedPlayer>();
  private readonly killFeedIds = new Map<string, string>();
  private env!: Env;
  private store!: Store;
  private mode: GameMode = 'crawl';
  private difficulty: Difficulty = 'normal';
  private startedAt = new Date();
  private botFillTimer = 0;
  private finalized = false;
  private accumulator = 0;

  /** يُحقن من index.ts عند تعريف الغرفة. */
  static deps: { env: Env; store: Store } | null = null;

  override onCreate(options: MatchRoomOptions): void {
    const deps = MatchRoom.deps;
    if (!deps) throw new Error('[room] MatchRoom.deps was never injected');
    this.env = deps.env;
    this.store = deps.store;

    this.mode = options.mode === 'shadowhunt' ? 'shadowhunt' : 'crawl';
    this.difficulty = options.difficulty ?? 'normal';
    this.maxClients =
      this.mode === 'shadowhunt' ? balance.match.shadowhunt.teamSize * 2 : balance.match.crawl.teamSize * 2;

    const matchId = randomUUID();
    this.sim = new MatchSimulation({ mode: this.mode, matchId, serverVersion: this.env.SERVER_VERSION });
    this.bots = new BotDirector(this.difficulty, Date.now() & 0x7fffffff);

    this.state = new MatchState();
    this.state.matchId = matchId;
    this.state.mode = this.mode;
    this.state.mapKey = this.sim.mapKey;
    this.state.mapSeed = balance.map.seed;
    this.state.durationSec = this.sim.durationSec;
    for (const crawler of this.sim.crawlers) {
      const schema = new CrawlerSchema();
      schema.team = crawler.team;
      this.state.crawlers.push(schema);
    }
    for (const well of this.sim.wells) {
      const schema = new WellSchema();
      schema.id = well.id;
      schema.x = well.position.x;
      schema.z = well.position.z;
      this.state.wells.push(schema);
    }

    this.setSimulationInterval((deltaMs) => this.tick(deltaMs), TICK_MS);
    this.registerHandlers();
    log.info('room created', { roomId: this.roomId, mode: this.mode, matchId });
  }

  /** المصادقة الاختيارية: الضيوف مسموح لهم، لكن الرمز يحدّد الهوية الحقيقية. */
  override async onAuth(_client: Client, options: MatchRoomOptions): Promise<Record<string, unknown>> {
    if (!options.accessToken) return { userId: null, displayName: null, isGuest: true };
    const claims = await verifyAccessToken(this.env, options.accessToken);
    if (!claims) throw new Error('invalid_token');
    const user = await this.store.findUserById(claims.sub);
    if (!user) throw new Error('unknown_user');
    if (user.bannedUntil && user.bannedUntil.getTime() > Date.now()) throw new Error('banned');
    const profile = await this.store.getProfile(claims.sub);
    return { userId: claims.sub, displayName: profile?.displayName ?? claims.displayName, isGuest: claims.isGuest };
  }

  override onJoin(client: Client, options: MatchRoomOptions, auth: Record<string, unknown>): void {
    const classParsed = zClassKey.safeParse(options.classKey ?? 'guardian');
    const classKey = (classParsed.success ? classParsed.data : 'guardian') as ClassKey;
    const team = this.pickTeam();
    const userId = (auth?.userId as string | null) ?? `guest_${client.sessionId}`;
    const displayName = (auth?.displayName as string | null) ?? `ضيف ${client.sessionId.slice(0, 4)}`;

    this.joined.set(client.sessionId, {
      userId,
      displayName,
      team,
      classKey,
      isGuest: Boolean(auth?.isGuest ?? true),
      joinedAt: Date.now(),
      lastCheckedPosition: { x: 0, y: 0, z: 0 },
      lastCheckedAt: 0,
      disconnectedAt: null,
    });
    this.antiCheat.track(client.sessionId);

    const player = this.sim.addPlayer({ id: client.sessionId, userId, name: displayName, team, classKey });
    const joinedPlayer = this.joined.get(client.sessionId)!;
    joinedPlayer.lastCheckedPosition = { ...player.motion.position };

    client.send(ServerMessage.Welcome, {
      sessionId: client.sessionId,
      matchId: this.sim.matchId,
      mode: this.mode,
      mapKey: this.sim.mapKey,
      mapSeed: balance.map.seed,
      team,
      serverTimeMs: Date.now(),
      tickRate: balance.match.tickRate,
    });

    if (options.soloVsBots) this.fillWithBots();
    log.info('player joined', { roomId: this.roomId, sessionId: client.sessionId, team, classKey });
  }

  override async onLeave(client: Client, consented: boolean): Promise<void> {
    const entry = this.joined.get(client.sessionId);
    if (!entry) return;
    entry.disconnectedAt = Date.now();
    this.sim.setConnected(client.sessionId, false);

    if (consented) {
      this.dropPlayer(client.sessionId);
      return;
    }
    // انقطاع غير مقصود: يحلّ بوت محل اللاعب حتى 90 ثانية
    const player = this.sim.getPlayer(client.sessionId);
    if (player) player.isBot = true;
    try {
      await this.allowReconnection(client, balance.match.reconnectGraceSec);
      const restored = this.sim.getPlayer(client.sessionId);
      if (restored) restored.isBot = false;
      entry.disconnectedAt = null;
      this.sim.setConnected(client.sessionId, true);
      log.info('player reconnected', { sessionId: client.sessionId });
    } catch {
      this.dropPlayer(client.sessionId);
    }
  }

  override async onDispose(): Promise<void> {
    await this.finalize();
    log.info('room disposed', { roomId: this.roomId });
  }

  // ───────────────────────────── الرسائل / messages ──────────────────────────

  private registerHandlers(): void {
    this.onMessage(ClientMessage.Input, (client, payload) => {
      const parsed = zInputBatch.safeParse(payload);
      if (!parsed.success) {
        this.antiCheat.flagBadPayload(client.sessionId, 'input', this.sim.timeSec);
        return;
      }
      const entry = this.joined.get(client.sessionId);
      if (!entry) return;
      for (const command of parsed.data.commands) {
        const checked = this.antiCheat.validateInput(client.sessionId, command, entry.classKey, this.sim.timeSec);
        if (!checked) continue;
        this.sim.enqueueInput(client.sessionId, checked);
      }
    });

    this.onMessage(ClientMessage.Fire, (client, payload) => {
      const parsed = zFireMessage.safeParse(payload);
      if (!parsed.success) {
        this.antiCheat.flagBadPayload(client.sessionId, 'fire', this.sim.timeSec);
        return;
      }
      const player = this.sim.getPlayer(client.sessionId);
      if (!player) return;
      if (!this.antiCheat.validateShot(client.sessionId, player.weapon.key, this.sim.timeSec)) return;

      const message = parsed.data;
      const result = this.sim.requestFire(client.sessionId, {
        seq: message.seq,
        origin: { x: message.originX, y: message.originY, z: message.originZ },
        direction: { x: message.dirX, y: message.dirY, z: message.dirZ },
        chargeSec: message.chargeSec,
        clientTimeMs: message.clientTimeMs,
      });
      if (!result.accepted) {
        if (result.reason === 'origin_mismatch') {
          this.antiCheat.flagOriginMismatch(client.sessionId, 'fire origin too far from server pose', this.sim.timeSec);
        }
        client.send(ServerMessage.Reject, { reason: result.reason });
      }
    });

    this.onMessage(ClientMessage.Ability, (client, payload) => {
      const parsed = zAbilityMessage.safeParse(payload);
      if (!parsed.success) return;
      const result = this.sim.requestAbility(client.sessionId, {
        slot: parsed.data.slot,
        aim: { x: parsed.data.aimX, y: parsed.data.aimY, z: parsed.data.aimZ },
        yaw: parsed.data.yaw,
      });
      if (!result.accepted) client.send(ServerMessage.Reject, { reason: result.reason });
    });

    this.onMessage(ClientMessage.Reload, (client) => this.sim.requestReload(client.sessionId));

    this.onMessage(ClientMessage.Grenade, (client, payload) => {
      const parsed = zAbilityMessage.safeParse(payload);
      if (!parsed.success) return;
      this.sim.throwGrenade(client.sessionId, { x: parsed.data.aimX, y: parsed.data.aimY, z: parsed.data.aimZ });
    });

    this.onMessage(ClientMessage.SwitchClass, (client, payload) => {
      const parsed = zClassKey.safeParse((payload as { classKey?: string })?.classKey);
      if (!parsed.success) return;
      if (this.sim.switchClass(client.sessionId, parsed.data as ClassKey)) {
        const entry = this.joined.get(client.sessionId);
        if (entry) entry.classKey = parsed.data as ClassKey;
      }
    });

    this.onMessage(ClientMessage.CrawlerVote, (client, payload) => {
      const parsed = zCrawlerVote.safeParse(payload);
      if (!parsed.success) return;
      this.sim.voteCrawler(client.sessionId, parsed.data.offset);
    });

    this.onMessage(ClientMessage.TeamSpend, (client, payload) => {
      const parsed = zTeamSpendMessage.safeParse(payload);
      if (!parsed.success) return;
      const entry = this.joined.get(client.sessionId);
      if (!entry) return;
      const ok = this.sim.teamSpend(entry.team, parsed.data.action);
      if (!ok) client.send(ServerMessage.Reject, { reason: 'insufficient_team_lumen' });
    });

    this.onMessage(ClientMessage.Ping, (client, payload) => {
      const parsed = zPingMessage.safeParse(payload);
      if (!parsed.success) return;
      const entry = this.joined.get(client.sessionId);
      if (!entry) return;
      this.broadcastToTeam(entry.team, ServerMessage.Ping, {
        from: entry.displayName,
        x: parsed.data.x,
        z: parsed.data.z,
        kind: parsed.data.kind,
      });
    });

    this.onMessage(ClientMessage.Latency, (client, payload) => {
      const rtt = Number((payload as { rtt?: number })?.rtt ?? 0);
      if (Number.isFinite(rtt)) this.sim.setLatency(client.sessionId, rtt / 2);
    });

    this.onMessage(ClientMessage.Chat, (client, payload) => {
      const text = String((payload as { text?: string })?.text ?? '').slice(0, 160);
      if (!text.trim()) return;
      const entry = this.joined.get(client.sessionId);
      if (!entry) return;
      this.broadcastToTeam(entry.team, ServerMessage.Chat, { from: entry.displayName, text });
    });
  }

  // ───────────────────────────── التحديث / tick ──────────────────────────────

  private tick(deltaMs: number): void {
    const dt = Math.min(deltaMs, TICK_MS * 4) / 1000;
    this.accumulator += dt;

    // ملء الأماكن الفارغة بالبوتات بعد 60 ثانية من الانتظار
    if (this.sim.phase === 'warmup') {
      this.botFillTimer += dt;
      if (this.botFillTimer >= balance.match.botFillAfterSec) this.fillWithBots();
    }

    this.bots.update(this.sim, dt);
    const events = this.sim.step(dt);

    for (const sessionId of this.joined.keys()) this.antiCheat.decay(sessionId, this.sim.timeSec);
    this.enforceMovement();
    this.dispatchEvents(events);
    this.syncState();

    if (this.sim.phase === 'ended' && !this.finalized) {
      void this.finalize().then(() => {
        this.broadcast(ServerMessage.MatchEnd, {
          winnerTeam: this.sim.winnerTeam,
          reason: this.sim.winReason,
          scoreboard: this.sim.snapshot().players,
        });
        this.clock.setTimeout(() => this.disconnect(), 12_000);
      });
    }
  }

  /** يقارن إزاحة كل لاعب بحد السرعة النظري ويعيده إن غشّ. */
  private enforceMovement(): void {
    const now = this.sim.timeSec;
    for (const [sessionId, entry] of this.joined) {
      const player = this.sim.getPlayer(sessionId);
      if (!player || !player.alive || player.isBot) continue;
      if (entry.lastCheckedAt === 0) {
        entry.lastCheckedAt = now;
        entry.lastCheckedPosition = { ...player.motion.position };
        continue;
      }
      const elapsed = now - entry.lastCheckedAt;
      if (elapsed < 0.4) continue;
      const dx = player.motion.position.x - entry.lastCheckedPosition.x;
      const dy = player.motion.position.y - entry.lastCheckedPosition.y;
      const dz = player.motion.position.z - entry.lastCheckedPosition.z;
      const distance = Math.hypot(dx, dy, dz);
      const ok = this.antiCheat.validateDisplacement(sessionId, entry.classKey, distance, elapsed, now);
      if (!ok) {
        // نعيد اللاعب إلى آخر موضع مقبول بدل الوثوق بالعميل
        player.motion.position = { ...entry.lastCheckedPosition };
        player.motion.velocity = { x: 0, y: 0, z: 0 };
      } else {
        entry.lastCheckedPosition = { ...player.motion.position };
      }
      entry.lastCheckedAt = now;

      if (this.antiCheat.shouldBan(sessionId)) {
        log.warn('auto-ban triggered', { sessionId, userId: entry.userId });
        void this.store.banUser(entry.userId, this.antiCheat.banUntil()).catch(() => undefined);
        const client = this.clients.find((c) => c.sessionId === sessionId);
        client?.leave(4003, 'anticheat');
        this.dropPlayer(sessionId);
      }
    }
  }

  private dispatchEvents(events: SimEvent[]): void {
    for (const event of events) {
      switch (event.type) {
        case 'hit': {
          const attacker = this.clients.find((c) => c.sessionId === event.attackerId);
          attacker?.send(ServerMessage.HitConfirm, {
            targetId: event.targetId,
            damage: event.damage,
            headshot: event.headshot,
            killed: event.killed,
            distance: event.distance,
          });
          break;
        }
        case 'damaged': {
          const victim = this.clients.find((c) => c.sessionId === event.targetId);
          const attackerName = event.attackerId ? this.joined.get(event.attackerId)?.displayName : undefined;
          victim?.send(ServerMessage.Damaged, {
            amount: event.amount,
            fromYaw: event.fromYaw,
            source: event.source,
            attackerName,
          });
          break;
        }
        case 'kill': {
          const killer = event.killerId ? this.sim.getPlayer(event.killerId) : null;
          const victim = this.sim.getPlayer(event.victimId);
          this.broadcast(ServerMessage.Killfeed, {
            killerName: killer?.name ?? '',
            killerTeam: killer?.team ?? -1,
            victimName: victim?.name ?? '',
            victimTeam: victim?.team ?? -1,
            weapon: event.weapon,
            headshot: event.headshot,
            atSec: this.sim.timeSec,
          });
          break;
        }
        case 'announce':
          if (event.team !== undefined) {
            this.broadcastToTeam(event.team, ServerMessage.Announce, {
              key: event.key,
              severity: event.severity,
              params: event.params,
            });
          } else {
            this.broadcast(ServerMessage.Announce, { key: event.key, severity: event.severity, params: event.params });
          }
          break;
        case 'crawler_zone':
          this.broadcastToTeam(event.team, ServerMessage.Announce, {
            key: event.zone === 'dusk' ? 'announce.crawler_safe' : 'announce.crawler_exposed',
            severity: event.zone === 'dusk' ? 'info' : 'critical',
            params: { zone: event.zone },
          });
          break;
        default:
          break;
      }
    }
  }

  /** ينسخ حالة المحاكاة إلى مخطط Colyseus. */
  private syncState(): void {
    const snapshot = this.sim.snapshot();
    this.state.phase = snapshot.phase;
    this.state.timeSec = snapshot.timeSec;
    this.state.duskX = snapshot.duskX;
    this.state.tick = snapshot.tick;
    this.state.teamLumen[0] = snapshot.teamLumen[0];
    this.state.teamLumen[1] = snapshot.teamLumen[1];
    this.state.teamScore[0] = snapshot.teamScore[0];
    this.state.teamScore[1] = snapshot.teamScore[1];
    this.state.winnerTeam = this.sim.winnerTeam ?? -1;
    this.state.winReason = this.sim.winReason;

    const seen = new Set<string>();
    for (const p of snapshot.players) {
      seen.add(p.id);
      let schema = this.state.players.get(p.id);
      if (!schema) {
        schema = new PlayerSchema();
        schema.id = p.id;
        schema.userId = p.userId;
        schema.name = p.name;
        schema.team = p.team;
        this.state.players.set(p.id, schema);
      }
      const sim = this.sim.getPlayer(p.id);
      schema.classKey = p.classKey;
      schema.x = p.position.x;
      schema.y = p.position.y;
      schema.z = p.position.z;
      schema.vx = p.velocity.x;
      schema.vy = p.velocity.y;
      schema.vz = p.velocity.z;
      schema.yaw = p.yaw;
      schema.pitch = p.pitch;
      schema.health = p.health;
      schema.maxHealth = p.maxHealth;
      schema.shield = p.shield;
      schema.lumen = p.lumen;
      schema.light = p.light;
      schema.zone = p.zone;
      schema.heat = p.heat;
      schema.cold = p.cold;
      schema.temperatureC = sim?.temperatureC ?? 0;
      schema.alive = p.alive;
      schema.cloaked = p.cloaked;
      schema.marked = p.marked;
      schema.crouching = p.crouching;
      schema.grounded = p.grounded;
      schema.respawnAt = p.respawnAt;
      schema.ultimateCharge = p.ultimateCharge;
      schema.kills = p.kills;
      schema.deaths = p.deaths;
      schema.assists = p.assists;
      schema.ping = Math.round(p.ping);
      schema.isBot = p.isBot;
      schema.lastSeq = p.lastSeq;
      schema.connected = sim?.connected ?? true;
      schema.magazine = sim?.weapon.magazine ?? 0;
      schema.reserve = sim?.weapon.reserve ?? 0;
      schema.grenades = sim?.grenades ?? 0;
      schema.cooldownQ = Math.max(0, (sim?.abilities.q.readyAt ?? 0) - snapshot.timeSec);
      schema.cooldownE = Math.max(0, (sim?.abilities.e.readyAt ?? 0) - snapshot.timeSec);
    }
    for (const key of [...this.state.players.keys()]) {
      if (!seen.has(key)) this.state.players.delete(key);
    }

    for (let i = 0; i < snapshot.crawlers.length; i++) {
      const source = snapshot.crawlers[i]!;
      const target = this.state.crawlers[i];
      if (!target) continue;
      target.x = source.position.x;
      target.y = source.position.y;
      target.z = source.position.z;
      target.integrity = source.integrity;
      target.coreHealth = source.coreHealth;
      target.coreMaxHealth = source.coreMaxHealth;
      target.coreShieldUntil = source.coreShieldUntil;
      target.steerOffset = source.steerOffset;
      target.boostUntil = source.boostUntil;
      target.zone = source.zone;
      target.outsideSince = source.outsideSince;
    }

    for (let i = 0; i < snapshot.wells.length; i++) {
      const source = snapshot.wells[i]!;
      const target = this.state.wells[i];
      if (!target) continue;
      target.owner = source.owner;
      target.progress = source.progress;
      target.capturingTeam = source.capturingTeam;
    }

    const structureIds = new Set<string>();
    for (const s of snapshot.structures) {
      structureIds.add(s.id);
      let schema = this.state.structures.get(s.id);
      if (!schema) {
        schema = new StructureSchema();
        schema.id = s.id;
        schema.kind = s.kind;
        schema.ownerId = s.ownerId;
        schema.team = s.team;
        this.state.structures.set(s.id, schema);
      }
      schema.x = s.position.x;
      schema.y = s.position.y;
      schema.z = s.position.z;
      schema.yaw = s.yaw;
      schema.health = Number.isFinite(s.health) ? s.health : 0;
      schema.maxHealth = Number.isFinite(s.maxHealth) ? s.maxHealth : 0;
      schema.expiresAt = s.expiresAt;
      schema.radius = s.radius ?? 0;
    }
    for (const key of [...this.state.structures.keys()]) {
      if (!structureIds.has(key)) this.state.structures.delete(key);
    }

    const grenades = this.sim.activeGrenades();
    this.state.grenades.splice(0, this.state.grenades.length);
    for (const g of grenades) {
      const schema = new GrenadeSchema();
      schema.id = g.id;
      schema.team = g.team;
      schema.x = g.position.x;
      schema.y = g.position.y;
      schema.z = g.position.z;
      this.state.grenades.push(schema);
    }

    const strikes = this.sim.activeStrikes();
    this.state.strikes.splice(0, this.state.strikes.length);
    for (const s of strikes) {
      const schema = new StrikeSchema();
      schema.id = s.id;
      schema.x = s.position.x;
      schema.z = s.position.z;
      schema.at = s.at;
      schema.radius = s.radius;
      this.state.strikes.push(schema);
    }
  }

  // ───────────────────────────── مساعدات / helpers ───────────────────────────

  private pickTeam(): TeamId {
    let team0 = 0;
    let team1 = 0;
    for (const entry of this.joined.values()) {
      if (entry.team === 0) team0++;
      else team1++;
    }
    return team0 <= team1 ? 0 : 1;
  }

  private dropPlayer(sessionId: string): void {
    this.sim.removePlayer(sessionId);
    this.joined.delete(sessionId);
    this.antiCheat.forget(sessionId);
    this.killFeedIds.delete(sessionId);
  }

  private broadcastToTeam(team: TeamId, type: string, payload: unknown): void {
    for (const client of this.clients) {
      const entry = this.joined.get(client.sessionId);
      if (entry?.team === team) client.send(type, payload);
    }
  }

  /** يملأ الفريقين ببوتات حتى يكتمل العدد. */
  private fillWithBots(): void {
    const perTeam = this.maxClients / 2;
    const classes: ClassKey[] = ['guardian', 'sunshot', 'nightstalker', 'engineer'];
    for (const team of [0, 1] as TeamId[]) {
      const current = [...this.sim.players.values()].filter((p) => p.team === team).length;
      for (let i = current; i < perTeam; i++) {
        const id = `bot_${team}_${i}_${Math.random().toString(36).slice(2, 6)}`;
        this.sim.addPlayer({
          id,
          userId: id,
          name: botName(team, i),
          team,
          classKey: classes[i % classes.length]!,
          isBot: true,
          botDifficulty: this.difficulty,
        });
      }
    }
    this.botFillTimer = -1e9;
  }

  /** يكتب نتيجة المباراة في قاعدة البيانات داخل معاملة واحدة. */
  private async finalize(): Promise<void> {
    if (this.finalized) return;
    this.finalized = true;
    if (this.sim.phase !== 'ended') this.sim.forceEnd(null, 'forfeit');

    const participants: ParticipantInput[] = [];
    for (const [sessionId, entry] of this.joined) {
      const player = this.sim.getPlayer(sessionId);
      if (!player || entry.userId.startsWith('guest_')) continue;
      const won = this.sim.winnerTeam !== null && this.sim.winnerTeam === entry.team;
      participants.push({
        userId: entry.userId,
        team: entry.team,
        classKey: entry.classKey,
        kills: player.stats.kills,
        deaths: player.stats.deaths,
        assists: player.stats.assists,
        damageDealt: player.stats.damageDealt,
        lumenGenerated: player.stats.lumenGenerated,
        mirrorsPlaced: player.stats.mirrorsPlaced,
        wellsCaptured: player.stats.wellsCaptured,
        timeInSunS: player.stats.timeInSunS,
        timeInDarkS: player.stats.timeInDarkS,
        xpEarned: 0,
        shardsEarned: 0,
        crawlerDestroyed: won && this.sim.winReason === 'core_destroyed',
        mirrorReveals: player.stats.revealsByMirror,
        won,
      });
    }

    if (participants.length === 0) return;
    try {
      const result = await this.store.finalizeMatch({
        matchId: this.sim.matchId,
        mode: this.mode,
        mapKey: this.sim.mapKey,
        serverVersion: this.env.SERVER_VERSION,
        startedAt: this.startedAt,
        endedAt: new Date(),
        winnerTeam: this.sim.winnerTeam,
        winReason: this.sim.winReason,
        participants,
      });
      for (const award of result.awards) {
        const sessionId = [...this.joined.entries()].find(([, e]) => e.userId === award.userId)?.[0];
        if (!sessionId) continue;
        this.clients.find((c) => c.sessionId === sessionId)?.send(ServerMessage.Reward, award);
      }
      log.info('match finalized', { matchId: this.sim.matchId, participants: participants.length });
    } catch (error) {
      log.error('failed to finalize match', { error: String(error), matchId: this.sim.matchId });
    }
  }
}

const BOT_NAMES_0 = ['رافن', 'زايرو', 'خالد', 'نوفا', 'سراج'];
const BOT_NAMES_1 = ['شادو', 'فايبر', 'ريزر', 'أمبر', 'دلتا'];

function botName(team: TeamId, index: number): string {
  const pool = team === 0 ? BOT_NAMES_0 : BOT_NAMES_1;
  return `${pool[index % pool.length]!} 🤖`;
}
