/**
 * محوّل Prisma/PostgreSQL — مخزن الإنتاج.
 * Prisma adapter. Rule from the spec: rewards, stats and currency are computed
 * server-side inside ONE transaction, and the shard balance must always equal the
 * sum of the currency ledger.
 */
import { Prisma, PrismaClient } from '@prisma/client';
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
  CampaignSaveRecord,
  CatalogItemRecord,
  CreateUserInput,
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

/** Prisma يقبل JSON غير معرَّف البنية؛ هذا المحوّل يوثّق النية بدل تكرار الـ cast. */
function asJson<T>(value: T): Prisma.InputJsonValue {
  return value as unknown as Prisma.InputJsonValue;
}

function fromJson<T>(value: Prisma.JsonValue): T {
  return value as unknown as T;
}

export class PrismaStore implements Store {
  readonly kind = 'prisma' as const;
  readonly prisma: PrismaClient;

  constructor(prisma?: PrismaClient) {
    this.prisma = prisma ?? new PrismaClient();
  }

  async init(): Promise<void> {
    await this.prisma.$connect();
  }

  async close(): Promise<void> {
    await this.prisma.$disconnect();
  }

  // ───────────────────────────── users + auth ────────────────────────────────

  async createUser(input: CreateUserInput): Promise<{ user: UserRecord; profile: ProfileRecord }> {
    const created = await this.prisma.user.create({
      data: {
        email: input.email,
        passwordHash: input.passwordHash,
        isGuest: input.isGuest,
        lastLoginAt: new Date(),
        profile: {
          create: {
            displayName: input.displayName,
            locale: input.locale,
          },
        },
        stats: { create: {} },
        settings: { create: settingsCreateData(input.locale) },
      },
      include: { profile: true },
    });
    return { user: toUser(created), profile: toProfile(created.profile!) };
  }

  async findUserById(id: string): Promise<UserRecord | null> {
    const row = await this.prisma.user.findUnique({ where: { id } });
    return row ? toUser(row) : null;
  }

  async findUserByEmail(email: string): Promise<UserRecord | null> {
    const row = await this.prisma.user.findUnique({ where: { email } });
    return row ? toUser(row) : null;
  }

  async findProfileByDisplayName(name: string): Promise<ProfileRecord | null> {
    const row = await this.prisma.profile.findUnique({ where: { displayName: name } });
    return row ? toProfile(row) : null;
  }

  async touchLogin(userId: string): Promise<void> {
    await this.prisma.user.update({ where: { id: userId }, data: { lastLoginAt: new Date() } });
  }

  async upgradeGuest(userId: string, email: string, passwordHash: string): Promise<UserRecord> {
    const row = await this.prisma.user.update({
      where: { id: userId },
      data: { email, passwordHash, isGuest: false },
    });
    return toUser(row);
  }

  async deleteUser(userId: string): Promise<void> {
    await this.prisma.user.delete({ where: { id: userId } });
  }

  async storeRefreshToken(userId: string, tokenHash: string, expiresAt: Date, deviceInfo: string | null): Promise<string> {
    const row = await this.prisma.refreshToken.create({
      data: { userId, tokenHash, expiresAt, deviceInfo },
    });
    return row.id;
  }

  async findRefreshToken(tokenHash: string): Promise<RefreshTokenRecord | null> {
    const row = await this.prisma.refreshToken.findUnique({ where: { tokenHash } });
    return row
      ? {
          id: row.id,
          userId: row.userId,
          tokenHash: row.tokenHash,
          expiresAt: row.expiresAt,
          revokedAt: row.revokedAt,
          deviceInfo: row.deviceInfo,
        }
      : null;
  }

  async revokeRefreshToken(id: string): Promise<void> {
    await this.prisma.refreshToken.update({ where: { id }, data: { revokedAt: new Date() } });
  }

