/** أسماء رسائل الشبكة بين العميل والخادم / wire message names, one place only. */
export const ClientMessage = {
  Input: 'input',
  Fire: 'fire',
  Ability: 'ability',
  Reload: 'reload',
  Grenade: 'grenade',
  SwitchClass: 'switch_class',
  CrawlerVote: 'crawler_vote',
  TeamSpend: 'team_spend',
  Ping: 'ping_mark',
  Chat: 'chat',
  Ready: 'ready',
  RequestRespawn: 'respawn',
  Latency: 'latency',
} as const;

export const ServerMessage = {
  Welcome: 'welcome',
  Snapshot: 'snapshot',
  HitConfirm: 'hit_confirm',
  Damaged: 'damaged',
  Killfeed: 'killfeed',
  MatchEnd: 'match_end',
  Announce: 'announce',
  Ping: 'ping_mark',
  Chat: 'chat',
  Reject: 'reject',
  Latency: 'latency',
  Reward: 'reward',
} as const;

export type ClientMessageName = (typeof ClientMessage)[keyof typeof ClientMessage];
export type ServerMessageName = (typeof ServerMessage)[keyof typeof ServerMessage];

export interface WelcomePayload {
  sessionId: string;
  matchId: string;
  mode: string;
  mapKey: string;
  mapSeed: number;
  team: 0 | 1;
  serverTimeMs: number;
  tickRate: number;
}

export interface HitConfirmPayload {
  targetId: string;
  damage: number;
  headshot: boolean;
  killed: boolean;
  /** المسافة لعرض مؤشر الإصابة */
  distance: number;
}

export interface DamagedPayload {
  amount: number;
  /** اتجاه مصدر الضرر بالراديان بالنسبة لشمال الخريطة */
  fromYaw: number;
  source: 'player' | 'heat' | 'cold' | 'fall' | 'explosion' | 'crawler';
  attackerName?: string;
}

export interface AnnouncePayload {
  key: string;
  params?: Record<string, string | number>;
  severity: 'info' | 'warning' | 'critical';
}

export interface RejectPayload {
  reason: string;
  detail?: string;
}
