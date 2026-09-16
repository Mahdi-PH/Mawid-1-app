/**
 * مخزن داخل الذاكرة — يشغّل اللعبة كاملة بلا Postgres/Redis.
 * In-memory adapter. It exists so `npm run dev` (and the whole test suite) runs the
 * real game with zero infrastructure; production always uses the Prisma adapter.
 */
import { randomUUID } from 'node:crypto';
import {
  ACHIEVEMENTS,
  CATALOG,
  DAILY_MISSIONS,
  balance,
  computeMatchReward,
  levelFromXp,
  metricsFromParticipant,
  pickDailyMissions,
  updateElo,
  utcDayKey,
  type CampaignCheckpoint,
  type Difficulty,
  type PlayerSettingsBundle,
} from '@duskfront/shared';
import { defaultSettings } from '../services/defaults.js';
import type {
  AchievementRecord,
  CampaignSaveRecord,
  CatalogItemRecord,
  CreateUserInput,
  DailyMissionRecord,
  FinalizeMatchInput,
  FinalizeMatchResult,
  FriendRow,
  LeaderboardRow,
  LedgerEntry,
  LoadoutRecord,
  MatchRecord,
  ParticipantInput,
  PlayerAchievementRecord,
  PlayerMissionRecord,
  ProfileRecord,
  RefreshTokenRecord,
  StatsRecord,
  Store,
  UserRecord,
} from './types.js';

interface MemoryUser {
  user: UserRecord;
  profile: ProfileRecord;
  stats: StatsRecord;
  settings: PlayerSettingsBundle;
  inventory: Set<string>;
  loadouts: Map<string, LoadoutRecord>;
  achievements: Map<string, { progress: number; unlockedAt: Date | null }>;
  missions: Map<string, { progress: number; claimed: boolean; assignedOn: string }>;
  saves: Map<number, CampaignSaveRecord>;
  ledger: LedgerEntry[];
  friends: Map<string, 'pending' | 'accepted' | 'blocked'>;
}

export class MemoryStore implements Store {
  readonly kind = 'memory' as const;

  private readonly users = new Map<string, MemoryUser>();
  private readonly emailIndex = new Map<string, string>();
  private readonly nameIndex = new Map<string, string>();
  private readonly refreshTokens = new Map<string, RefreshTokenRecord>();
  private readonly matches = new Map<string, MatchRecord & { participants: ParticipantInput[] }>();
  private readonly catalog = new Map<string, CatalogItemRecord>();
  private readonly achievements = new Map<string, AchievementRecord>();
  private readonly missions = new Map<string, DailyMissionRecord>();
  private readonly reports: { id: string; reporterId: string; reportedId: string; matchId: string | null; reason: string; details?: string; createdAt: Date }[] = [];

  async init(): Promise<void> {
    for (const item of CATALOG) {
      this.catalog.set(item.key, { id: randomUUID(), ...item });
    }
    for (const a of ACHIEVEMENTS) {
      this.achievements.set(a.key, { id: randomUUID(), ...a });
    }
    for (const m of DAILY_MISSIONS) {
      this.missions.set(m.key, { id: randomUUID(), ...m });
    }
  }

  async close(): Promise<void> {
    /* nothing to release */
  }

  private require(userId: string): MemoryUser {
    const entry = this.users.get(userId);
    if (!entry) throw new Error(`[memory-store] unknown user ${userId}`);
    return entry;
  }

  // ───────────────────────────── users + auth ────────────────────────────────

  async createUser(input: CreateUserInput): Promise<{ user: UserRecord; profile: ProfileRecord }> {
    const id = randomUUID();
    const now = new Date();
    const user: UserRecord = {
      id,
      email: input.email,
      passwordHash: input.passwordHash,
      isGuest: input.isGuest,
      createdAt: now,
      lastLoginAt: now,
      bannedUntil: null,
    };
    const profile: ProfileRecord = {
      userId: id,
      displayName: input.displayName,
      avatarId: 'avatar_default',
      level: 1,
      xp: 0,
      shards: 0,
      rankRating: 1000,
      locale: input.locale,
    };
    const stats: StatsRecord = {
      userId: id,
      matchesPlayed: 0,
      wins: 0,
      kills: 0,
      deaths: 0,
      assists: 0,
      timeInSunS: 0,
      timeInDarkS: 0,
      crawlersDestroyed: 0,
      wellsCaptured: 0,
      mirrorReveals: 0,
      lastWinDay: null,
    };
    this.users.set(id, {
      user,
      profile,
      stats,
      settings: defaultSettings(input.locale),
      inventory: new Set(),
      loadouts: new Map(),
      achievements: new Map(),
      missions: new Map(),
      saves: new Map(),
      ledger: [],
      friends: new Map(),
    });
    if (input.email) this.emailIndex.set(input.email.toLowerCase(), id);
    this.nameIndex.set(input.displayName.toLowerCase(), id);
    return { user, profile };
  }

