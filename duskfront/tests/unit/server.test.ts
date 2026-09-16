/**
 * الخادم: المصادقة، الاقتصاد، الحفظ، مكافحة الغش، والتحقق من المدخلات.
 * Server-side rules, including the spec's hard invariant: a player's shard balance must
 * always equal the sum of their currency ledger.
 */
import { describe, expect, it } from 'vitest';
import { balance, levelFromXp, computeMatchReward, updateElo, utcDayKey, xpForNextLevel } from '@duskfront/shared';
import {
  zCampaignSavePut,
  zInputCommand,
  zLoginBody,
  zRegisterBody,
  zSettingsBundle,
} from '@duskfront/shared';
import { AntiCheat } from '../../apps/server/src/anticheat/validator.js';
import { hashPassword, verifyPassword } from '../../apps/server/src/auth/passwords.js';
import { generateRefreshToken, hashToken, safeEqual } from '../../apps/server/src/auth/tokens.js';
import { MemoryStore } from '../../apps/server/src/persistence/memory-store.js';
import { eloBucket, pingBucket } from '../../apps/server/src/api/matchmaking.routes.js';
import { metricsFromParticipant, pickDailyMissions } from '../../apps/server/src/services/content.js';
import type { ParticipantInput } from '../../apps/server/src/persistence/types.js';

async function freshStore(): Promise<MemoryStore> {
  const store = new MemoryStore();
  await store.init();
  return store;
}

function participant(overrides: Partial<ParticipantInput> = {}): ParticipantInput {
  return {
    userId: 'u',
    team: 0,
    classKey: 'guardian',
    kills: 5,
    deaths: 2,
    assists: 3,
    damageDealt: 1200,
    lumenGenerated: 400,
    mirrorsPlaced: 2,
    wellsCaptured: 1,
    timeInSunS: 60,
    timeInDarkS: 30,
    xpEarned: 0,
    shardsEarned: 0,
    crawlerDestroyed: false,
    mirrorReveals: 1,
    won: true,
    ...overrides,
  };
}

describe('كلمات المرور / argon2id passwords', () => {
  it('تُجزّأ بـ argon2id ويمكن التحقق منها', async () => {
    const hash = await hashPassword('correct horse battery 9');
    expect(hash.startsWith('$argon2id$')).toBe(true);
    expect(await verifyPassword(hash, 'correct horse battery 9')).toBe(true);
    expect(await verifyPassword(hash, 'wrong password 1')).toBe(false);
  });

  it('لا تنتج نفس التجزئة لنفس الكلمة (ملح عشوائي)', async () => {
    const a = await hashPassword('same password 1');
    const b = await hashPassword('same password 1');
    expect(a).not.toBe(b);
  });
});

describe('رموز التحديث / refresh tokens', () => {
  it('تُخزَّن مُجزّأة لا كنص صريح', () => {
    const token = generateRefreshToken();
    const hash = hashToken(token);
    expect(hash).not.toBe(token);
    expect(hash).toHaveLength(64);
    expect(hashToken(token)).toBe(hash);
  });

  it('المقارنة الآمنة تعمل', () => {
    const token = generateRefreshToken();
    expect(safeEqual(token, token)).toBe(true);
    expect(safeEqual(token, generateRefreshToken())).toBe(false);
  });
});

describe('حسابات الضيوف والترقية / guest upgrade', () => {
  it('ترقية الضيف تحافظ على كل بياناته', async () => {
    const store = await freshStore();
    const { user } = await store.createUser({
      email: null,
      passwordHash: null,
      isGuest: true,
      displayName: 'ضيف تجريبي',
      locale: 'ar',
    });
    await store.appendLedger(user.id, 500, 'test_grant', null);
    await store.putLoadout(user.id, 'guardian', 1, { primarySkinKey: null });

    const upgraded = await store.upgradeGuest(user.id, 'player@example.com', await hashPassword('a-strong-pass-1'));
    expect(upgraded.isGuest).toBe(false);
    expect(upgraded.id).toBe(user.id);

    const profile = await store.getProfile(user.id);
    expect(profile?.shards).toBe(500);
    expect(await store.getLoadouts(user.id, 'guardian')).toHaveLength(1);
    expect(await store.findUserByEmail('player@example.com')).not.toBeNull();
  });

  it('حذف الحساب يزيل كل بياناته', async () => {
    const store = await freshStore();
    const { user } = await store.createUser({
      email: 'gone@example.com',
      passwordHash: 'x',
      isGuest: false,
      displayName: 'للحذف',
      locale: 'ar',
    });
    await store.deleteUser(user.id);
    expect(await store.findUserById(user.id)).toBeNull();
    expect(await store.findUserByEmail('gone@example.com')).toBeNull();
  });
});

