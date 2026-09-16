/**
 * المطابقة: Elo + تقارب زمن الاستجابة.
 * Matchmaking policy. Colyseus owns the seat reservation over its own protocol
 * (the client calls `joinOrCreate('match', filters)`); this endpoint decides *which
 * bucket* a player belongs to, so only comparable ratings and pings share a room.
 *
 * ملاحظة: Colyseus يعترض أي مسار يحتوي على السلسلة `/matchmake`، لذلك تُنشر سياسة المطابقة تحت `/api/queue`.
 */
import { balance, zMatchmakeBody } from '@duskfront/shared';
import { matchMaker } from 'colyseus';
import type { FastifyInstance } from 'fastify';
import '../auth/middleware.js';
import type { Cache } from '../persistence/cache.js';
import type { Store } from '../persistence/types.js';

/** يقسّم التصنيف إلى شرائح حتى يلتقي المتقاربون فقط. */
export function eloBucket(rating: number): number {
  return Math.max(0, Math.floor(rating / 200));
}

/** شريحة زمن الاستجابة: 0 = ممتاز، 3 = بعيد. */
export function pingBucket(pingMs: number): number {
  if (pingMs <= 40) return 0;
  if (pingMs <= 90) return 1;
  if (pingMs <= 160) return 2;
  return 3;
}

export async function registerMatchmakingRoutes(app: FastifyInstance, store: Store, cache: Cache): Promise<void> {
  app.post('/api/queue', { preHandler: app.requireAuth }, async (request, reply) => {
    const parsed = zMatchmakeBody.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_body', issues: parsed.error.issues });
    const { mode, classKey, difficulty, soloVsBots } = parsed.data;

    if (mode === 'campaign' || mode === 'tutorial') {
      // هذان الوضعان يعملان محليًا على العميل بنفس محرّك المحاكاة المشترك
      return reply.send({ local: true, mode, mapKey: balance.map.key, seed: balance.map.seed });
    }

    const profile = await store.getProfile(request.userId!);
    const rating = profile?.rankRating ?? 1000;
    const reportedPing = Number((request.body as { pingMs?: number })?.pingMs ?? 0);

    const filters = { mode, eloBucket: eloBucket(rating), pingBucket: pingBucket(reportedPing) };
    await cache.incr(`mm:queue:${mode}`, 120);

    return reply.send({
      local: false,
      /** يمرّرها العميل كما هي إلى client.joinOrCreate('match', joinOptions) */
      roomName: 'match',
      joinOptions: { ...filters, classKey, difficulty, soloVsBots },
      rating,
      botFillAfterSec: balance.match.botFillAfterSec,
    });
  });

  app.get('/api/queue/status', async (_request, reply) => {
    try {
      const rooms = await matchMaker.query({ name: 'match' });
      return reply.send({
        rooms: rooms.map((r) => ({
          roomId: r.roomId,
          clients: r.clients,
          maxClients: r.maxClients,
          locked: r.locked,
          mode: (r.metadata as { mode?: string } | undefined)?.mode ?? 'crawl',
        })),
      });
    } catch {
      return reply.send({ rooms: [] });
    }
  });
}
