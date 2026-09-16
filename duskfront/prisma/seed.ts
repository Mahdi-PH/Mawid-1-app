/**
 * نقطة دخول البذر في الموقع الذي تنصّ عليه المواصفات.
 * The spec-mandated seed entry point. The implementation lives in the server source so
 * that it also compiles into the production image; this file just runs it for
 * `npm run seed` during development.
 */
import { runSeed } from '../apps/server/src/seed.js';

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
