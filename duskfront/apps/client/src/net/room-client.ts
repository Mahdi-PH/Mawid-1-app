/**
 * عميل Colyseus: يحوّل حالة الغرفة إلى لقطة مباراة، ويعيد توجيه الأحداث.
 * Thin adapter over colyseus.js: it turns the synchronised room schema into the same
 * `MatchSnapshot` shape the offline simulation produces, so the rest of the client is
 * blind to whether a match is networked or local.
 */
import { Client, Room } from 'colyseus.js';
import {
  ClientMessage,
  ServerMessage,
  balance,
  type ClassKey,
  type CrawlerState,
  type MatchPhase,
  type MatchSnapshot,
  type PlayerPublicState,
  type StructureState,
  type TeamId,
  type WellState,
  type ZoneKey,
} from '@duskfront/shared';

const WS_BASE = (import.meta.env.VITE_WS_URL as string | undefined) ?? 'ws://localhost:2567';

export interface RoomEvents {
  onWelcome(payload: { sessionId: string; team: TeamId; matchId: string; mapSeed: number; tickRate: number }): void;
  onHitConfirm(payload: { targetId: string; damage: number; headshot: boolean; killed: boolean; distance: number }): void;
  onDamaged(payload: { amount: number; fromYaw: number; source: string; attackerName?: string }): void;
  onKillfeed(payload: {
    killerName: string;
    killerTeam: number;
    victimName: string;
    victimTeam: number;
    weapon: string;
    headshot: boolean;
  }): void;
  onAnnounce(payload: { key: string; severity: 'info' | 'warning' | 'critical'; params?: Record<string, string | number> }): void;
  onMatchEnd(payload: { winnerTeam: number | null; reason: string; scoreboard: PlayerPublicState[] }): void;
  onReward(payload: { xp: number; shards: number; newLevel: number; unlockedAchievements: string[] }): void;
  onReject(payload: { reason: string }): void;
  onPing(payload: { from: string; x: number; z: number; kind: string }): void;
  onChat(payload: { from: string; text: string }): void;
  onLeave(code: number): void;
  onError(message: string): void;
}

export class RoomClient {
  private client: Client | null = null;
  private room: Room | null = null;
  private latencyTimer: number | null = null;
  private lastPingSentAt = 0;
  private roundTrip = 0;

  get sessionId(): string {
    return this.room?.sessionId ?? '';
  }

  get connected(): boolean {
    return this.room !== null;
  }

  get ping(): number {
    return this.roundTrip;
  }

  async join(
    roomName: string,
    options: Record<string, unknown>,
    accessToken: string | null,
    events: Partial<RoomEvents>,
  ): Promise<void> {
    this.client = new Client(WS_BASE);
    this.room = await this.client.joinOrCreate(roomName, { ...options, accessToken: accessToken ?? undefined });

    this.room.onMessage(ServerMessage.Welcome, (payload) => events.onWelcome?.(payload));
    this.room.onMessage(ServerMessage.HitConfirm, (payload) => events.onHitConfirm?.(payload));
    this.room.onMessage(ServerMessage.Damaged, (payload) => events.onDamaged?.(payload));
    this.room.onMessage(ServerMessage.Killfeed, (payload) => events.onKillfeed?.(payload));
    this.room.onMessage(ServerMessage.Announce, (payload) => events.onAnnounce?.(payload));
    this.room.onMessage(ServerMessage.MatchEnd, (payload) => events.onMatchEnd?.(payload));
    this.room.onMessage(ServerMessage.Reward, (payload) => events.onReward?.(payload));
    this.room.onMessage(ServerMessage.Reject, (payload) => events.onReject?.(payload));
    this.room.onMessage(ServerMessage.Ping, (payload) => events.onPing?.(payload));
    this.room.onMessage(ServerMessage.Chat, (payload) => events.onChat?.(payload));
    this.room.onMessage(ServerMessage.Latency, (payload: { sentAt?: number }) => {
      if (payload?.sentAt) this.roundTrip = Date.now() - payload.sentAt;
    });

    this.room.onLeave((code) => {
      this.stopLatencyProbe();
      this.room = null;
      events.onLeave?.(code);
    });
    this.room.onError((code, message) => events.onError?.(message ?? `error_${code}`));

    this.startLatencyProbe();
  }

