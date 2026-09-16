/** حارس المصادقة لطرق REST / Fastify auth guard. */
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Env } from '../env.js';
import type { Store } from '../persistence/types.js';
import { verifyAccessToken } from './tokens.js';

declare module 'fastify' {
  interface FastifyRequest {
    userId?: string;
    isGuest?: boolean;
  }
  interface FastifyInstance {
    /** حارس مسجَّل عبر app.decorate في index.ts */
    requireAuth: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

export function createAuthGuard(env: Env, store: Store) {
  return async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const header = request.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      await reply.code(401).send({ error: 'missing_token' });
      return;
    }
    const claims = await verifyAccessToken(env, header.slice(7).trim());
    if (!claims) {
      await reply.code(401).send({ error: 'invalid_token' });
      return;
    }
    const user = await store.findUserById(claims.sub);
    if (!user) {
      await reply.code(401).send({ error: 'unknown_user' });
      return;
    }
    if (user.bannedUntil && user.bannedUntil.getTime() > Date.now()) {
      await reply.code(403).send({ error: 'banned', until: user.bannedUntil.toISOString() });
      return;
    }
    request.userId = claims.sub;
    request.isGuest = claims.isGuest;
  };
}
