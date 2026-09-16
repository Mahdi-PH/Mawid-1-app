/** اختيار محوّل التخزين حسب البيئة. */
import { createLogger } from '../logger.js';
import type { Env } from '../env.js';
import { MemoryStore } from './memory-store.js';
import { PrismaStore } from './prisma-store.js';
import type { Store } from './types.js';

const log = createLogger('store');

async function createMemoryStore(reason: string): Promise<Store> {
  log.warn(`${reason} — running on the in-memory store (data is lost on restart)`);
  const store = new MemoryStore();
  await store.init();
  return store;
}

export async function createStore(env: Env): Promise<Store> {
  if (env.usesMemoryStore) {
    return createMemoryStore('DATABASE_URL is not set');
  }

  const store = new PrismaStore();
  try {
    await store.init();
    log.info('connected to PostgreSQL via Prisma');
    return store;
  } catch (error) {
    const detail = error instanceof Error ? error.message.split('\n')[0] : String(error);
    /*
      في الإنتاج، قاعدة بيانات لا تستجيب خطأ قاتل ويجب أن يتوقّف الإقلاع.
      في التطوير، مطوّر نسخ .env.example (وفيه DATABASE_URL جاهز) ثم شغّل اللعبة
      بلا Postgres يجب أن يلعب لا أن يواجه انهيارًا — فنرجع إلى مخزن الذاكرة بتحذير.
      In production an unreachable database is fatal. In development, someone who
      copied .env.example and has no Postgres should still get a playable game.
    */
    if (env.NODE_ENV === 'production') {
      log.error('cannot reach the database and refusing to fall back in production', { error: detail });
      throw error;
    }
    await store.close().catch(() => undefined);
    return createMemoryStore(`cannot reach the database (${detail})`);
  }
}

export { MemoryStore, PrismaStore };
export * from './types.js';