describe('سجل العملة / the currency ledger invariant', () => {
  it('الرصيد يساوي مجموع السجل بعد كل عملية', async () => {
    const store = await freshStore();
    const { user } = await store.createUser({
      email: null,
      passwordHash: null,
      isGuest: true,
      displayName: 'محاسب',
      locale: 'ar',
    });

    const assertBalanced = async (): Promise<void> => {
      const profile = await store.getProfile(user.id);
      const sum = await store.ledgerSum(user.id);
      expect(profile?.shards).toBe(sum);
    };

    await assertBalanced();
    await store.appendLedger(user.id, 250, 'match_reward', 'm1');
    await assertBalanced();
    await store.appendLedger(user.id, 75, 'mission_reward', 'mis.kills_10');
    await assertBalanced();

    const catalog = await store.getCatalog();
    const affordable = catalog.filter((item) => item.priceShards <= 325).sort((a, b) => a.priceShards - b.priceShards)[0]!;
    const purchase = await store.buyItem(user.id, affordable.key);
    expect(purchase.ok).toBe(true);
    await assertBalanced();

    // شراء مكرّر يُرفض ولا يغيّر الرصيد
    const duplicate = await store.buyItem(user.id, affordable.key);
    expect(duplicate.ok).toBe(false);
    expect(duplicate.reason).toBe('already_owned');
    await assertBalanced();
  });

  it('يرفض الشراء عند نقص الشظايا', async () => {
    const store = await freshStore();
    const { user } = await store.createUser({
      email: null,
      passwordHash: null,
      isGuest: true,
      displayName: 'فقير',
      locale: 'ar',
    });
    const expensive = (await store.getCatalog()).sort((a, b) => b.priceShards - a.priceShards)[0]!;
    const result = await store.buyItem(user.id, expensive.key);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('insufficient_shards');
    expect(await store.ledgerSum(user.id)).toBe(0);
  });

  it('نهاية المباراة تحسب المكافآت وتحفظ الإحصاءات في عملية واحدة', async () => {
    const store = await freshStore();
    const { user } = await store.createUser({
      email: null,
      passwordHash: null,
      isGuest: true,
      displayName: 'لاعب',
      locale: 'ar',
    });

    const result = await store.finalizeMatch({
      matchId: '11111111-1111-4111-8111-111111111111',
      mode: 'crawl',
      mapKey: balance.map.key,
      serverVersion: '1.0.0',
      startedAt: new Date(Date.now() - 60_000),
      endedAt: new Date(),
      winnerTeam: 0,
      winReason: 'core_destroyed',
      participants: [participant({ userId: user.id })],
    });

    expect(result.awards).toHaveLength(1);
    const award = result.awards[0]!;
    expect(award.xp).toBeGreaterThan(balance.progression.matchXp.win);
    expect(award.shards).toBeGreaterThanOrEqual(balance.progression.shards.win);

    const stats = await store.getStats(user.id);
    expect(stats.matchesPlayed).toBe(1);
    expect(stats.wins).toBe(1);
    expect(stats.kills).toBe(5);

    const profile = await store.getProfile(user.id);
    expect(profile?.shards).toBe(await store.ledgerSum(user.id));
    expect(await store.getMatch('11111111-1111-4111-8111-111111111111')).not.toBeNull();
  });

  it('لا يُقبل أي رقم يرسله العميل — المكافأة تُحسب من الإحصاءات', () => {
    const inflated = computeMatchReward({
      participant: { ...participant(), kills: 5 },
      winnerTeam: 0,
      crawlerIntegrity: 100,
      isFirstWinOfDay: false,
    });
    const honest = computeMatchReward({
      participant: { ...participant(), kills: 5, xpEarned: 999_999, shardsEarned: 999_999 } as never,
      winnerTeam: 0,
      crawlerIntegrity: 100,
      isFirstWinOfDay: false,
    });
    expect(honest.xp).toBe(inflated.xp);
    expect(honest.shards).toBe(inflated.shards);
  });
});