  async findUserById(id: string): Promise<UserRecord | null> {
    return this.users.get(id)?.user ?? null;
  }

  async findUserByEmail(email: string): Promise<UserRecord | null> {
    const id = this.emailIndex.get(email.toLowerCase());
    return id ? (this.users.get(id)?.user ?? null) : null;
  }

  async findProfileByDisplayName(name: string): Promise<ProfileRecord | null> {
    const id = this.nameIndex.get(name.toLowerCase());
    return id ? (this.users.get(id)?.profile ?? null) : null;
  }

  async touchLogin(userId: string): Promise<void> {
    this.require(userId).user.lastLoginAt = new Date();
  }

  async upgradeGuest(userId: string, email: string, passwordHash: string): Promise<UserRecord> {
    const entry = this.require(userId);
    entry.user.email = email;
    entry.user.passwordHash = passwordHash;
    entry.user.isGuest = false;
    this.emailIndex.set(email.toLowerCase(), userId);
    return entry.user;
  }

  async deleteUser(userId: string): Promise<void> {
    const entry = this.users.get(userId);
    if (!entry) return;
    if (entry.user.email) this.emailIndex.delete(entry.user.email.toLowerCase());
    this.nameIndex.delete(entry.profile.displayName.toLowerCase());
    this.users.delete(userId);
    for (const [hash, token] of this.refreshTokens) if (token.userId === userId) this.refreshTokens.delete(hash);
    for (const other of this.users.values()) other.friends.delete(userId);
  }

  async storeRefreshToken(userId: string, tokenHash: string, expiresAt: Date, deviceInfo: string | null): Promise<string> {
    const id = randomUUID();
    this.refreshTokens.set(tokenHash, { id, userId, tokenHash, expiresAt, revokedAt: null, deviceInfo });
    return id;
  }

  async findRefreshToken(tokenHash: string): Promise<RefreshTokenRecord | null> {
    return this.refreshTokens.get(tokenHash) ?? null;
  }

  async revokeRefreshToken(id: string): Promise<void> {
    for (const token of this.refreshTokens.values()) {
      if (token.id === id) token.revokedAt = new Date();
    }
  }

  async revokeAllRefreshTokens(userId: string): Promise<void> {
    for (const token of this.refreshTokens.values()) {
      if (token.userId === userId) token.revokedAt = new Date();
    }
  }

  // ───────────────────────────── profile + settings ──────────────────────────

  async getProfile(userId: string): Promise<ProfileRecord | null> {
    return this.users.get(userId)?.profile ?? null;
  }

  async updateProfile(
    userId: string,
    patch: Partial<Pick<ProfileRecord, 'displayName' | 'avatarId' | 'locale'>>,
  ): Promise<ProfileRecord> {
    const entry = this.require(userId);
    if (patch.displayName && patch.displayName !== entry.profile.displayName) {
      const taken = this.nameIndex.get(patch.displayName.toLowerCase());
      if (taken && taken !== userId) throw Object.assign(new Error('display name taken'), { code: 'NAME_TAKEN' });
      this.nameIndex.delete(entry.profile.displayName.toLowerCase());
      this.nameIndex.set(patch.displayName.toLowerCase(), userId);
      entry.profile.displayName = patch.displayName;
    }
    if (patch.avatarId) entry.profile.avatarId = patch.avatarId;
    if (patch.locale) entry.profile.locale = patch.locale;
    return entry.profile;
  }

  async getSettings(userId: string): Promise<PlayerSettingsBundle | null> {
    return this.users.get(userId)?.settings ?? null;
  }

  async putSettings(userId: string, settings: PlayerSettingsBundle): Promise<void> {
    this.require(userId).settings = settings;
  }

  async getStats(userId: string): Promise<StatsRecord> {
    return this.require(userId).stats;
  }

  // ───────────────────────────── loadouts + shop ─────────────────────────────

  async getLoadouts(userId: string, classKey: string): Promise<LoadoutRecord[]> {
    const entry = this.require(userId);
    return [...entry.loadouts.values()].filter((l) => l.classKey === classKey).sort((a, b) => a.slot - b.slot);
  }

