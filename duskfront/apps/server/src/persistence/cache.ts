/**
 * Redis للجلسات والمطابقة ولوحة الصدارة، مع بديل داخل الذاكرة.
 * Redis-backed cache (sessions, matchmaking queue, leaderboard) with an in-memory
 * fallback so a developer machine needs no Redis to run the game.
 */
import { Redis } from 'ioredis';
import { createLogger } from '../logger.js';

const log = createLogger('cache');

export interface Cache {
  readonly kind: 'redis' | 'memory';
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds?: number): Promise<void>;
  del(key: string): Promise<void>;
  incr(key: string, ttlSeconds?: number): Promise<number>;
  /** يحدّث ترتيب لاعب في لوحة الصدارة. */
  rankSet(board: string, member: string, score: number): Promise<void>;
  /** أعلى N في لوحة الصدارة. */
  rankTop(board: string, limit: number): Promise<{ member: string; score: number }[]>;
  rankOf(board: string, member: string): Promise<number | null>;
  close(): Promise<void>;
}

class MemoryCache implements Cache {
  readonly kind = 'memory' as const;
  private readonly values = new Map<string, { value: string; expiresAt: number }>();
  private readonly boards = new Map<string, Map<string, number>>();

  private sweep(): void {
    const now = Date.now();
    for (const [key, entry] of this.values) if (entry.expiresAt > 0 && entry.expiresAt < now) this.values.delete(key);
  }

  async get(key: string): Promise<string | null> {
    this.sweep();
    return this.values.get(key)?.value ?? null;
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    this.values.set(key, { value, expiresAt: ttlSeconds ? Date.now() + ttlSeconds * 1000 : 0 });
  }

  async del(key: string): Promise<void> {
    this.values.delete(key);
  }

  async incr(key: string, ttlSeconds?: number): Promise<number> {
    const current = Number((await this.get(key)) ?? '0') + 1;
    await this.set(key, String(current), ttlSeconds);
    return current;
  }

  async rankSet(board: string, member: string, score: number): Promise<void> {
    let map = this.boards.get(board);
    if (!map) {
      map = new Map();
      this.boards.set(board, map);
    }
    map.set(member, score);
  }

  async rankTop(board: string, limit: number): Promise<{ member: string; score: number }[]> {
    const map = this.boards.get(board);
    if (!map) return [];
    return [...map.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([member, score]) => ({ member, score }));
  }

  async rankOf(board: string, member: string): Promise<number | null> {
    const top = await this.rankTop(board, Number.MAX_SAFE_INTEGER);
    const index = top.findIndex((row) => row.member === member);
    return index < 0 ? null : index + 1;
  }

  async close(): Promise<void> {
    this.values.clear();
    this.boards.clear();
  }
}

class RedisCache implements Cache {
  readonly kind = 'redis' as const;
  constructor(private readonly client: Redis) {}

  async get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (ttlSeconds) await this.client.set(key, value, 'EX', ttlSeconds);
    else await this.client.set(key, value);
  }

  async del(key: string): Promise<void> {
    await this.client.del(key);
  }

  async incr(key: string, ttlSeconds?: number): Promise<number> {
    const value = await this.client.incr(key);
    if (ttlSeconds && value === 1) await this.client.expire(key, ttlSeconds);
    return value;
  }

  async rankSet(board: string, member: string, score: number): Promise<void> {
    await this.client.zadd(board, score, member);
  }

  async rankTop(board: string, limit: number): Promise<{ member: string; score: number }[]> {
    const flat = await this.client.zrevrange(board, 0, Math.max(0, limit - 1), 'WITHSCORES');
    const rows: { member: string; score: number }[] = [];
    for (let i = 0; i < flat.length; i += 2) {
      rows.push({ member: flat[i]!, score: Number(flat[i + 1]) });
    }
    return rows;
  }

  async rankOf(board: string, member: string): Promise<number | null> {
    const rank = await this.client.zrevrank(board, member);
    return rank === null ? null : rank + 1;
  }

  async close(): Promise<void> {
    await this.client.quit();
  }
}

export async function createCache(redisUrl?: string): Promise<Cache> {
  if (!redisUrl) {
    log.warn('REDIS_URL is not set — using the in-memory cache');
    return new MemoryCache();
  }
  const client = new Redis(redisUrl, { maxRetriesPerRequest: 2, lazyConnect: true });
  try {
    await client.connect();
    await client.ping();
    log.info('connected to Redis');
    return new RedisCache(client);
  } catch (error) {
    log.error('Redis unavailable, falling back to the in-memory cache', { error: String(error) });
    client.disconnect();
    return new MemoryCache();
  }
}
