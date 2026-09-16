/** لوحة الصدارة، المباريات، الأصدقاء، البلاغات، وبيانات اللعبة العامة. */
import { balance, zFriendBody, zLeaderboardQuery, zReportBody } from '@duskfront/shared';
import type { FastifyInstance } from 'fastify';
import '../auth/middleware.js';
import type { Store } from '../persistence/types.js';

export async function registerSocialRoutes(app: FastifyInstance, store: Store): Promise<void> {
  const auth = { preHandler: app.requireAuth };

  app.get('/leaderboard', async (request, reply) => {
    const parsed = zLeaderboardQuery.safeParse(request.query ?? {});
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_query' });
    const { mode, page, pageSize } = parsed.data;
    const result = await store.getLeaderboard(mode, page, pageSize);
    return reply.send({ mode, page, pageSize, ...result });
  });

  app.get('/matches/:id', async (request, reply) => {
    const id = (request.params as { id: string }).id;
    const match = await store.getMatch(id);
    if (!match) return reply.code(404).send({ error: 'not_found' });
    return reply.send(match);
  });

  app.get('/friends', auth, async (request, reply) => {
    return reply.send({ friends: await store.listFriends(request.userId!) });
  });

  app.post('/friends', auth, async (request, reply) => {
    const parsed = zFriendBody.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_body' });
    const result = await store.requestFriend(request.userId!, parsed.data.friendId);
    if (!result.ok) return reply.code(409).send({ error: result.reason });
    return reply.send({ ok: true });
  });

  app.delete('/friends/:friendId', auth, async (request, reply) => {
    const friendId = (request.params as { friendId: string }).friendId;
    await store.removeFriend(request.userId!, friendId);
    return reply.code(204).send();
  });

  app.post('/reports', auth, async (request, reply) => {
    const parsed = zReportBody.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_body', issues: parsed.error.issues });
    if (parsed.data.reportedId === request.userId) return reply.code(400).send({ error: 'cannot_report_self' });
    await store.createReport(
      request.userId!,
      parsed.data.reportedId,
      parsed.data.matchId,
      parsed.data.reason,
      parsed.data.details,
    );
    return reply.code(201).send({ ok: true });
  });

  /** يُخرج أرقام التوازن للعميل حتى لا يُكرّرها أحد في الكود. */
  app.get('/game/balance', async (_request, reply) => {
    return reply.header('cache-control', 'public, max-age=60').send(balance);
  });
}