  /** قياس زمن الاستجابة دوريًا وإبلاغ الخادم به لتعويض التأخير. */
  private startLatencyProbe(): void {
    this.stopLatencyProbe();
    this.latencyTimer = window.setInterval(() => {
      if (!this.room) return;
      this.lastPingSentAt = Date.now();
      this.room.send(ClientMessage.Latency, { rtt: this.roundTrip, sentAt: this.lastPingSentAt });
    }, 2000);
  }

  private stopLatencyProbe(): void {
    if (this.latencyTimer !== null) window.clearInterval(this.latencyTimer);
    this.latencyTimer = null;
  }

  send(type: string, payload: unknown): void {
    this.room?.send(type, payload);
  }

  async leave(): Promise<void> {
    this.stopLatencyProbe();
    await this.room?.leave(true);
    this.room = null;
  }

  /** يحوّل حالة الغرفة الحالية إلى لقطة مباراة. */
  snapshot(): MatchSnapshot | null {
    const state = this.room?.state as RoomStateLike | undefined;
    // قد تصل أول رسالة قبل اكتمال المخطّط، فنتأكد من وجود كل المجموعات
    if (!state || !state.players || !state.crawlers || !state.wells || !state.structures) return null;

    const players: PlayerPublicState[] = [];
    state.players.forEach((player) => {
      players.push({
        id: player.id,
        userId: player.userId,
        name: player.name,
        team: player.team as TeamId,
        classKey: player.classKey as ClassKey,
        position: { x: player.x, y: player.y, z: player.z },
        velocity: { x: player.vx, y: player.vy, z: player.vz },
        yaw: player.yaw,
        pitch: player.pitch,
        grounded: player.grounded,
        crouching: player.crouching,
        lastSeq: player.lastSeq,
        health: player.health,
        maxHealth: player.maxHealth,
        shield: player.shield,
        lumen: player.lumen,
        light: player.light,
        zone: player.zone as ZoneKey,
        heat: player.heat,
        cold: player.cold,
        cloaked: player.cloaked,
        marked: player.marked,
        alive: player.alive,
        respawnAt: player.respawnAt,
        ultimateCharge: player.ultimateCharge,
        kills: player.kills,
        deaths: player.deaths,
        assists: player.assists,
        isBot: player.isBot,
        ping: player.ping,
      });
    });

    const crawlers: CrawlerState[] = state.crawlers.map((crawler) => ({
      team: crawler.team as TeamId,
      position: { x: crawler.x, y: crawler.y, z: crawler.z },
      integrity: crawler.integrity,
      coreHealth: crawler.coreHealth,
      coreMaxHealth: crawler.coreMaxHealth,
      coreShieldUntil: crawler.coreShieldUntil,
      outsideSince: crawler.outsideSince,
      steerOffset: crawler.steerOffset,
      boostUntil: crawler.boostUntil,
      zone: crawler.zone as ZoneKey,
    }));

    const wells: WellState[] = state.wells.map((well) => ({
      id: well.id,
      position: { x: well.x, z: well.z },
      owner: well.owner as TeamId | -1,
      progress: well.progress,
      capturingTeam: well.capturingTeam as TeamId | -1,
    }));

    const structures: StructureState[] = [];
    state.structures.forEach((structure) => {
      structures.push({
        id: structure.id,
        kind: structure.kind as StructureState['kind'],
        ownerId: structure.ownerId,
        team: structure.team as TeamId,
        position: { x: structure.x, y: structure.y, z: structure.z },
        yaw: structure.yaw,
        health: structure.health,
        maxHealth: structure.maxHealth,
        expiresAt: structure.expiresAt,
        radius: structure.radius > 0 ? structure.radius : undefined,
      });
    });

    return {
      tick: state.tick,
      timeSec: state.timeSec,
      duskX: state.duskX,
      players,
      crawlers,
      wells,
      structures,
      teamLumen: [state.teamLumen[0] ?? 0, state.teamLumen[1] ?? 0],
      teamScore: [state.teamScore[0] ?? 0, state.teamScore[1] ?? 0],
      phase: state.phase as MatchPhase,
    };
  }