  async revokeAllRefreshTokens(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  // ───────────────────────────── profile + settings ──────────────────────────

  async getProfile(userId: string): Promise<ProfileRecord | null> {
    const row = await this.prisma.profile.findUnique({ where: { userId } });
    return row ? toProfile(row) : null;
  }

  async updateProfile(
    userId: string,
    patch: Partial<Pick<ProfileRecord, 'displayName' | 'avatarId' | 'locale'>>,
  ): Promise<ProfileRecord> {
    const row = await this.prisma.profile.update({ where: { userId }, data: patch });
    return toProfile(row);
  }

  async getSettings(userId: string): Promise<PlayerSettingsBundle | null> {
    const row = await this.prisma.playerSettings.findUnique({ where: { userId } });
    if (!row) return null;
    return {
      graphics: fromJson<PlayerSettingsBundle['graphics']>(row.graphics),
      audio: fromJson<PlayerSettingsBundle['audio']>(row.audio),
      controls: fromJson<PlayerSettingsBundle['controls']>(row.controls),
      accessibility: fromJson<PlayerSettingsBundle['accessibility']>(row.accessibility),
    };
  }

  async putSettings(userId: string, settings: PlayerSettingsBundle): Promise<void> {
    await this.prisma.playerSettings.upsert({
      where: { userId },
      create: {
        userId,
        graphics: asJson(settings.graphics),
        audio: asJson(settings.audio),
        controls: asJson(settings.controls),
        accessibility: asJson(settings.accessibility),
      },
      update: {
        graphics: asJson(settings.graphics),
        audio: asJson(settings.audio),
        controls: asJson(settings.controls),
        accessibility: asJson(settings.accessibility),
      },
    });
  }

  async getStats(userId: string): Promise<StatsRecord> {
    const row = await this.prisma.playerStats.upsert({
      where: { userId },
      create: { userId },
      update: {},
    });
    return {
      userId: row.userId,
      matchesPlayed: row.matchesPlayed,
      wins: row.wins,
      kills: row.kills,
      deaths: row.deaths,
      assists: row.assists,
      timeInSunS: row.timeInSunS,
      timeInDarkS: row.timeInDarkS,
      crawlersDestroyed: row.crawlersDestroyed,
      wellsCaptured: row.wellsCaptured,
      mirrorReveals: row.mirrorReveals,
      lastWinDay: row.lastWinDay,
    };
  }

  // ───────────────────────────── loadouts + shop ─────────────────────────────

  async getLoadouts(userId: string, classKey: string): Promise<LoadoutRecord[]> {
    const rows = await this.prisma.loadout.findMany({ where: { userId, classKey }, orderBy: { slot: 'asc' } });
    return rows.map((r) => ({ classKey: r.classKey, slot: r.slot, config: fromJson<Record<string, unknown>>(r.config) }));
  }

  async putLoadout(userId: string, classKey: string, slot: number, config: Record<string, unknown>): Promise<void> {
    await this.prisma.loadout.upsert({
      where: { userId_classKey_slot: { userId, classKey, slot } },
      create: { userId, classKey, slot, config: asJson(config) },
      update: { config: asJson(config) },
    });
  }

  async getInventory(userId: string): Promise<CatalogItemRecord[]> {
    const rows = await this.prisma.playerInventory.findMany({ where: { userId }, include: { item: true } });
    return rows.map((r) => toCatalog(r.item));
  }

  async getCatalog(): Promise<CatalogItemRecord[]> {
    const rows = await this.prisma.catalogItem.findMany({ orderBy: { priceShards: 'asc' } });
    return rows.map(toCatalog);
  }

  async buyItem(userId: string, itemKey: string): Promise<{ ok: boolean; reason?: string; shards: number }> {
    return this.prisma.$transaction(async (tx) => {
      const profile = await tx.profile.findUnique({ where: { userId } });
      if (!profile) return { ok: false, reason: 'unknown_user', shards: 0 };
      const item = await tx.catalogItem.findUnique({ where: { key: itemKey } });
      if (!item) return { ok: false, reason: 'unknown_item', shards: profile.shards };
      const owned = await tx.playerInventory.findUnique({
        where: { userId_itemId: { userId, itemId: item.id } },
      });
      if (owned) return { ok: false, reason: 'already_owned', shards: profile.shards };
      if (profile.shards < item.priceShards) {
        return { ok: false, reason: 'insufficient_shards', shards: profile.shards };
      }
      const updated = await tx.profile.update({
        where: { userId },
        data: { shards: { decrement: item.priceShards } },
      });
      await tx.playerInventory.create({ data: { userId, itemId: item.id } });
      await tx.currencyLedger.create({
        data: { userId, delta: -item.priceShards, reason: 'shop_purchase', refId: itemKey },
      });
      return { ok: true, shards: updated.shards };
    });
  }

  // ───────────────────────────── ledger ──────────────────────────────────────

  async appendLedger(userId: string, delta: number, reason: string, refId: string | null): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.currencyLedger.create({ data: { userId, delta, reason, refId } }),
      this.prisma.profile.update({ where: { userId }, data: { shards: { increment: delta } } }),
    ]);
  }

  async getLedger(userId: string): Promise<LedgerEntry[]> {
    const rows = await this.prisma.currencyLedger.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((r) => ({ id: r.id, delta: r.delta, reason: r.reason, refId: r.refId, createdAt: r.createdAt }));
  }

  async ledgerSum(userId: string): Promise<number> {
    const agg = await this.prisma.currencyLedger.aggregate({ where: { userId }, _sum: { delta: true } });
    return agg._sum.delta ?? 0;
  }

  // ───────────────────────────── achievements + missions ─────────────────────

  async getAchievements(userId: string): Promise<PlayerAchievementRecord[]> {
    const defs = await this.prisma.achievement.findMany();
    const mine = await this.prisma.playerAchievement.findMany({ where: { userId } });
    const byId = new Map(mine.map((m) => [m.achievementId, m]));
    return defs.map((d) => {
      const state = byId.get(d.id);
      return {
        achievementId: d.id,
        key: d.key,
        target: d.target,
        rewardShards: d.rewardShards,
        progress: state?.progress ?? 0,
        unlockedAt: state?.unlockedAt ?? null,
      };
    });
  }

  async getMissions(userId: string, day: string): Promise<PlayerMissionRecord[]> {
    const picked = pickDailyMissions(userId, day, balance.economy.dailyMissionCount);
    const defs = await this.prisma.dailyMission.findMany({ where: { key: { in: picked.map((m) => m.key) } } });
    const assignedOn = new Date(`${day}T00:00:00.000Z`);
    const mine = await this.prisma.playerMission.findMany({
      where: { userId, assignedOn, missionId: { in: defs.map((d) => d.id) } },
    });
    const byId = new Map(mine.map((m) => [m.missionId, m]));
    return defs.map((d) => {
      const state = byId.get(d.id);
      return {
        missionId: d.id,
        key: d.key,
        target: d.target,
        rewardXp: d.rewardXp,
        rewardShards: d.rewardShards,
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
    const assignedOn = new Date(`${day}T00:00:00.000Z`);
    return this.prisma.$transaction(async (tx) => {
      const def = await tx.dailyMission.findUnique({ where: { id: missionId } });
      if (!def) return { ok: false, reason: 'unknown_mission', xp: 0, shards: 0 };
      const state = await tx.playerMission.findUnique({
        where: { userId_missionId_assignedOn: { userId, missionId, assignedOn } },
      });
      if (!state) return { ok: false, reason: 'not_assigned', xp: 0, shards: 0 };
      if (state.claimed) return { ok: false, reason: 'already_claimed', xp: 0, shards: 0 };
      if (state.progress < def.target) return { ok: false, reason: 'incomplete', xp: 0, shards: 0 };

      await tx.playerMission.update({
        where: { userId_missionId_assignedOn: { userId, missionId, assignedOn } },
        data: { claimed: true },
      });
      const profile = await tx.profile.update({
        where: { userId },
        data: { xp: { increment: def.rewardXp }, shards: { increment: def.rewardShards } },
      });
      await tx.profile.update({ where: { userId }, data: { level: levelFromXp(profile.xp).level } });
      await tx.currencyLedger.create({
        data: { userId, delta: def.rewardShards, reason: 'mission_reward', refId: def.key },
      });
      return { ok: true, xp: def.rewardXp, shards: def.rewardShards };
    });
  }

  // ───────────────────────────── campaign saves ──────────────────────────────

  async getSave(userId: string, slot: number): Promise<CampaignSaveRecord | null> {
    const row = await this.prisma.campaignSave.findUnique({ where: { userId_slot: { userId, slot } } });
    return row ? toSave(row) : null;
  }

  async listSaves(userId: string): Promise<CampaignSaveRecord[]> {
    const rows = await this.prisma.campaignSave.findMany({ where: { userId }, orderBy: { slot: 'asc' } });
    return rows.map(toSave);
  }

  /** حفظ بقفل تفاؤلي: يفشل إن تغيّرت النسخة على الخادم. */
  async putSave(
    userId: string,
    slot: number,
    data: { missionIndex: number; checkpoint: CampaignCheckpoint; difficulty: Difficulty; playTimeS: number; version: number },
  ): Promise<{ ok: true; save: CampaignSaveRecord } | { ok: false; conflict: CampaignSaveRecord }> {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.campaignSave.findUnique({ where: { userId_slot: { userId, slot } } });
      if (existing && existing.version !== data.version) {
        return { ok: false as const, conflict: toSave(existing) };
      }
      const row = existing
        ? await tx.campaignSave.update({
            where: { userId_slot: { userId, slot } },
            data: {
              missionIndex: data.missionIndex,
              checkpoint: asJson(data.checkpoint),
              difficulty: data.difficulty,
              playTimeS: data.playTimeS,
              version: { increment: 1 },
            },
          })
        : await tx.campaignSave.create({
            data: {
              userId,
              slot,
              missionIndex: data.missionIndex,
              checkpoint: asJson(data.checkpoint),
              difficulty: data.difficulty,
              playTimeS: data.playTimeS,
              version: 1,
            },
          });
      return { ok: true as const, save: toSave(row) };
    });
  }

  async deleteSave(userId: string, slot: number): Promise<void> {
    await this.prisma.campaignSave.deleteMany({ where: { userId, slot } });
  }

  // ───────────────────────────── matches ─────────────────────────────────────

  /** نهاية المباراة كلها داخل معاملة واحدة (قاعدة الحفظ رقم 1). */
  async finalizeMatch(input: FinalizeMatchInput): Promise<FinalizeMatchResult> {
    const day = utcDayKey(input.endedAt);
    const assignedOn = new Date(`${day}T00:00:00.000Z`);

    return this.prisma.$transaction(async (tx) => {
      await tx.match.create({
        data: {
          id: input.matchId,
          mode: input.mode,
          mapKey: input.mapKey,
          startedAt: input.startedAt,
          endedAt: input.endedAt,
          winnerTeam: input.winnerTeam,
          winReason: input.winReason,
          serverVersion: input.serverVersion,
        },
      });

      const achievements = await tx.achievement.findMany();
      const missionDefs = await tx.dailyMission.findMany();
      const missionByKey = new Map(missionDefs.map((m) => [m.key, m]));
      const awards: FinalizeMatchResult['awards'] = [];

      for (const p of input.participants) {
        const profile = await tx.profile.findUnique({ where: { userId: p.userId } });
        if (!profile) continue;
        const stats = await tx.playerStats.upsert({
          where: { userId: p.userId },
          create: { userId: p.userId },
          update: {},
        });

        const isFirstWinOfDay = p.won && stats.lastWinDay !== day;
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

        await tx.matchParticipant.create({
          data: {
            matchId: input.matchId,
            userId: p.userId,
            team: p.team,
            classKey: p.classKey,
            kills: Math.max(0, p.kills),
            deaths: p.deaths,
            assists: p.assists,
            damageDealt: Math.round(p.damageDealt),
            lumenGenerated: Math.round(p.lumenGenerated),
            mirrorsPlaced: p.mirrorsPlaced,
            xpEarned: reward.xp,
            shardsEarned: reward.shards,
          },
        });

        const newXp = profile.xp + reward.xp;
        const updatedProfile = await tx.profile.update({
          where: { userId: p.userId },
          data: {
            xp: newXp,
            level: levelFromXp(newXp).level,
            shards: { increment: reward.shards },
            rankRating: updateElo(profile.rankRating, 1000, p.won),
          },
        });
        await tx.currencyLedger.create({
          data: { userId: p.userId, delta: reward.shards, reason: 'match_reward', refId: input.matchId },
        });

        await tx.playerStats.update({
          where: { userId: p.userId },
          data: {
            matchesPlayed: { increment: 1 },
            wins: { increment: p.won ? 1 : 0 },
            kills: { increment: Math.max(0, p.kills) },
            deaths: { increment: p.deaths },
            assists: { increment: p.assists },
            timeInSunS: { increment: Math.round(p.timeInSunS) },
            timeInDarkS: { increment: Math.round(p.timeInDarkS) },
            crawlersDestroyed: { increment: p.crawlerDestroyed ? 1 : 0 },
            wellsCaptured: { increment: p.wellsCaptured },
            mirrorReveals: { increment: p.mirrorReveals },
            lastWinDay: p.won ? day : stats.lastWinDay,
          },
        });

        const metrics = metricsFromParticipant(p);
        const unlockedAchievements: string[] = [];
        for (const def of achievements) {
          const gained = metrics[def.metric] ?? 0;
          if (gained <= 0) continue;
          const current = await tx.playerAchievement.upsert({
            where: { userId_achievementId: { userId: p.userId, achievementId: def.id } },
            create: { userId: p.userId, achievementId: def.id, progress: 0 },
            update: {},
          });
          if (current.unlockedAt) continue;
          const progress = current.progress + gained;
          const unlocked = progress >= def.target;
          await tx.playerAchievement.update({
            where: { userId_achievementId: { userId: p.userId, achievementId: def.id } },
            data: { progress, unlockedAt: unlocked ? new Date() : null },
          });
          if (unlocked) {
            await tx.profile.update({
              where: { userId: p.userId },
              data: { shards: { increment: def.rewardShards } },
            });
            await tx.currencyLedger.create({
              data: { userId: p.userId, delta: def.rewardShards, reason: 'achievement_reward', refId: def.key },
            });
            unlockedAchievements.push(def.key);
          }
        }

        const completedMissions: string[] = [];
        for (const m of pickDailyMissions(p.userId, day, balance.economy.dailyMissionCount)) {
          const def = missionByKey.get(m.key);
          if (!def) continue;
          const gained = metrics[def.metric] ?? 0;
          if (gained <= 0) continue;
          const current = await tx.playerMission.upsert({
            where: { userId_missionId_assignedOn: { userId: p.userId, missionId: def.id, assignedOn } },
            create: { userId: p.userId, missionId: def.id, assignedOn, progress: 0, claimed: false },
            update: {},
          });
          const progress = current.progress + gained;
          await tx.playerMission.update({
            where: { userId_missionId_assignedOn: { userId: p.userId, missionId: def.id, assignedOn } },
            data: { progress },
          });
          if (progress >= def.target && !current.claimed) completedMissions.push(def.key);
        }

        const finalProfile = await tx.profile.findUnique({ where: { userId: p.userId } });
        awards.push({
          userId: p.userId,
          xp: reward.xp,
          shards: reward.shards,
          newLevel: updatedProfile.level,
          newXp: updatedProfile.xp,
          newShards: finalProfile?.shards ?? updatedProfile.shards,
          unlockedAchievements,
          completedMissions,
        });
      }

      return { matchId: input.matchId, awards };
    }, { timeout: 20_000 });
  }

  async getMatch(matchId: string): Promise<(MatchRecord & { participants: ParticipantInput[] }) | null> {
    const row = await this.prisma.match.findUnique({ where: { id: matchId }, include: { participants: true } });
    if (!row) return null;
    return {
      id: row.id,
      mode: row.mode,
      mapKey: row.mapKey,
      startedAt: row.startedAt,
      endedAt: row.endedAt,
      winnerTeam: row.winnerTeam,
      winReason: row.winReason,
      serverVersion: row.serverVersion,
      participants: row.participants.map((p) => ({
        userId: p.userId,
        team: (p.team === 0 ? 0 : 1) as 0 | 1,
        classKey: p.classKey as ParticipantInput['classKey'],
        kills: p.kills,
        deaths: p.deaths,
        assists: p.assists,
        damageDealt: p.damageDealt,
        lumenGenerated: p.lumenGenerated,
        mirrorsPlaced: p.mirrorsPlaced,
        wellsCaptured: 0,
        timeInSunS: 0,
        timeInDarkS: 0,
        xpEarned: p.xpEarned,
        shardsEarned: p.shardsEarned,
        crawlerDestroyed: false,
        mirrorReveals: 0,
        won: row.winnerTeam === p.team,
      })),
    };
  }

  async getLeaderboard(_mode: string, page: number, pageSize: number): Promise<{ rows: LeaderboardRow[]; total: number }> {
    const [total, rows] = await Promise.all([
      this.prisma.profile.count(),
      this.prisma.profile.findMany({
        orderBy: { rankRating: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { user: { include: { stats: true } } },
      }),
    ]);
    return {
      total,
      rows: rows.map((r) => ({
        userId: r.userId,
        displayName: r.displayName,
        rankRating: r.rankRating,
        level: r.level,
        wins: r.user.stats?.wins ?? 0,
        matchesPlayed: r.user.stats?.matchesPlayed ?? 0,
      })),
    };
  }

  // ───────────────────────────── social ──────────────────────────────────────

  async listFriends(userId: string): Promise<FriendRow[]> {
    const [out, incoming] = await Promise.all([
      this.prisma.friendship.findMany({ where: { userId }, include: { friend: { include: { profile: true } } } }),
      this.prisma.friendship.findMany({ where: { friendId: userId }, include: { user: { include: { profile: true } } } }),
    ]);
    const rows: FriendRow[] = out.map((f) => ({
      userId: f.friendId,
      displayName: f.friend.profile?.displayName ?? '—',
      status: f.status as FriendRow['status'],
      direction: 'outgoing',
    }));
    for (const f of incoming) {
      if (rows.some((r) => r.userId === f.userId)) continue;
      rows.push({
        userId: f.userId,
        displayName: f.user.profile?.displayName ?? '—',
        status: f.status as FriendRow['status'],
        direction: 'incoming',
      });
    }
    return rows;
  }

  async requestFriend(userId: string, friendId: string): Promise<{ ok: boolean; reason?: string }> {
    if (userId === friendId) return { ok: false, reason: 'self' };
    const other = await this.prisma.user.findUnique({ where: { id: friendId } });
    if (!other) return { ok: false, reason: 'unknown_user' };
    const reverse = await this.prisma.friendship.findUnique({
      where: { userId_friendId: { userId: friendId, friendId: userId } },
    });
    if (reverse && reverse.status === 'pending') {
      await this.prisma.$transaction([
        this.prisma.friendship.update({
          where: { userId_friendId: { userId: friendId, friendId: userId } },
          data: { status: 'accepted' },
        }),
        this.prisma.friendship.upsert({
          where: { userId_friendId: { userId, friendId } },
          create: { userId, friendId, status: 'accepted' },
          update: { status: 'accepted' },
        }),
      ]);
      return { ok: true };
    }
    await this.prisma.friendship.upsert({
      where: { userId_friendId: { userId, friendId } },
      create: { userId, friendId, status: 'pending' },
      update: {},
    });
    return { ok: true };
  }

  async removeFriend(userId: string, friendId: string): Promise<void> {
    await this.prisma.friendship.deleteMany({
      where: { OR: [{ userId, friendId }, { userId: friendId, friendId: userId }] },
    });
  }

  async createReport(
    reporterId: string,
    reportedId: string,
    matchId: string | null,
    reason: string,
    details?: string,
  ): Promise<void> {
    await this.prisma.playerReport.create({ data: { reporterId, reportedId, matchId, reason, details } });
  }

  // ───────────────────────────── account data ────────────────────────────────

  async exportUser(userId: string): Promise<Record<string, unknown>> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        profile: true,
        stats: true,
        settings: true,
        inventory: { include: { item: true } },
        loadouts: true,
        achievements: { include: { achievement: true } },
        missions: { include: { mission: true } },
        campaignSaves: true,
        ledger: true,
        participations: true,
        friendshipsOut: true,
      },
    });
    if (!user) return {};
    const { passwordHash, ...safe } = user;
    void passwordHash;
    return { ...safe, exportedAt: new Date().toISOString() };
  }

  async banUser(userId: string, until: Date): Promise<void> {
    await this.prisma.user.update({ where: { id: userId }, data: { bannedUntil: until } });
  }

  /** يملأ الكتالوج والإنجازات والمهام (يستدعيه seed.ts). */
  async seedContent(): Promise<void> {
    for (const item of CATALOG) {
      await this.prisma.catalogItem.upsert({ where: { key: item.key }, create: item, update: item });
    }
    for (const a of ACHIEVEMENTS) {
      await this.prisma.achievement.upsert({ where: { key: a.key }, create: a, update: a });
    }
    for (const m of DAILY_MISSIONS) {
      await this.prisma.dailyMission.upsert({ where: { key: m.key }, create: m, update: m });
    }
  }
}

