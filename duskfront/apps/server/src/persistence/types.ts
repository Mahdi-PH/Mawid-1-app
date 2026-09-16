/**
 * واجهة التخزين: كل ما يحتاجه الخادم من قاعدة البيانات في مكان واحد.
 * The storage port. Two adapters implement it: Prisma/PostgreSQL for real deployments
 * and an in-memory adapter so the game (and its tests) run with zero infrastructure.
 */
import type { CampaignCheckpoint, ClassKey, Difficulty, PlayerSettingsBundle, TeamId } from '@duskfront/shared';

export interface UserRecord {
  id: string;
  email: string | null;
  passwordHash: string | null;
  isGuest: boolean;
  createdAt: Date;
  lastLoginAt: Date | null;
  bannedUntil: Date | null;
}

export interface ProfileRecord {
  userId: string;
  displayName: string;
  avatarId: string;
  level: number;
  xp: number;
  shards: number;
  rankRating: number;
  locale: string;
}

export interface StatsRecord {
  userId: string;
  matchesPlayed: number;
  wins: number;
  kills: number;
  deaths: number;
  assists: number;
  timeInSunS: number;
  timeInDarkS: number;
  crawlersDestroyed: number;
  wellsCaptured: number;
  mirrorReveals: number;
  lastWinDay: string | null;
}

export interface CatalogItemRecord {
  id: string;
  key: string;
  type: 'skin' | 'emblem' | 'banner' | 'emote';
  classKey: string | null;
  priceShards: number;
  rarity: string;
  nameKeyAr: string;
  nameKeyEn: string;
  colorPrimary: string;
  colorAccent: string;
}

export interface AchievementRecord {
  id: string;
  key: string;
  target: number;
  rewardShards: number;
  metric: string;
}

export interface DailyMissionRecord {
  id: string;
  key: string;
  target: number;
  rewardXp: number;
  rewardShards: number;
  metric: string;
}

export interface PlayerAchievementRecord {
  achievementId: string;
  key: string;
  target: number;
  rewardShards: number;
  progress: number;
  unlockedAt: Date | null;
}

export interface PlayerMissionRecord {
  missionId: string;
  key: string;
  target: number;
  rewardXp: number;
  rewardShards: number;
  assignedOn: string;
  progress: number;
  claimed: boolean;
}

export interface CampaignSaveRecord {
  slot: number;
  missionIndex: number;
  checkpoint: CampaignCheckpoint;
  difficulty: Difficulty;
  playTimeS: number;
  version: number;
  updatedAt: Date;
}

export interface LoadoutRecord {
  classKey: string;
  slot: number;
  config: Record<string, unknown>;
}

export interface MatchRecord {
  id: string;
  mode: string;
  mapKey: string;
  startedAt: Date;
  endedAt: Date | null;
  winnerTeam: number | null;
  winReason: string | null;
  serverVersion: string;
}

export interface ParticipantInput {
  userId: string;
  team: TeamId;
  classKey: ClassKey;
  kills: number;
  deaths: number;
  assists: number;
  damageDealt: number;
  lumenGenerated: number;
  mirrorsPlaced: number;
  wellsCaptured: number;
  timeInSunS: number;
  timeInDarkS: number;
  xpEarned: number;
  shardsEarned: number;
  crawlerDestroyed: boolean;
  mirrorReveals: number;
  won: boolean;
}

export interface LedgerEntry {
  id: string;
  delta: number;
  reason: string;
  refId: string | null;
  createdAt: Date;
}

export interface LeaderboardRow {
  userId: string;
  displayName: string;
  rankRating: number;
  level: number;
  wins: number;
  matchesPlayed: number;
}

export interface FriendRow {
  userId: string;
  displayName: string;
  status: 'pending' | 'accepted' | 'blocked';
  direction: 'outgoing' | 'incoming';
}

export interface RefreshTokenRecord {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
  deviceInfo: string | null;
}

export interface CreateUserInput {
  email: string | null;
  passwordHash: string | null;
  isGuest: boolean;
  displayName: string;
  locale: string;
}

export interface FinalizeMatchInput {
  matchId: string;
  mode: string;
  mapKey: string;
  serverVersion: string;
  startedAt: Date;
  endedAt: Date;
  winnerTeam: TeamId | null;
  winReason: string;
  participants: ParticipantInput[];
}