describe('التقدّم / progression maths', () => {
  it('منحنى الخبرة يطابق الصيغة المنصوص عليها', () => {
    for (const level of [1, 10, 25, 50]) {
      expect(xpForNextLevel(level)).toBe(balance.progression.xpBase + balance.progression.xpPerLevel * level);
    }
  });

  it('المستوى يُشتق من إجمالي الخبرة ولا يتجاوز الحد', () => {
    expect(levelFromXp(0).level).toBe(1);
    expect(levelFromXp(xpForNextLevel(1)).level).toBe(2);
    expect(levelFromXp(50_000_000).level).toBe(balance.progression.maxLevel);
  });

  it('التصنيف يرتفع بالفوز وينخفض بالخسارة', () => {
    expect(updateElo(1000, 1000, true)).toBeGreaterThan(1000);
    expect(updateElo(1000, 1000, false)).toBeLessThan(1000);
  });

  it('عدّادات المباراة تغذّي الإنجازات الصحيحة', () => {
    const metrics = metricsFromParticipant(participant({ won: true, timeInSunS: 1, timeInDarkS: 900, deaths: 0 }));
    expect(metrics.nightWin).toBe(1);
    expect(metrics.sunWin).toBe(0);
    expect(metrics.flawlessWin).toBe(1);
    expect(metrics.matches).toBe(1);
  });

  it('المهام اليومية ثابتة لليوم نفسه ومختلفة بين الأيام', () => {
    const today = pickDailyMissions('user-1', '2026-09-16', balance.economy.dailyMissionCount);
    const again = pickDailyMissions('user-1', '2026-09-16', balance.economy.dailyMissionCount);
    const tomorrow = pickDailyMissions('user-1', '2026-09-17', balance.economy.dailyMissionCount);
    expect(today.map((m) => m.key)).toEqual(again.map((m) => m.key));
    expect(today).toHaveLength(balance.economy.dailyMissionCount);
    expect(new Set(today.map((m) => m.key)).size).toBe(balance.economy.dailyMissionCount);
    expect(today.map((m) => m.key)).not.toEqual(tomorrow.map((m) => m.key));
  });

  it('مفتاح اليوم بتوقيت UTC', () => {
    expect(utcDayKey(new Date('2026-09-16T23:59:00Z'))).toBe('2026-09-16');
    expect(utcDayKey(new Date('2026-09-17T00:01:00Z'))).toBe('2026-09-17');
  });
});