function settingsCreateData(locale: string) {
  const defaults = defaultSettings(locale);
  return {
    graphics: asJson(defaults.graphics),
    audio: asJson(defaults.audio),
    controls: asJson(defaults.controls),
    accessibility: asJson(defaults.accessibility),
  };
}

function toUser(row: {
  id: string;
  email: string | null;
  passwordHash: string | null;
  isGuest: boolean;
  createdAt: Date;
  lastLoginAt: Date | null;
  bannedUntil: Date | null;
}): UserRecord {
  return {
    id: row.id,
    email: row.email,
    passwordHash: row.passwordHash,
    isGuest: row.isGuest,
    createdAt: row.createdAt,
    lastLoginAt: row.lastLoginAt,
    bannedUntil: row.bannedUntil,
  };
}

function toProfile(row: {
  userId: string;
  displayName: string;
  avatarId: string;
  level: number;
  xp: number;
  shards: number;
  rankRating: number;
  locale: string;
}): ProfileRecord {
  return { ...row };
}

function toCatalog(row: {
  id: string;
  key: string;
  type: string;
  classKey: string | null;
  priceShards: number;
  rarity: string;
  nameKeyAr: string;
  nameKeyEn: string;
  colorPrimary: string;
  colorAccent: string;
}): CatalogItemRecord {
  return { ...row, type: row.type as CatalogItemRecord['type'] };
}

function toSave(row: {
  slot: number;
  missionIndex: number;
  checkpoint: unknown;
  difficulty: string;
  playTimeS: number;
  version: number;
  updatedAt: Date;
}): CampaignSaveRecord {
  return {
    slot: row.slot,
    missionIndex: row.missionIndex,
    checkpoint: row.checkpoint as unknown as CampaignCheckpoint,
    difficulty: row.difficulty as Difficulty,
    playTimeS: row.playTimeS,
    version: row.version,
    updatedAt: row.updatedAt,
  };
}