export interface FinalizeMatchResult {
  matchId: string;
  awards: {
    userId: string;
    xp: number;
    shards: number;
    newLevel: number;
    newXp: number;
    newShards: number;
    unlockedAchievements: string[];
    completedMissions: string[];
  }[];
}

/** منفذ التخزين / the storage port implemented by both adapters. */
export interface Store {
  readonly kind: 'prisma' | 'memory';
  init(): Promise<void>;
  close(): Promise<void>;

  // users + auth
  createUser(input: CreateUserInput): Promise<{ user: UserRecord; profile: ProfileRecord }>;
  findUserById(id: string): Promise<UserRecord | null>;
  findUserByEmail(email: string): Promise<UserRecord | null>;
  findProfileByDisplayName(name: string): Promise<ProfileRecord | null>;
  touchLogin(userId: string): Promise<void>;
  upgradeGuest(userId: string, email: string, passwordHash: string): Promise<UserRecord>;
  deleteUser(userId: string): Promise<void>;

  storeRefreshToken(userId: string, tokenHash: string, expiresAt: Date, deviceInfo: string | null): Promise<string>;
  findRefreshToken(tokenHash: string): Promise<RefreshTokenRecord | null>;
  revokeRefreshToken(id: string): Promise<void>;
  revokeAllRefreshTokens(userId: string): Promise<void>;

  // profile + settings
  getProfile(userId: string): Promise<ProfileRecord | null>;
  updateProfile(userId: string, patch: Partial<Pick<ProfileRecord, 'displayName' | 'avatarId' | 'locale'>>): Promise<ProfileRecord>;
  getSettings(userId: string): Promise<PlayerSettingsBundle | null>;
  putSettings(userId: string, settings: PlayerSettingsBundle): Promise<void>;
  getStats(userId: string): Promise<StatsRecord>;

  // loadouts + inventory + shop
  getLoadouts(userId: string, classKey: string): Promise<LoadoutRecord[]>;
  putLoadout(userId: string, classKey: string, slot: number, config: Record<string, unknown>): Promise<void>;
  getInventory(userId: string): Promise<CatalogItemRecord[]>;
  getCatalog(): Promise<CatalogItemRecord[]>;
  buyItem(userId: string, itemKey: string): Promise<{ ok: boolean; reason?: string; shards: number }>;

  // ledger
  appendLedger(userId: string, delta: number, reason: string, refId: string | null): Promise<void>;
  getLedger(userId: string): Promise<LedgerEntry[]>;
  ledgerSum(userId: string): Promise<number>;

  // progression content
  getAchievements(userId: string): Promise<PlayerAchievementRecord[]>;
  getMissions(userId: string, day: string): Promise<PlayerMissionRecord[]>;
  claimMission(userId: string, missionId: string, day: string): Promise<{ ok: boolean; reason?: string; xp: number; shards: number }>;

  // campaign saves
  getSave(userId: string, slot: number): Promise<CampaignSaveRecord | null>;
  listSaves(userId: string): Promise<CampaignSaveRecord[]>;
  putSave(
    userId: string,
    slot: number,
    data: { missionIndex: number; checkpoint: CampaignCheckpoint; difficulty: Difficulty; playTimeS: number; version: number },
  ): Promise<{ ok: true; save: CampaignSaveRecord } | { ok: false; conflict: CampaignSaveRecord }>;
  deleteSave(userId: string, slot: number): Promise<void>;

  // matches
  finalizeMatch(input: FinalizeMatchInput): Promise<FinalizeMatchResult>;
  getMatch(matchId: string): Promise<(MatchRecord & { participants: ParticipantInput[] }) | null>;
  getLeaderboard(mode: string, page: number, pageSize: number): Promise<{ rows: LeaderboardRow[]; total: number }>;

  // social
  listFriends(userId: string): Promise<FriendRow[]>;
  requestFriend(userId: string, friendId: string): Promise<{ ok: boolean; reason?: string }>;
  removeFriend(userId: string, friendId: string): Promise<void>;
  createReport(reporterId: string, reportedId: string, matchId: string | null, reason: string, details?: string): Promise<void>;

  // account data
  exportUser(userId: string): Promise<Record<string, unknown>>;
  banUser(userId: string, until: Date): Promise<void>;
}