  async putLoadout(userId: string, classKey: string, slot: number, config: Record<string, unknown>): Promise<void> {
    const entry = this.require(userId);
    entry.loadouts.set(`${classKey}:${slot}`, { classKey, slot, config });
  }

  async getInventory(userId: string): Promise<CatalogItemRecord[]> {
    const entry = this.require(userId);
    return [...entry.inventory].map((key) => this.catalog.get(key)!).filter(Boolean);
  }

  async getCatalog(): Promise<CatalogItemRecord[]> {
    return [...this.catalog.values()];
  }

  async buyItem(userId: string, itemKey: string): Promise<{ ok: boolean; reason?: string; shards: number }> {
    const entry = this.require(userId);
    const item = this.catalog.get(itemKey);
    if (!item) return { ok: false, reason: 'unknown_item', shards: entry.profile.shards };
    if (entry.inventory.has(itemKey)) return { ok: false, reason: 'already_owned', shards: entry.profile.shards };
    if (entry.profile.shards < item.priceShards) {
      return { ok: false, reason: 'insufficient_shards', shards: entry.profile.shards };
    }
    entry.profile.shards -= item.priceShards;
    entry.inventory.add(itemKey);
    entry.ledger.push({
      id: randomUUID(),
      delta: -item.priceShards,
      reason: 'shop_purchase',
      refId: itemKey,
      createdAt: new Date(),
    });
    return { ok: true, shards: entry.profile.shards };
  }

  // ───────────────────────────── ledger ──────────────────────────────────────

  async appendLedger(userId: string, delta: number, reason: string, refId: string | null): Promise<void> {
    const entry = this.require(userId);
    entry.ledger.push({ id: randomUUID(), delta, reason, refId, createdAt: new Date() });
    entry.profile.shards += delta;
  }

  async getLedger(userId: string): Promise<LedgerEntry[]> {
    return [...this.require(userId).ledger];
  }

  async ledgerSum(userId: string): Promise<number> {
    return this.require(userId).ledger.reduce((sum, e) => sum + e.delta, 0);
  }

  // ───────────────────────────── achievements + missions ─────────────────────

  async getAchievements(userId: string): Promise<PlayerAchievementRecord[]> {
    const entry = this.require(userId);
    return [...this.achievements.values()].map((a) => {
      const progress = entry.achievements.get(a.key);
      return {
        achievementId: a.id,
        key: a.key,
        target: a.target,
        rewardShards: a.rewardShards,
        progress: progress?.progress ?? 0,
        unlockedAt: progress?.unlockedAt ?? null,
      };
    });
  }

  async getMissions(userId: string, day: string): Promise<PlayerMissionRecord[]> {
    const entry = this.require(userId);
    const picked = pickDailyMissions(userId, day, balance.economy.dailyMissionCount);
    return picked.map((m) => {
      const def = this.missions.get(m.key)!;
      const state = entry.missions.get(`${m.key}:${day}`);
      return {
        missionId: def.id,
        key: m.key,
        target: m.target,
        rewardXp: m.rewardXp,
        rewardShards: m.rewardShards,
        assignedOn: day,
        progress: state?.progress ?? 0,
        claimed: state?.claimed ?? false,
      };
    });
  }

  async claimMission(
    userId: string,
    missionId: string,
    day: string,
  ): Promise<{ ok: boolean; reason?: string; xp: number; shards: number }> {
    const entry = this.require(userId);
    const def = [...this.missions.values()].find((m) => m.id === missionId);
    if (!def) return { ok: false, reason: 'unknown_mission', xp: 0, shards: 0 };
    const key = `${def.key}:${day}`;
    const state = entry.missions.get(key);
    if (!state) return { ok: false, reason: 'not_assigned', xp: 0, shards: 0 };
    if (state.claimed) return { ok: false, reason: 'already_claimed', xp: 0, shards: 0 };
    if (state.progress < def.target) return { ok: false, reason: 'incomplete', xp: 0, shards: 0 };
    state.claimed = true;
    entry.profile.xp += def.rewardXp;
    entry.profile.level = levelFromXp(entry.profile.xp).level;
    await this.appendLedger(userId, def.rewardShards, 'mission_reward', def.key);
    return { ok: true, xp: def.rewardXp, shards: def.rewardShards };
  }

  // ───────────────────────────── campaign saves ──────────────────────────────

  async getSave(userId: string, slot: number): Promise<CampaignSaveRecord | null> {
    return this.require(userId).saves.get(slot) ?? null;
  }

