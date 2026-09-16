import { defineConfig, devices } from '@playwright/test';

/**
 * اختبار شامل: يشغّل الخادم والعميل ثم يقود متصفّحًا حقيقيًا.
 * The E2E harness boots the real server and the built client, then drives a real
 * browser through: guest sign-in → match → campaign save → reload → data still there.
 *
 * في بيئات CI التي تملك Chromium مثبّتًا مسبقًا، مرّر مساره عبر DUSKFRONT_CHROMIUM.
 */
const chromiumPath = process.env.DUSKFRONT_CHROMIUM;

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 120_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    ...devices['Desktop Chrome'],
    launchOptions: {
      ...(chromiumPath ? { executablePath: chromiumPath } : {}),
      // SwiftShader يتيح WebGL بلا بطاقة رسومات داخل الحاويات
      args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--disable-dev-shm-usage'],
    },
  },
  webServer: [
    {
      command: 'npm run start:e2e:server',
      port: 2567,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      command: 'npm run start:e2e:web',
      port: 4173,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
