/**
 * واجهة REST كاملة عبر حقن الطلبات (بلا شبكة ولا قاعدة بيانات).
 * The whole REST surface, exercised through Fastify's request injection — no socket,
 * no Postgres, so it runs anywhere and still tests the real handlers end to end.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { balance } from '@duskfront/shared';
import { buildServer } from '../../apps/server/src/index.js';
import { resetEnvCache } from '../../apps/server/src/env.js';

let app: FastifyInstance;
let teardown: () => Promise<void>;

beforeAll(async () => {
  resetEnvCache();
  // بلا DATABASE_URL/REDIS_URL ⇒ المخزن والذاكرة المؤقتة داخل العملية
  delete process.env.DATABASE_URL;
  delete process.env.REDIS_URL;
  process.env.NODE_ENV = 'test';
  const built = await buildServer();
  app = built.app;
  teardown = async () => {
    await built.gameServer.gracefullyShutdown(false).catch(() => undefined);
    await built.app.close();
    await built.store.close();
    await built.cache.close();
  };
});

afterAll(async () => {
  await teardown?.();
});

async function newGuest(): Promise<{ accessToken: string; refreshToken: string; userId: string; displayName: string }> {
  const response = await app.inject({
    method: 'POST',
    url: '/auth/guest',
    payload: { locale: 'ar' },
  });
  expect(response.statusCode).toBe(201);
  const body = response.json();
  return {
    accessToken: body.accessToken,
    refreshToken: body.refreshToken,
    userId: body.profile.userId,
    displayName: body.profile.displayName,
  };
}

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

describe('الصحة والبيانات العامة / health and public data', () => {
  it('نقطة الصحة تعمل', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json().ok).toBe(true);
  });

  it('تُخرج أرقام التوازن للعميل', async () => {
    const response = await app.inject({ method: 'GET', url: '/game/balance' });
    expect(response.statusCode).toBe(200);
    expect(response.json().version).toBe(balance.version);
  });
});

describe('المصادقة / authentication', () => {
  it('تنشئ حساب ضيف برمز وصول وملف شخصي', async () => {
    const guest = await newGuest();
    expect(guest.accessToken.split('.')).toHaveLength(3);
    expect(guest.displayName.length).toBeGreaterThan(0);
  });

  it('ترفض الوصول بلا رمز', async () => {
    const response = await app.inject({ method: 'GET', url: '/me/profile' });
    expect(response.statusCode).toBe(401);
  });

  it('ترفض رمزًا غير صالح', async () => {
    const response = await app.inject({ method: 'GET', url: '/me/profile', headers: auth('not.a.token') });
    expect(response.statusCode).toBe(401);
  });

  it('تسجّل حسابًا كاملًا وتسمح بالدخول', async () => {
    const email = `player-${Date.now()}@example.com`;
    const registered = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email, password: 'a-strong-pass-1', locale: 'ar' },
    });
    expect(registered.statusCode).toBe(201);

    const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password: 'a-strong-pass-1' } });
    expect(login.statusCode).toBe(200);

    const wrong = await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password: 'wrong-pass-9' } });
    expect(wrong.statusCode).toBe(401);
  });

  it('ترفض بريدًا مكرّرًا وكلمة مرور ضعيفة', async () => {
    const email = `dupe-${Date.now()}@example.com`;
    await app.inject({ method: 'POST', url: '/auth/register', payload: { email, password: 'a-strong-pass-1' } });
    const again = await app.inject({ method: 'POST', url: '/auth/register', payload: { email, password: 'a-strong-pass-1' } });
    expect(again.statusCode).toBe(409);

    const weak = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email: `weak-${Date.now()}@example.com`, password: 'short' },
    });
    expect(weak.statusCode).toBe(400);
  });

  it('تدوّر رمز التحديث وتُبطل القديم', async () => {
    const guest = await newGuest();
    const first = await app.inject({ method: 'POST', url: '/auth/refresh', payload: { refreshToken: guest.refreshToken } });
    expect(first.statusCode).toBe(200);
    const rotated = first.json().refreshToken;
    expect(rotated).not.toBe(guest.refreshToken);

    // إعادة استخدام الرمز القديم = تسريب محتمل ⇒ تُبطَل كل الجلسات
    const reuse = await app.inject({ method: 'POST', url: '/auth/refresh', payload: { refreshToken: guest.refreshToken } });
    expect(reuse.statusCode).toBe(401);
    expect(reuse.json().error).toBe('token_reused');

    const afterRevoke = await app.inject({ method: 'POST', url: '/auth/refresh', payload: { refreshToken: rotated } });
    expect(afterRevoke.statusCode).toBe(401);
  });

  it('ترقّي الضيف إلى حساب كامل دون فقدان بياناته', async () => {
    const guest = await newGuest();
    const email = `upgraded-${Date.now()}@example.com`;
    const upgraded = await app.inject({
      method: 'POST',
      url: '/auth/upgrade',
      headers: auth(guest.accessToken),
      payload: { email, password: 'a-strong-pass-1' },
    });
    expect(upgraded.statusCode).toBe(200);
    expect(upgraded.json().profile.userId).toBe(guest.userId);
    expect(upgraded.json().profile.displayName).toBe(guest.displayName);
  });

  it('الخروج يُبطل رمز التحديث', async () => {
    const guest = await newGuest();
    const logout = await app.inject({ method: 'POST', url: '/auth/logout', payload: { refreshToken: guest.refreshToken } });
    expect(logout.statusCode).toBe(204);
    const refresh = await app.inject({ method: 'POST', url: '/auth/refresh', payload: { refreshToken: guest.refreshToken } });
    expect(refresh.statusCode).toBe(401);
  });
});

describe('الملف الشخصي والإعدادات / profile and settings', () => {
  it('تقرأ الملف وتحدّثه', async () => {
    const guest = await newGuest();
    const profile = await app.inject({ method: 'GET', url: '/me/profile', headers: auth(guest.accessToken) });
    expect(profile.statusCode).toBe(200);
    expect(profile.json().level).toBe(1);

    const patched = await app.inject({
      method: 'PATCH',
      url: '/me/profile',
      headers: auth(guest.accessToken),
      payload: { displayName: `قائد ${Date.now() % 10000}` },
    });
    expect(patched.statusCode).toBe(200);
  });

  it('ترفض اسمًا قصيرًا جدًا', async () => {
    const guest = await newGuest();
    const response = await app.inject({
      method: 'PATCH',
      url: '/me/profile',
      headers: auth(guest.accessToken),
      payload: { displayName: 'أ' },
    });
    expect(response.statusCode).toBe(400);
  });

  it('تحفظ الإعدادات وتعيدها كما هي', async () => {
    const guest = await newGuest();
    const current = await app.inject({ method: 'GET', url: '/me/settings', headers: auth(guest.accessToken) });
    expect(current.statusCode).toBe(200);

    const settings = current.json();
    settings.graphics.tier = 'high';
    settings.audio.music = 0.25;
    settings.accessibility.colorBlindMode = 'deuteranopia';

    const saved = await app.inject({
      method: 'PUT',
      url: '/me/settings',
      headers: auth(guest.accessToken),
      payload: settings,
    });
    expect(saved.statusCode).toBe(200);

    const reread = await app.inject({ method: 'GET', url: '/me/settings', headers: auth(guest.accessToken) });
    expect(reread.json().graphics.tier).toBe('high');
    expect(reread.json().audio.music).toBe(0.25);
    expect(reread.json().accessibility.colorBlindMode).toBe('deuteranopia');
  });

  it('ترفض إعدادات خارج الحدود', async () => {
    const guest = await newGuest();
    const current = (await app.inject({ method: 'GET', url: '/me/settings', headers: auth(guest.accessToken) })).json();
    current.graphics.fov = 900;
    const response = await app.inject({
      method: 'PUT',
      url: '/me/settings',
      headers: auth(guest.accessToken),
      payload: current,
    });
    expect(response.statusCode).toBe(400);
  });

  it('تعيد الإحصاءات الابتدائية', async () => {
    const guest = await newGuest();
    const response = await app.inject({ method: 'GET', url: '/me/stats', headers: auth(guest.accessToken) });
    expect(response.statusCode).toBe(200);
    expect(response.json().matchesPlayed).toBe(0);
  });
});

describe('المتجر والتجهيز / store and loadouts', () => {
  it('تعرض الكتالوج كاملًا مع حالة الملكية', async () => {
    const guest = await newGuest();
    const response = await app.inject({ method: 'GET', url: '/me/inventory', headers: auth(guest.accessToken) });
    expect(response.statusCode).toBe(200);
    expect(response.json().catalog.length).toBeGreaterThan(0);
    expect(response.json().owned).toHaveLength(0);
  });

  it('ترفض الشراء بلا شظايا كافية', async () => {
    const guest = await newGuest();
    const catalog = (await app.inject({ method: 'GET', url: '/me/inventory', headers: auth(guest.accessToken) })).json()
      .catalog;
    const response = await app.inject({
      method: 'POST',
      url: `/shop/buy/${catalog[0].key}`,
      headers: auth(guest.accessToken),
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().error).toBe('insufficient_shards');
  });

  it('ترفض تجهيز عنصر غير مملوك', async () => {
    const guest = await newGuest();
    const response = await app.inject({
      method: 'PUT',
      url: '/me/loadouts/guardian',
      headers: auth(guest.accessToken),
      payload: { slot: 1, config: { primarySkinKey: 'skin_guardian_dawnplate', emblemKey: null, bannerKey: null, emoteKeys: [] } },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().error).toBe('item_not_owned');
  });

  it('تقبل تجهيزًا فارغًا وتعيده', async () => {
    const guest = await newGuest();
    const saved = await app.inject({
      method: 'PUT',
      url: '/me/loadouts/engineer',
      headers: auth(guest.accessToken),
      payload: { slot: 2, config: { primarySkinKey: null, emblemKey: null, bannerKey: null, emoteKeys: [] } },
    });
    expect(saved.statusCode).toBe(200);
    const read = await app.inject({ method: 'GET', url: '/me/loadouts/engineer', headers: auth(guest.accessToken) });
    expect(read.json().loadouts).toHaveLength(1);
    expect(read.json().loadouts[0].slot).toBe(2);
  });

  it('ترفض صنفًا غير معروف', async () => {
    const guest = await newGuest();
    const response = await app.inject({ method: 'GET', url: '/me/loadouts/wizard', headers: auth(guest.accessToken) });
    expect(response.statusCode).toBe(400);
  });
});

describe('المهام والإنجازات / missions and achievements', () => {
  it('تسند ثلاث مهام يومية', async () => {
    const guest = await newGuest();
    const response = await app.inject({ method: 'GET', url: '/me/missions', headers: auth(guest.accessToken) });
    expect(response.statusCode).toBe(200);
    expect(response.json().missions).toHaveLength(balance.economy.dailyMissionCount);
    expect(response.json().resetsInSec).toBeGreaterThan(0);
  });

  it('ترفض استلام مهمة غير مكتملة', async () => {
    const guest = await newGuest();
    const missions = (await app.inject({ method: 'GET', url: '/me/missions', headers: auth(guest.accessToken) })).json()
      .missions;
    const response = await app.inject({
      method: 'POST',
      url: `/me/missions/${missions[0].missionId}/claim`,
      headers: auth(guest.accessToken),
    });
    expect(response.statusCode).toBe(409);
  });

  it('تعرض عشرين إنجازًا', async () => {
    const guest = await newGuest();
    const response = await app.inject({ method: 'GET', url: '/me/achievements', headers: auth(guest.accessToken) });
    expect(response.statusCode).toBe(200);
    expect(response.json().total).toBe(balance.economy.achievementCount);
  });
});

describe('حفظ الحملة عبر الواجهة / campaign saves over REST', () => {
  it('تحفظ وتقرأ وتحذف خانة', async () => {
    const guest = await newGuest();
    const checkpoint = {
      missionIndex: 0,
      objectiveIndex: 0,
      playerHealth: 180,
      playerLumen: 40,
      position: { x: 1, y: 2, z: 3 },
      flags: {},
      score: 0,
    };

    const empty = await app.inject({ method: 'GET', url: '/me/saves/1', headers: auth(guest.accessToken) });
    expect(empty.statusCode).toBe(404);

    const saved = await app.inject({
      method: 'PUT',
      url: '/me/saves/1',
      headers: auth(guest.accessToken),
      payload: { missionIndex: 0, checkpoint, difficulty: 'normal', playTimeS: 30, version: 0 },
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().version).toBe(1);

    const read = await app.inject({ method: 'GET', url: '/me/saves/1', headers: auth(guest.accessToken) });
    expect(read.json().playTimeS).toBe(30);

    const conflict = await app.inject({
      method: 'PUT',
      url: '/me/saves/1',
      headers: auth(guest.accessToken),
      payload: { missionIndex: 3, checkpoint, difficulty: 'hard', playTimeS: 999, version: 0 },
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().error).toBe('version_conflict');
    expect(conflict.json().server.version).toBe(1);

    const removed = await app.inject({ method: 'DELETE', url: '/me/saves/1', headers: auth(guest.accessToken) });
    expect(removed.statusCode).toBe(204);
  });

  it('ترفض رقم خانة خارج المدى', async () => {
    const guest = await newGuest();
    const response = await app.inject({ method: 'GET', url: '/me/saves/9', headers: auth(guest.accessToken) });
    expect(response.statusCode).toBe(400);
  });
});

describe('الاجتماعي ولوحة الصدارة / social and leaderboard', () => {
  it('لوحة الصدارة تستجيب حتى وهي فارغة', async () => {
    const response = await app.inject({ method: 'GET', url: '/leaderboard?mode=crawl&page=1' });
    expect(response.statusCode).toBe(200);
    expect(Array.isArray(response.json().rows)).toBe(true);
  });

  it('تمنع إضافة النفس كصديق', async () => {
    const guest = await newGuest();
    const response = await app.inject({
      method: 'POST',
      url: '/friends',
      headers: auth(guest.accessToken),
      payload: { friendId: guest.userId },
    });
    expect(response.statusCode).toBe(409);
  });

  it('طلب صداقة متبادل يصبح مقبولًا', async () => {
    const a = await newGuest();
    const b = await newGuest();
    expect(
      (await app.inject({ method: 'POST', url: '/friends', headers: auth(a.accessToken), payload: { friendId: b.userId } }))
        .statusCode,
    ).toBe(200);
    expect(
      (await app.inject({ method: 'POST', url: '/friends', headers: auth(b.accessToken), payload: { friendId: a.userId } }))
        .statusCode,
    ).toBe(200);
    const friends = (await app.inject({ method: 'GET', url: '/friends', headers: auth(a.accessToken) })).json().friends;
    expect(friends.some((friend: { status: string }) => friend.status === 'accepted')).toBe(true);
  });

  it('تمنع الإبلاغ عن النفس وتقبل بلاغًا صحيحًا', async () => {
    const a = await newGuest();
    const b = await newGuest();
    const self = await app.inject({
      method: 'POST',
      url: '/reports',
      headers: auth(a.accessToken),
      payload: { reportedId: a.userId, reason: 'cheating', matchId: null },
    });
    expect(self.statusCode).toBe(400);

    const valid = await app.inject({
      method: 'POST',
      url: '/reports',
      headers: auth(a.accessToken),
      payload: { reportedId: b.userId, reason: 'cheating', matchId: null },
    });
    expect(valid.statusCode).toBe(201);
  });

  it('مباراة غير موجودة تعيد 404', async () => {
    const response = await app.inject({ method: 'GET', url: '/matches/11111111-1111-4111-8111-111111111111' });
    expect(response.statusCode).toBe(404);
  });
});

describe('المطابقة وبيانات الحساب / queue and account data', () => {
  it('تعيد سياسة مطابقة تحمل شرائح Elo وping', async () => {
    const guest = await newGuest();
    const response = await app.inject({
      method: 'POST',
      url: '/api/queue',
      headers: auth(guest.accessToken),
      payload: { mode: 'crawl', classKey: 'guardian', soloVsBots: true, pingMs: 35 },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.local).toBe(false);
    expect(body.roomName).toBe('match');
    expect(body.joinOptions.eloBucket).toBe(5);
    expect(body.joinOptions.pingBucket).toBe(0);
  });

  it('الحملة والتدريب يعملان محليًا', async () => {
    const guest = await newGuest();
    const response = await app.inject({
      method: 'POST',
      url: '/api/queue',
      headers: auth(guest.accessToken),
      payload: { mode: 'tutorial', classKey: 'engineer' },
    });
    expect(response.json().local).toBe(true);
  });

  it('تصدّر بيانات اللاعب دون تجزئة كلمة المرور', async () => {
    const guest = await newGuest();
    const response = await app.inject({ method: 'GET', url: '/me/export', headers: auth(guest.accessToken) });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.profile).toBeDefined();
    expect(JSON.stringify(body)).not.toContain('passwordHash":"$argon2');
  });

  it('حذف الحساب يمنع الوصول بعده', async () => {
    const guest = await newGuest();
    const deleted = await app.inject({ method: 'DELETE', url: '/me', headers: auth(guest.accessToken) });
    expect(deleted.statusCode).toBe(204);
    const after = await app.inject({ method: 'GET', url: '/me/profile', headers: auth(guest.accessToken) });
    expect(after.statusCode).toBe(401);
  });

  it('سجل العملة متوازن دائمًا', async () => {
    const guest = await newGuest();
    const response = await app.inject({ method: 'GET', url: '/me/ledger', headers: auth(guest.accessToken) });
    expect(response.statusCode).toBe(200);
    expect(response.json().balanced).toBe(true);
  });
});
