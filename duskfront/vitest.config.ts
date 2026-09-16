import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * الاختبارات تستورد الحزمة المشتركة من مصدرها لا من dist، وإلا نُسبت التغطية
 * إلى ملفات مبنية وظهرت صفرًا. / Tests resolve the shared package to its TypeScript
 * sources so coverage lands on the real files.
 */
const sharedSrc = fileURLToPath(new URL('./packages/shared/src/index.ts', import.meta.url));

export default defineConfig({
  resolve: {
    alias: [{ find: /^@duskfront\/shared$/, replacement: sharedSrc }],
  },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
    /*
      Colyseus يسحب أدوات PM2 التي تستدعي process.send()، وهو ما يصطدم بقناة
      IPC في تجمّع forks لدى Vitest. تجمّع threads لا يملك تلك القناة.
      Colyseus pulls in PM2 instrumentation that calls process.send(), which collides
      with Vitest's fork-pool IPC channel; the threads pool has no such channel.
    */
    pool: 'threads',
    globals: false,
    testTimeout: 30_000,
    coverage: {
      provider: 'v8',
      include: ['packages/shared/src/**/*.ts', 'apps/server/src/**/*.ts'],
      exclude: [
        '**/*.d.ts',
        'packages/shared/src/balance.generated.ts',
        'apps/server/src/index.ts',
        'apps/server/src/persistence/prisma-store.ts',
      ],
      reporter: ['text', 'html'],
      // القسم 15 من المواصفات: 70% على الأقل لمنطق اللعب والخادم
      thresholds: { lines: 70, functions: 70, branches: 60, statements: 70 },
    },
  },
  // Colyseus schema يستخدم المزخرِفات القديمة
  esbuild: {
    tsconfigRaw: { compilerOptions: { experimentalDecorators: true, useDefineForClassFields: false } },
  },
});