  async listSaves(userId: string): Promise<CampaignSaveRecord[]> {
    return [...this.require(userId).saves.values()].sort((a, b) => a.slot - b.slot);
  }

  async putSave(
    userId: string,
    slot: number,
    data: { missionIndex: number; checkpoint: CampaignCheckpoint; difficulty: Difficulty; playTimeS: number; version: number },
  ): Promise<{ ok: true; save: CampaignSaveRecord } | { ok: false; conflict: CampaignSaveRecord }> {
    const entry = this.require(userId);
    const existing = entry.saves.get(slot);
    if (existing && existing.version !== data.version) {
      return { ok: false, conflict: existing };
    }
    const save: CampaignSaveRecord = {
      slot,
      missionIndex: data.missionIndex,
      checkpoint: data.checkpoint,
      difficulty: data.difficulty,
      playTimeS: data.playTimeS,
      version: (existing?.version ?? 0) + 1,
      updatedAt: new Date(),
    };
    entry.saves.set(slot, save);
    return { ok: true, save };
  }

  async deleteSave(userId: string, slot: number): Promise<void> {
    this.require(userId).saves.delete(slot);
  }

  // ───────────────────────────── matches ─────────────────────────────────────

  async finalizeMatch(input: FinalizeMatchInput): Promise<FinalizeMatchResult> {
    const record: MatchRecord & { participants: ParticipantInput[] } = {
      id: input.matchId,
      mode: input.mode,
      mapKey: input.mapKey,
      startedAt: input.startedAt,
      endedAt: input.endedAt,
      winnerTeam: input.winnerTeam,
      winReason: input.winReason,
      serverVersion: input.serverVersion,
      participants: input.participants,
    };
    this.matches.set(input.matchId, record);

    const awards: FinalizeMatchResult['awards'] = [];
    const day = utcDayKey(input.endedAt);

    for (const p of input.participants) {
      const entry = this.users.get(p.userId);
      if (!entry) continue;

      const isFirstWinOfDay = p.won && entry.stats.lastWinDay !== day;
      const reward = computeMatchReward({
        participant: {
          userId: p.userId,
          team: p.team,
          classKey: p.classKey,
          kills: p.kills,
          deaths: p.deaths,
          assists: p.assists,
          damageDealt: p.damageDealt,
          lumenGenerated: p.lumenGenerated,
          mirrorsPlaced: p.mirrorsPlaced,
          wellsCaptured: p.wellsCaptured,
          timeInSunS: p.timeInSunS,
          timeInDarkS: p.timeInDarkS,
          isBot: false,
        },
        winnerTeam: input.winnerTeam,
        crawlerIntegrity: 100,
        isFirstWinOfDay,
      });

      entry.profile.xp += reward.xp;
      entry.profile.level = levelFromXp(entry.profile.xp).level;
      entry.profile.rankRating = updateElo(entry.profile.rankRating, 1000, p.won);
      await this.appendLedger(p.userId, reward.shards, 'match_reward', input.matchId);

      entry.stats.matchesPlayed += 1;
      entry.stats.wins += p.won ? 1 : 0;
      entry.stats.kills += Math.max(0, p.kills);
      entry.stats.deaths += p.deaths;
      entry.stats.assists += p.assists;
      entry.stats.timeInSunS += Math.round(p.timeInSunS);
      entry.stats.timeInDarkS += Math.round(p.timeInDarkS);
      entry.stats.crawlersDestroyed += p.crawlerDestroyed ? 1 : 0;
      entry.stats.wellsCaptured += p.wellsCaptured;
      entry.stats.mirrorReveals += p.mirrorReveals;
      if (p.won) entry.stats.lastWinDay = day;

      const metrics = metricsFromParticipant(p);
      const unlocked = this.applyAchievements(entry, metrics);
      const completed = this.applyMissions(entry, metrics, day, p.userId);

      awards.push({
        userId: p.userId,
        xp: reward.xp,
        shards: reward.shards,
        newLevel: entry.profile.level,
        newXp: entry.profile.xp,
        newShards: entry.profile.shards,
        unlockedAchievements: unlocked,
        completedMissions: completed,
      });
    }

    return { matchId: input.matchId, awards };
  }

