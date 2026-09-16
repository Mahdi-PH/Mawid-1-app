/** اختيار محوّل التخزين حسب البيئة. */
import { createLogger } from '../logger.js';
import type { Env } from '../env.js';
import { MemoryStore } from './memory-store.js';
import { PrismaStore } from './prisma-store.js';
import type { Store } from './types.js';

const log = createLogger('store');

export async function createStore(env: Env): Promise<Store> {
  if (env.usesMemoryStore) {
    log.warn('DATABASE_URL is not set — running on the in-memory store (data is lost on restart)');
    const store = new MemoryStore();
    await store.init();
    return store;
  }
  const store = new PrismaStore();
  await store.init();
  log.info('connected to PostgreSQL via Prisma');
  return store;
}

export { MemoryStore, PrismaStore };
export * from './types.js';