describe('حفظ الحملة / campaign saves', () => {
  const checkpoint = {
    missionIndex: 0,
    objectiveIndex: 1,
    playerHealth: 200,
    playerLumen: 50,
    position: { x: 1, y: 2, z: 3 },
    flags: { intro: true },
    score: 100,
  };

  it('يزيد رقم النسخة عند كل حفظ', async () => {
    const store = await freshStore();
    const { user } = await store.createUser({
      email: null,
      passwordHash: null,
      isGuest: true,
      displayName: 'حافظ',
      locale: 'ar',
    });
    const first = await store.putSave(user.id, 1, {
      missionIndex: 0,
      checkpoint,
      difficulty: 'normal',
      playTimeS: 60,
      version: 0,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.save.version).toBe(1);

    const second = await store.putSave(user.id, 1, {
      missionIndex: 1,
      checkpoint,
      difficulty: 'normal',
      playTimeS: 120,
      version: 1,
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.save.version).toBe(2);
  });

  it('القفل التفاؤلي يكشف التعارض ويعيد نسخة الخادم', async () => {
    const store = await freshStore();
    const { user } = await store.createUser({
      email: null,
      passwordHash: null,
      isGuest: true,
      displayName: 'متعارض',
      locale: 'ar',
    });
    await store.putSave(user.id, 1, { missionIndex: 0, checkpoint, difficulty: 'normal', playTimeS: 10, version: 0 });
    await store.putSave(user.id, 1, { missionIndex: 1, checkpoint, difficulty: 'normal', playTimeS: 20, version: 1 });

    // جهاز آخر ما زال يحمل النسخة 1
    const stale = await store.putSave(user.id, 1, {
      missionIndex: 5,
      checkpoint,
      difficulty: 'hard',
      playTimeS: 999,
      version: 1,
    });
    expect(stale.ok).toBe(false);
    if (stale.ok) return;
    expect(stale.conflict.version).toBe(2);
    expect(stale.conflict.missionIndex).toBe(1);
  });

  it('الخانات الثلاث مستقلة', async () => {
    const store = await freshStore();
    const { user } = await store.createUser({
      email: null,
      passwordHash: null,
      isGuest: true,
      displayName: 'ثلاثي',
      locale: 'ar',
    });
    for (let slot = 1; slot <= balance.campaign.saveSlots; slot++) {
      await store.putSave(user.id, slot, {
        missionIndex: slot - 1,
        checkpoint,
        difficulty: 'normal',
        playTimeS: slot * 10,
        version: 0,
      });
    }
    const saves = await store.listSaves(user.id);
    expect(saves).toHaveLength(balance.campaign.saveSlots);
    expect(saves.map((save) => save.missionIndex)).toEqual([0, 1, 2]);
  });
});

describe('مكافحة الغش / anti-cheat', () => {
  it('ترفض السرعة المستحيلة وتعيد اللاعب', () => {
    const antiCheat = new AntiCheat();
    antiCheat.track('s1');
    expect(antiCheat.validateDisplacement('s1', 'guardian', 5, 1, 1)).toBe(true);
    expect(antiCheat.validateDisplacement('s1', 'guardian', 400, 1, 2)).toBe(false);
    expect(antiCheat.score('s1')).toBeGreaterThan(0);
  });

  it('ترفض معدّل إطلاق أسرع من المسموح', () => {
    const antiCheat = new AntiCheat();
    antiCheat.track('s2');
    let rejected = 0;
    for (let i = 0; i < 60; i++) {
      if (!antiCheat.validateShot('s2', 'kinetic_dmr', 1)) rejected++;
    }
    expect(rejected).toBeGreaterThan(0);
  });

  it('تحظر تلقائيًا عند تكرار المخالفات الجسيمة', () => {
    const antiCheat = new AntiCheat();
    antiCheat.track('s3');
    for (let i = 0; i < 10; i++) antiCheat.validateDisplacement('s3', 'guardian', 900, 1, i);
    expect(antiCheat.shouldBan('s3')).toBe(true);
    expect(antiCheat.banUntil().getTime()).toBeGreaterThan(Date.now());
  });

  it('النتيجة تتلاشى مع الوقت', () => {
    const antiCheat = new AntiCheat();
    antiCheat.track('s4');
    antiCheat.validateDisplacement('s4', 'guardian', 400, 1, 1);
    const before = antiCheat.score('s4');
    antiCheat.decay('s4', 1);
    antiCheat.decay('s4', 500);
    expect(antiCheat.score('s4')).toBeLessThan(before);
  });

  it('تقصّ محور الحركة المتضخّم بدل رفضه', () => {
    const antiCheat = new AntiCheat();
    antiCheat.track('s5');
    const command = {
      seq: 1,
      dt: 1 / 60,
      moveX: 5,
      moveZ: 5,
      yaw: 0,
      pitch: 0,
      buttons: 0,
      clientTimeMs: 0,
    };
    const checked = antiCheat.validateInput('s5', command, 'guardian', 1);
    expect(checked).not.toBeNull();
    expect(Math.hypot(checked!.moveX, checked!.moveZ)).toBeCloseTo(1, 5);
  });
});

describe('التحقق من المدخلات / zod validation', () => {
  it('يرفض كلمة مرور ضعيفة ويقبل القوية', () => {
    expect(zRegisterBody.safeParse({ email: 'a@b.co', password: 'short1' }).success).toBe(false);
    expect(zRegisterBody.safeParse({ email: 'a@b.co', password: 'abcdefghij' }).success).toBe(false);
    expect(zRegisterBody.safeParse({ email: 'a@b.co', password: 'abcdefghij1' }).success).toBe(true);
  });

  it('يطبّع البريد إلى حروف صغيرة', () => {
    const parsed = zLoginBody.safeParse({ email: '  PLAYER@Example.COM ', password: 'x' });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.email).toBe('player@example.com');
  });

  it('حدود أمر الإدخال تطابق ما يرسله العميل', () => {
    const base = { seq: 1, moveX: 0, moveZ: 1, yaw: 1, pitch: 0, buttons: 0, clientTimeMs: 0 };
    expect(zInputCommand.safeParse({ ...base, dt: 1 / 60 }).success).toBe(true);
    expect(zInputCommand.safeParse({ ...base, dt: 1 / 12 }).success).toBe(true);
    expect(zInputCommand.safeParse({ ...base, dt: 1 }).success).toBe(false);
    expect(zInputCommand.safeParse({ ...base, yaw: 99 }).success).toBe(false);
    expect(zInputCommand.safeParse({ ...base, dt: 1 / 60, moveX: 50 }).success).toBe(false);
  });

  it('يرفض خانة حفظ خارج المدى', () => {
    const body = {
      missionIndex: 0,
      checkpoint: {
        missionIndex: 0,
        objectiveIndex: 0,
        playerHealth: 100,
        playerLumen: 0,
        position: { x: 0, y: 0, z: 0 },
        flags: {},
        score: 0,
      },
      difficulty: 'normal',
      playTimeS: 0,
      version: 1,
    };
    expect(zCampaignSavePut.safeParse(body).success).toBe(true);
    expect(zCampaignSavePut.safeParse({ ...body, missionIndex: 99 }).success).toBe(false);
    // الصفر مسموح: أول حفظ في خانة فارغة
    expect(zCampaignSavePut.safeParse({ ...body, version: 0 }).success).toBe(true);
    expect(zCampaignSavePut.safeParse({ ...body, version: -1 }).success).toBe(false);
  });

  it('يرفض إعدادات خارج الحدود المسموحة', () => {
    const valid = {
      graphics: { tier: 'high', resolutionScale: 1, shadows: true, fov: 90, fpsCap: 120, bloom: true },
      audio: { master: 1, music: 0.5, sfx: 0.8 },
      controls: {
        sensitivity: 1,
        adsSensitivity: 1,
        invertY: false,
        gamepadSensitivity: 1,
        autoFireOnAim: false,
        aimAssist: true,
        bindings: {},
        touchLayout: {},
      },
      accessibility: {
        colorBlindMode: 'none',
        fontScale: 1,
        subtitles: true,
        reducedShake: false,
        highContrastHud: false,
      },
    };
    expect(zSettingsBundle.safeParse(valid).success).toBe(true);
    expect(zSettingsBundle.safeParse({ ...valid, audio: { master: 9, music: 0.5, sfx: 0.8 } }).success).toBe(false);
    expect(
      zSettingsBundle.safeParse({ ...valid, graphics: { ...valid.graphics, fov: 500 } }).success,
    ).toBe(false);
  });
});

describe('المطابقة / matchmaking buckets', () => {
  it('تفصل التصنيفات المتباعدة وتجمع المتقاربة', () => {
    expect(eloBucket(1000)).toBe(eloBucket(1150));
    expect(eloBucket(1000)).not.toBe(eloBucket(1800));
  });

  it('تصنّف زمن الاستجابة إلى شرائح', () => {
    expect(pingBucket(20)).toBe(0);
    expect(pingBucket(80)).toBe(1);
    expect(pingBucket(140)).toBe(2);
    expect(pingBucket(400)).toBe(3);
  });
});
