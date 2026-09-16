/**
 * بذر قاعدة البيانات: الكتالوج التجميلي، الإنجازات العشرون، وبركة المهام اليومية.
 * Database seeding. It lives in the server's source (not in prisma/) so it compiles
 * into dist alongside the server — the production image then runs plain `node`, with
 * no TypeScript loader present at runtime.
 *
 * عملية idempotent: تشغيلها مرتين يحدّث ولا يكرّر، فيمكن استدعاؤها عند كل إقلاع.
 */
import { PrismaClient } from '@prisma/client';
import { ACHIEVEMENTS, CATALOG, DAILY_MISSIONS } from '@duskfront/shared';
import { createLogger } from './logger.js';

const log = createLogger('seed');

export interface SeedResult {
  catalogItems: number;
  achievements: number;
  dailyMissions: number;
}

export async function runSeed(client?: PrismaClient): Promise<SeedResult> {
  const prisma = client ?? new PrismaClient();
  const owned = client === undefined;
  try {
    for (const item of CATALOG) {
      await prisma.catalogItem.upsert({ where: { key: item.key }, create: item, update: item });
    }
    for (const achievement of ACHIEVEMENTS) {
      await prisma.achievement.upsert({ where: { key: achievement.key }, create: achievement, update: achievement });
    }
    for (const mission of DAILY_MISSIONS) {
      await prisma.dailyMission.upsert({ where: { key: mission.key }, create: mission, update: mission });
    }
    const result: SeedResult = {
      catalogItems: CATALOG.length,
      achievements: ACHIEVEMENTS.length,
      dailyMissions: DAILY_MISSIONS.length,
    };
    log.info('seed complete', { ...result });
    return result;
  } finally {
    if (owned) await prisma.$disconnect();
  }
}

/** يُشغَّل مباشرة: node apps/server/dist/seed.js */
const invokedDirectly = process.argv[1]?.endsWith('seed.js') || process.argv[1]?.endsWith('seed.ts');
if (invokedDirectly) {
  runSeed()
    .then((result) => {
      console.log(
        `[seed] تم / done — ${result.catalogItems} عنصر متجر، ${result.achievements} إنجازًا، ${result.dailyMissions} مهمة يومية`,
      );
    })
    .catch((error: unknown) => {
      console.error('[seed] فشل / failed:', error);
      process.exitCode = 1;
    });
}
