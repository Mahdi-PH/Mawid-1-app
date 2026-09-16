/**
 * نقطة إقلاع الخادم: Fastify (REST) + Colyseus (اللعب الجماعي) على نفس المنفذ.
 * Server bootstrap. REST and the realtime transport share one HTTP server so a single
 * port (and a single container) is all a deployment needs.
 */
import { Server } from 'colyseus';
import { WebSocketTransport } from '@colyseus/ws-transport';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import Fastify from 'fastify';
import { assertBalanceIntegrity, balance } from '@duskfront/shared';
import { registerAuthRoutes } from './api/auth.routes.js';
import { registerMatchmakingRoutes } from './api/matchmaking.routes.js';
import { registerMeRoutes } from './api/me.routes.js';
import { registerSocialRoutes } from './api/social.routes.js';
import { createAuthGuard } from './auth/middleware.js';
import { loadEnv } from './env.js';
import { createLogger } from './logger.js';
import { createCache } from './persistence/cache.js';
import { createStore } from './persistence/index.js';
import { MatchRoom } from './rooms/match-room.js';

const log = createLogger('boot');

export async function buildServer() {
  const env = loadEnv();
  assertBalanceIntegrity();

  const store = await createStore(env);
  const cache = await createCache(env.REDIS_URL);

  const app = Fastify({ logger: false, bodyLimit: 1024 * 256, trustProxy: true });

  await app.register(cors, {
    /**
     * في التطوير: أي أصل محلي (localhost/127.0.0.1 بأي منفذ) — لأن Vite وvite preview
     * وعناوين الشبكة المحلية تتغيّر باستمرار. في الإنتاج: القائمة المعلنة فقط.
     */
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (env.corsOrigins.includes('*')) return callback(null, true);
      if (env.corsOrigins.includes(origin)) return callback(null, true);
      if (env.NODE_ENV !== 'production' && /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(origin)) {
        return callback(null, true);
      }
      return callback(null, false);
    },
    credentials: true,
  });
  await app.register(rateLimit, {
    max: env.RATE_LIMIT_MAX,
    timeWindow: env.RATE_LIMIT_WINDOW,
    allowList: (request) => request.url === '/health',
  });

  app.decorate('requireAuth', createAuthGuard(env, store));

  app.get('/health', async () => ({
    ok: true,
    version: env.SERVER_VERSION,
    store: store.kind,
    cache: cache.kind,
    balanceVersion: balance.version,
    uptimeSec: Math.round(process.uptime()),
  }));

  await registerAuthRoutes(app, env, store);
  await registerMeRoutes(app, store);
  await registerSocialRoutes(app, store);
  await registerMatchmakingRoutes(app, store, cache);

  app.setErrorHandler((error: Error & { statusCode?: number }, request, reply) => {
    log.error('request failed', { url: request.url, error: error.message });
    const status = error.statusCode && error.statusCode >= 400 ? error.statusCode : 500;
    void reply.code(status).send({ error: status === 500 ? 'internal_error' : error.message });
  });

  await app.ready();

  MatchRoom.deps = { env, store };
  // النقل يتشارك خادم HTTP نفسه الذي ربطت به Fastify معالجها في app.ready()،
  // فيستمع Colyseus على المنفذ وتستمر مسارات REST بالعمل كما هي.
  const gameServer = new Server({
    transport: new WebSocketTransport({ server: app.server, pingInterval: 6000, pingMaxRetries: 4 }),
    greet: false,
  });
  gameServer.define('match', MatchRoom).filterBy(['mode', 'eloBucket', 'pingBucket']);

  return { app, gameServer, env, store, cache };
}

async function main(): Promise<void> {
  const { app, gameServer, env, store, cache } = await buildServer();
  await gameServer.listen(env.PORT, env.HOST);
  log.info('DUSKFRONT server listening', {
    port: env.PORT,
    host: env.HOST,
    store: store.kind,
    cache: cache.kind,
    tickRate: balance.match.tickRate,
  });

  const shutdown = async (signal: string): Promise<void> => {
    log.info('shutting down', { signal });
    try {
      await gameServer.gracefullyShutdown(false);
      await app.close();
      await store.close();
      await cache.close();
    } finally {
      process.exit(0);
    }
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

const isEntrypoint = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/^.*[\\/]/, ''));
if (isEntrypoint) {
  main().catch((error: unknown) => {
    const detail = error instanceof Error ? (error.stack ?? error.message) : String(error);
    log.error('fatal boot error', { error: detail });
    process.exit(1);
  });
}