  private applyAchievements(entry: MemoryUser, metrics: Record<string, number>): string[] {
    const unlocked: string[] = [];
    for (const def of this.achievements.values()) {
      const gained = metrics[def.metric] ?? 0;
      if (gained <= 0) continue;
      const current = entry.achievements.get(def.key) ?? { progress: 0, unlockedAt: null };
      if (current.unlockedAt) continue;
      current.progress += gained;
      if (current.progress >= def.target) {
        current.unlockedAt = new Date();
        entry.profile.shards += def.rewardShards;
        entry.ledger.push({
          id: randomUUID(),
          delta: def.rewardShards,
          reason: 'achievement_reward',
          refId: def.key,
          createdAt: new Date(),
        });
        unlocked.push(def.key);
      }
      entry.achievements.set(def.key, current);
    }
    return unlocked;
  }

  private applyMissions(entry: MemoryUser, metrics: Record<string, number>, day: string, userId: string): string[] {
    const completed: string[] = [];
    for (const m of pickDailyMissions(userId, day, balance.economy.dailyMissionCount)) {
      const gained = metrics[m.metric] ?? 0;
      if (gained <= 0) continue;
      const key = `${m.key}:${day}`;
      const state = entry.missions.get(key) ?? { progress: 0, claimed: false, assignedOn: day };
      state.progress += gained;
      entry.missions.set(key, state);
      if (state.progress >= m.target && !state.claimed) completed.push(m.key);
    }
    return completed;
  }

  async getMatch(matchId: string): Promise<(MatchRecord & { participants: ParticipantInput[] }) | null> {
    return this.matches.get(matchId) ?? null;
  }

  async getLeaderboard(_mode: string, page: number, pageSize: number): Promise<{ rows: LeaderboardRow[]; total: number }> {
    const all = [...this.users.values()]
      .filter((u) => u.stats.matchesPlayed > 0)
      .sort((a, b) => b.profile.rankRating - a.profile.rankRating);
    const start = (page - 1) * pageSize;
    return {
      total: all.length,
      rows: all.slice(start, start + pageSize).map((u) => ({
        userId: u.profile.userId,
        displayName: u.profile.displayName,
        rankRating: u.profile.rankRating,
        level: u.profile.level,
        wins: u.stats.wins,
        matchesPlayed: u.stats.matchesPlayed,
      })),
    };
  }

  // ───────────────────────────── social ──────────────────────────────────────

  async listFriends(userId: string): Promise<FriendRow[]> {
    const entry = this.require(userId);
    const rows: FriendRow[] = [];
    for (const [friendId, status] of entry.friends) {
      const friend = this.users.get(friendId);
      if (!friend) continue;
      rows.push({ userId: friendId, displayName: friend.profile.displayName, status, direction: 'outgoing' });
    }
    for (const [otherId, other] of this.users) {
      if (otherId === userId) continue;
      const status = other.friends.get(userId);
      if (status && !entry.friends.has(otherId)) {
        rows.push({ userId: otherId, displayName: other.profile.displayName, status, direction: 'incoming' });
      }
    }
    return rows;
  }

  async requestFriend(userId: string, friendId: string): Promise<{ ok: boolean; reason?: string }> {
    if (userId === friendId) return { ok: false, reason: 'self' };
    const entry = this.require(userId);
    const other = this.users.get(friendId);
    if (!other) return { ok: false, reason: 'unknown_user' };
    if (other.friends.get(userId) === 'pending') {
      other.friends.set(userId, 'accepted');
      entry.friends.set(friendId, 'accepted');
      return { ok: true };
    }
    entry.friends.set(friendId, 'pending');
    return { ok: true };
  }

  async removeFriend(userId: string, friendId: string): Promise<void> {
    this.require(userId).friends.delete(friendId);
    this.users.get(friendId)?.friends.delete(userId);
  }

  async createReport(
    reporterId: string,
    reportedId: string,
    matchId: string | null,
    reason: string,
    details?: string,
  ): Promise<void> {
    this.reports.push({ id: randomUUID(), reporterId, reportedId, matchId, reason, details, createdAt: new Date() });
  }

  // ───────────────────────────── account data ────────────────────────────────

  async exportUser(userId: string): Promise<Record<string, unknown>> {
    const entry = this.require(userId);
    return {
      user: { ...entry.user, passwordHash: undefined },
      profile: entry.profile,
      stats: entry.stats,
      settings: entry.settings,
      inventory: [...entry.inventory],
      loadouts: [...entry.loadouts.values()],
      achievements: [...entry.achievements.entries()],
      missions: [...entry.missions.entries()],
      saves: [...entry.saves.values()],
      ledger: entry.ledger,
      friends: [...entry.friends.entries()],
      exportedAt: new Date().toISOString(),
    };
  }

  async banUser(userId: string, until: Date): Promise<void> {
    this.require(userId).user.bannedUntil = until;
  }
}
