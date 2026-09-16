/** قراءة متغيرات البيئة والتحقق منها مرة واحدة عند الإقلاع. */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';

/**
 * يحمّل ملف .env صراحةً وفي أول الإقلاع.
 *
 * لماذا صراحةً؟ لأن @prisma/client يحمّل .env كأثر جانبي عند استيراده، فيصبح ما
 * يراه هذا الملف معتمدًا على ترتيب الاستيراد — وهو مصدر أخطاء صامتة. التحميل
 * الصريح يجعل السلوك واحدًا مهما تغيّر ترتيب الوحدات.
 *
 * Loaded explicitly and first: @prisma/client loads .env as an import side effect,
 * which would otherwise make this module's view depend on import order.
 */
function loadDotEnvFile(): void {
  if (typeof process.loadEnvFile !== 'function') return;
  for (const candidate of ['.env', '../.env', '../../.env']) {
    const path = resolve(process.cwd(), candidate);
    if (!existsSync(path)) continue;
    try {
      process.loadEnvFile(path);
    } catch {
      // ملف تالف: نتجاهله ونكمل بمتغيرات البيئة الحقيقية
    }
    return;
  }
}

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(2567),
  HOST: z.string().default('0.0.0.0'),
  SERVER_VERSION: z.string().default('1.0.0'),

  DATABASE_URL: z.string().optional(),
  REDIS_URL: z.string().optional(),

  JWT_ACCESS_SECRET: z.string().min(16).default('dev-access-secret-change-me-0123456789abcdef'),
  JWT_REFRESH_SECRET: z.string().min(16).default('dev-refresh-secret-change-me-fedcba9876543210'),
  ACCESS_TOKEN_TTL: z.string().default('15m'),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(30),

  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  RATE_LIMIT_MAX: z.coerce.number().int().min(10).max(10_000).default(120),
  RATE_LIMIT_WINDOW: z.string().default('1 minute'),

  RUN_MIGRATIONS: z.coerce.boolean().default(false),
  RUN_SEED: z.coerce.boolean().default(false),
});

export type Env = z.infer<typeof schema> & {
  /** هل نعمل بمخزن داخل الذاكرة بدل Postgres؟ */
  usesMemoryStore: boolean;
  corsOrigins: string[];
};

let cached: Env | null = null;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  if (cached) return cached;
  if (source === process.env) loadDotEnvFile();
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`[env] invalid environment configuration:\n${issues}`);
  }
  const value = parsed.data;
  if (value.NODE_ENV === 'production') {
    if (value.JWT_ACCESS_SECRET.startsWith('dev-') || value.JWT_REFRESH_SECRET.startsWith('dev-')) {
      throw new Error('[env] refusing to start in production with the development JWT secrets');
    }
    if (!value.DATABASE_URL) {
      throw new Error('[env] DATABASE_URL is required in production (the in-memory store is dev-only)');
    }
  }
  cached = {
    ...value,
    usesMemoryStore: !value.DATABASE_URL,
    corsOrigins: value.CORS_ORIGIN.split(',').map((s) => s.trim()).filter(Boolean),
  };
  return cached;
}

/** للاختبارات فقط / test helper. */
export function resetEnvCache(): void {
  cached = null;
}
