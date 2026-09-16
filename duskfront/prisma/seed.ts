/**
 * بذرة قاعدة البيانات: الكتالوج التجميلي، الإنجازات العشرون، وبركة المهام اليومية.
 * Seeds the catalogue, the twenty achievements and the daily-mission pool. Idempotent:
 * running it twice upserts rather than duplicating, so it is safe in a container start-up.
 */
import { PrismaClient } from '@prisma/client';
import { ACHIEVEMENTS, CATALOG, DAILY_MISSIONS } from '../apps/server/src/services/content.js';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  console.log('[seed] بدء ملء البيانات / seeding…');

  let catalogCount = 0;
  for (const item of CATALOG) {
    await prisma.catalogItem.upsert({ where: { key: item.key }, create: item, update: item });
    catalogCount++;
  }

  let achievementCount = 0;
  for (const achievement of ACHIEVEMENTS) {
    await prisma.achievement.upsert({
      where: { key: achievement.key },
      create: achievement,
      update: achievement,
    });
    achievementCount++;
  }

  let missionCount = 0;
  for (const mission of DAILY_MISSIONS) {
    await prisma.dailyMission.upsert({ where: { key: mission.key }, create: mission, update: mission });
    missionCount++;
  }

  console.log(
    `[seed] تم / done — ${catalogCount} عنصر متجر، ${achievementCount} إنجازًا، ${missionCount} مهمة يومية`,
  );
}

main()
  .catch((error: unknown) => {
    console.error('[seed] فشل / failed:', error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
