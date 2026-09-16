/** مسارات اللاعب: الملف الشخصي، الإعدادات، الإحصاءات، التجهيز، الحفظ، المهام. */
import {
  balance,
  levelFromXp,
  utcDayKey,
  zCampaignSavePut,
  zClassKey,
  zLoadoutPut,
  zProfilePatch,
  zSettingsBundle,
  zShopBuyParam,
  zSlotParam,
  type PlayerSettingsBundle,
} from '@duskfront/shared';
import type { FastifyInstance } from 'fastify';
import '../auth/middleware.js';
import { defaultSettings } from '../services/defaults.js';
import type { Store } from '../persistence/types.js';

export async function registerMeRoutes(app: FastifyInstance, store: Store): Promise<void> {
  const auth = { preHandler: app.requireAuth };

  app.get('/me/profile', auth, async (request, reply) => {
    const profile = await store.getProfile(request.userId!);
    if (!profile) return reply.code(404).send({ error: 'not_found' });
    const progress = levelFromXp(profile.xp);
    return reply.send({ ...profile, ...progress, isGuest: request.isGuest });
  });

  app.patch('/me/profile', auth, async (request, reply) => {
    const parsed = zProfilePatch.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_body', issues: parsed.error.issues });
    try {
      const profile = await store.updateProfile(request.userId!, parsed.data);
      return reply.send(profile);
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === 'NAME_TAKEN' || code === 'P2002') return reply.code(409).send({ error: 'display_name_taken' });
      throw error;
    }
  });

  app.get('/me/settings', auth, async (request, reply) => {
    const profile = await store.getProfile(request.userId!);
    const settings = (await store.getSettings(request.userId!)) ?? defaultSettings(profile?.locale ?? 'ar');
    return reply.send(settings);
  });

  app.put('/me/settings', auth, async (request, reply) => {
    const parsed = zSettingsBundle.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_body', issues: parsed.error.issues });
    await store.putSettings(request.userId!, parsed.data as PlayerSettingsBundle);
    return reply.send({ ok: true });
  });

  app.get('/me/stats', auth, async (request, reply) => {
    const stats = await store.getStats(request.userId!);
    const kd = stats.deaths > 0 ? stats.kills / stats.deaths : stats.kills;
    const winRate = stats.matchesPlayed > 0 ? stats.wins / stats.matchesPlayed : 0;
    return reply.send({ ...stats, kd: Number(kd.toFixed(2)), winRate: Number(winRate.toFixed(3)) });
  });

  app.get('/me/loadouts/:classKey', auth, async (request, reply) => {
    const parsed = zClassKey.safeParse((request.params as { classKey: string }).classKey);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_class' });
    const loadouts = await store.getLoadouts(request.userId!, parsed.data);
    return reply.send({ classKey: parsed.data, loadouts });
  });

  app.put('/me/loadouts/:classKey', auth, async (request, reply) => {
    const classParsed = zClassKey.safeParse((request.params as { classKey: string }).classKey);
    if (!classParsed.success) return reply.code(400).send({ error: 'invalid_class' });
    const parsed = zLoadoutPut.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_body', issues: parsed.error.issues });

    // لا يُسمح بتجهيز عنصر لا يملكه اللاعب
    const owned = new Set((await store.getInventory(request.userId!)).map((i) => i.key));
    const config = parsed.data.config;
    const referenced = [config.primarySkinKey, config.emblemKey, config.bannerKey, ...config.emoteKeys].filter(
      (k): k is string => typeof k === 'string',
    );
    for (const key of referenced) {
      if (!owned.has(key)) return reply.code(403).send({ error: 'item_not_owned', itemKey: key });
    }

    await store.putLoadout(request.userId!, classParsed.data, parsed.data.slot, config);
    return reply.send({ ok: true });
  });

  app.get('/me/inventory', auth, async (request, reply) => {
    const [inventory, catalog] = await Promise.all([store.getInventory(request.userId!), store.getCatalog()]);
    const owned = new Set(inventory.map((i) => i.key));
    return reply.send({
      owned: inventory,
      catalog: catalog.map((item) => ({ ...item, owned: owned.has(item.key) })),
    });
  });

  app.post('/shop/buy/:itemKey', auth, async (request, reply) => {
    const parsed = zShopBuyParam.safeParse(request.params ?? {});
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_item' });
    const result = await store.buyItem(request.userId!, parsed.data.itemKey);
    if (!result.ok) return reply.code(409).send({ error: result.reason, shards: result.shards });
    return reply.send({ ok: true, shards: result.shards });
  });

  app.get('/me/missions', auth, async (request, reply) => {
    const day = utcDayKey();
    const missions = await store.getMissions(request.userId!, day);
    return reply.send({ day, resetsInSec: secondsUntilUtcReset(), missions });
  });

  app.post('/me/missions/:id/claim', auth, async (request, reply) => {
    const id = (request.params as { id: string }).id;
    const result = await store.claimMission(request.userId!, id, utcDayKey());
    if (!result.ok) return reply.code(409).send({ error: result.reason });
    return reply.send(result);
  });

  app.get('/me/achievements', auth, async (request, reply) => {
    const achievements = await store.getAchievements(request.userId!);
    return reply.send({ achievements, total: achievements.length });
  });

  // ─────────────────────── حفظ الحملة / campaign saves ──────────────────────

  app.get('/me/saves', auth, async (request, reply) => {
    return reply.send({ slots: balance.campaign.saveSlots, saves: await store.listSaves(request.userId!) });
  });

  app.get('/me/saves/:slot', auth, async (request, reply) => {
    const parsed = zSlotParam.safeParse(request.params ?? {});
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_slot' });
    const save = await store.getSave(request.userId!, parsed.data.slot);
    if (!save) return reply.code(404).send({ error: 'empty_slot' });
    return reply.send(save);
  });

  app.put('/me/saves/:slot', auth, async (request, reply) => {
    const slotParsed = zSlotParam.safeParse(request.params ?? {});
    if (!slotParsed.success) return reply.code(400).send({ error: 'invalid_slot' });
    const parsed = zCampaignSavePut.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_body', issues: parsed.error.issues });
    const result = await store.putSave(request.userId!, slotParsed.data.slot, parsed.data);
    if (!result.ok) {
      // تعارض نسخ: يعيد نسخة الخادم ليختار اللاعب
      return reply.code(409).send({ error: 'version_conflict', server: result.conflict, client: parsed.data });
    }
    return reply.send(result.save);
  });

  app.delete('/me/saves/:slot', auth, async (request, reply) => {
    const parsed = zSlotParam.safeParse(request.params ?? {});
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_slot' });
    await store.deleteSave(request.userId!, parsed.data.slot);
    return reply.code(204).send();
  });

  // ─────────────────────── بيانات الحساب / account data ─────────────────────

  app.get('/me/export', auth, async (request, reply) => {
    const data = await store.exportUser(request.userId!);
    return reply
      .header('content-type', 'application/json; charset=utf-8')
      .header('content-disposition', 'attachment; filename="duskfront-export.json"')
      .send(data);
  });

  app.delete('/me', auth, async (request, reply) => {
    await store.deleteUser(request.userId!);
    return reply.code(204).send();
  });

  app.get('/me/ledger', auth, async (request, reply) => {
    const [entries, sum, profile] = await Promise.all([
      store.getLedger(request.userId!),
      store.ledgerSum(request.userId!),
      store.getProfile(request.userId!),
    ]);
    return reply.send({ entries, sum, shards: profile?.shards ?? 0, balanced: sum === (profile?.shards ?? 0) });
  });
}

function secondsUntilUtcReset(): number {
  const now = new Date();
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, balance.economy.dailyResetUtcHour));
  return Math.max(0, Math.round((next.getTime() - now.getTime()) / 1000));
}
