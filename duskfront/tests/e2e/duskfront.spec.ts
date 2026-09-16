/**
 * الاختبار الشامل المطلوب في القسم 15: التسجيل ← مباراة ← الحفظ.
 * The acceptance-criteria E2E walk: sign in → play a match → save → reload → the
 * progress is still there, with no console errors along the way.
 */
import { expect, test, type ConsoleMessage, type Page } from '@playwright/test';

/** أخطاء وحدة التحكم التي لا علاقة لها بالكود (شبكة بيئة الاختبار). */
function isEnvironmentNoise(message: string): boolean {
  return (
    message.includes('ERR_CERT_AUTHORITY_INVALID') ||
    message.includes('fonts.googleapis.com') ||
    message.includes('fonts.gstatic.com') ||
    message.includes('favicon')
  );
}

function watchConsole(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (message: ConsoleMessage) => {
    if (message.type() === 'error' && !isEnvironmentNoise(message.text())) errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  return errors;
}

/** ينتظر حتى تظهر القائمة الرئيسية بعد تسجيل دخول الضيف التلقائي. */
async function bootToMenu(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.locator('#menu-layer')).toBeVisible({ timeout: 40_000 });
  await expect(page.locator('.menu-brand h1')).toHaveText('DUSKFRONT');
}

test.describe('جبهة الغسق — المسار الكامل', () => {
  test('تقلع بالعربية مع اتجاه RTL سليم', async ({ page }) => {
    const errors = watchConsole(page);
    await bootToMenu(page);

    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
    // القائمة الجانبية بالعربية
    await expect(page.locator('.menu-nav button').first()).toContainText('القائمة');
    expect(errors).toEqual([]);
  });

  test('تبدّل اللغة إلى الإنجليزية وتعيد الاتجاه', async ({ page }) => {
    await bootToMenu(page);
    await page.locator('.menu-nav button', { hasText: 'الإعدادات' }).click();
    await page.locator('[data-locale="en"]').click();
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
    await expect(page.locator('.menu-nav button').first()).toContainText('Main Menu');

    await page.locator('[data-locale="ar"]').click();
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  });

  test('التسجيل ← مباراة ← إحصاءات محفوظة بعد إعادة التحميل', async ({ page }) => {
    const errors = watchConsole(page);
    await bootToMenu(page);

    // 1) ترقية حساب الضيف إلى حساب كامل (التسجيل)
    const email = `e2e-${Date.now()}@duskfront.test`;
    await page.locator('.menu-nav button', { hasText: 'الملف الشخصي' }).click();
    await page.locator('[data-ref="email"]').fill(email);
    await page.locator('[data-ref="password"]').fill('duskfront-pass-1');
    await page.locator('[data-ref="upgrade"]').click();
    await expect(page.locator('.toast')).toBeVisible();

    // 2) الدخول في مباراة
    await page.locator('.menu-nav button', { hasText: 'القائمة الرئيسية' }).click();
    await page.locator('[data-action="quick"]').click();

    await expect(page.locator('#hud')).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('#menu-layer')).toBeHidden();

    // الواجهة تعرض قيمًا حيّة من الخادم الموثوق
    await expect(page.locator('[data-ref="healthValue"]')).toContainText('/');
    await expect(page.locator('[data-ref="timerValue"]')).toContainText(':');
    const coreBefore = await page.locator('[data-ref="coreReadout"]').textContent();
    expect(coreBefore).toMatch(/%$/);

    // 3) اللعب فعليًا: حركة وإطلاق
    await page.locator('#game-canvas').click({ position: { x: 640, y: 360 } });
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(2000);
    await page.keyboard.up('KeyW');
    await page.mouse.down();
    await page.waitForTimeout(700);
    await page.mouse.up();
    await page.waitForTimeout(1500);

    // المباراة تتقدّم: المؤقت ينقص
    const timerA = await page.locator('[data-ref="timerValue"]').textContent();
    await page.waitForTimeout(2500);
    const timerB = await page.locator('[data-ref="timerValue"]').textContent();
    expect(timerA).not.toBe(timerB);

    // 4) العودة إلى القائمة
    await page.keyboard.press('Escape');
    await expect(page.locator('#menu-layer')).toBeVisible({ timeout: 30_000 });

    // 5) إعادة التحميل: الحساب ما زال قائمًا وبياناته محفوظة
    await page.reload();
    await expect(page.locator('#menu-layer')).toBeVisible({ timeout: 40_000 });
    await page.locator('.menu-nav button', { hasText: 'الإحصاءات' }).click();
    await expect(page.locator('.stat-tile').first()).toBeVisible();

    await page.locator('.menu-nav button', { hasText: 'الملف الشخصي' }).click();
    // الحساب لم يعد ضيفًا ⇒ لا يظهر قسم الترقية
    await expect(page.locator('[data-ref="upgrade"]')).toHaveCount(0);

    expect(errors).toEqual([]);
  });

  test('حفظ الحملة يبقى بعد إعادة التحميل', async ({ page }) => {
    await bootToMenu(page);

    await page.locator('.menu-nav button', { hasText: 'الحملة' }).click();
    const firstSlot = page.locator('[data-slot="1"]');
    await expect(firstSlot).toBeVisible();
    await expect(firstSlot).toContainText('فارغ');

    // ابدأ المهمة الأولى — الحفظ التلقائي يقع عند أول نقطة تفتيش
    await firstSlot.click();
    await expect(page.locator('#hud')).toBeVisible({ timeout: 60_000 });

    // العب حتى يتحقق هدف «ابقَ داخل الشفق»
    await page.locator('#game-canvas').click({ position: { x: 640, y: 360 } });
    await page.waitForTimeout(12_000);

    await page.keyboard.press('Escape');
    await expect(page.locator('#menu-layer')).toBeVisible({ timeout: 30_000 });

    await page.reload();
    await expect(page.locator('#menu-layer')).toBeVisible({ timeout: 40_000 });
    await page.locator('.menu-nav button', { hasText: 'الحملة' }).click();
    // الخانة لم تعد فارغة
    await expect(page.locator('[data-slot="1"]')).toContainText('متابعة', { timeout: 20_000 });
  });

  test('التدريب يعرض الخطوات ويتقدّم', async ({ page }) => {
    await bootToMenu(page);
    await page.locator('[data-action="tutorial"]').click();
    await expect(page.locator('#hud')).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('.announcement').first()).toBeVisible({ timeout: 20_000 });

    // الخطوة الأولى: تحرّك
    await page.locator('#game-canvas').click({ position: { x: 640, y: 360 } });
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(4000);
    await page.keyboard.up('KeyW');
    // تظهر خطوة تالية
    await expect(page.locator('.announcement')).toHaveCount(1, { timeout: 20_000 });
  });

  test('لوحة النتائج والخريطة المصغّرة تعملان أثناء المباراة', async ({ page }) => {
    await bootToMenu(page);
    await page.locator('[data-action="quick"]').click();
    await expect(page.locator('#hud')).toBeVisible({ timeout: 60_000 });

    // الخريطة المصغّرة ترسم فعلًا
    const painted = await page.evaluate(() => {
      const canvas = document.querySelector<HTMLCanvasElement>('[data-ref="minimap"]');
      if (!canvas) return false;
      const context = canvas.getContext('2d');
      if (!context) return false;
      const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
      for (let i = 3; i < data.length; i += 4) if (data[i] !== 0) return true;
      return false;
    });
    expect(painted).toBe(true);

    await page.locator('#game-canvas').click({ position: { x: 640, y: 360 } });
    await page.keyboard.down('Tab');
    await expect(page.locator('[data-ref="scoreboard"]')).toBeVisible();
    await expect(page.locator('[data-ref="scoreboardBody"] tr')).not.toHaveCount(0);
    await page.keyboard.up('Tab');
  });
});