  /** القذائف والضربات المعلّقة لعرضها كمؤثرات. */
  projectiles(): { grenades: { id: string; x: number; y: number; z: number; team: number }[]; strikes: { id: string; x: number; z: number; at: number; radius: number }[] } {
    const state = this.room?.state as RoomStateLike | undefined;
    if (!state?.grenades || !state.strikes) return { grenades: [], strikes: [] };
    return {
      grenades: state.grenades.map((g) => ({ id: g.id, x: g.x, y: g.y, z: g.z, team: g.team })),
      strikes: state.strikes.map((s) => ({ id: s.id, x: s.x, z: s.z, at: s.at, radius: s.radius })),
    };
  }

  get durationSec(): number {
    const state = this.room?.state as RoomStateLike | undefined;
    return state?.durationSec ?? balance.match.crawl.durationSec;
  }
}

/** شكل مبسّط لحالة الغرفة كما يراها العميل. */
interface RoomStateLike {
  tick: number;
  timeSec: number;
  durationSec: number;
  duskX: number;
  phase: string;
  teamLumen: number[];
  teamScore: number[];
  players: { forEach(cb: (value: PlayerSchemaLike, key: string) => void): void };
  crawlers: CrawlerSchemaLike[];
  wells: WellSchemaLike[];
  structures: { forEach(cb: (value: StructureSchemaLike, key: string) => void): void };
  grenades: { id: string; x: number; y: number; z: number; team: number }[];
  strikes: { id: string; x: number; z: number; at: number; radius: number }[];
}

interface PlayerSchemaLike {
  id: string; userId: string; name: string; team: number; classKey: string;
  x: number; y: number; z: number; vx: number; vy: number; vz: number;
  yaw: number; pitch: number; health: number; maxHealth: number; shield: number;
  lumen: number; light: number; zone: string; heat: number; cold: number;
  alive: boolean; cloaked: boolean; marked: boolean; crouching: boolean; grounded: boolean;
  respawnAt: number; ultimateCharge: number; kills: number; deaths: number; assists: number;
  ping: number; isBot: boolean; lastSeq: number; magazine: number; reserve: number;
  grenades: number; cooldownQ: number; cooldownE: number;
}

interface CrawlerSchemaLike {
  team: number; x: number; y: number; z: number; integrity: number;
  coreHealth: number; coreMaxHealth: number; coreShieldUntil: number;
  steerOffset: number; boostUntil: number; zone: string; outsideSince: number;
}

interface WellSchemaLike {
  id: number; x: number; z: number; owner: number; progress: number; capturingTeam: number;
}

interface StructureSchemaLike {
  id: string; kind: string; ownerId: string; team: number;
  x: number; y: number; z: number; yaw: number;
  health: number; maxHealth: number; expiresAt: number; radius: number;
}

/** الوصول إلى الحقول الخاصة باللاعب المحلي (ذخيرة، تبريد) من الحالة الموثوقة. */
export function readLocalWeaponState(
  client: RoomClient,
  sessionId: string,
): { magazine: number; reserve: number; grenades: number; cooldownQ: number; cooldownE: number } | null {
  const state = (client as unknown as { room: { state: RoomStateLike } | null }).room?.state;
  if (!state?.players) return null;
  let found: PlayerSchemaLike | null = null;
  state.players.forEach((player) => {
    if (player.id === sessionId) found = player;
  });
  if (!found) return null;
  const player = found as PlayerSchemaLike;
  return {
    magazine: player.magazine,
    reserve: player.reserve,
    grenades: player.grenades,
    cooldownQ: player.cooldownQ,
    cooldownE: player.cooldownE,
  };
}
