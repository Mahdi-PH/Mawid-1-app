/**
 * يحوّل ناتج Vite إلى صفحة HTML واحدة مكتفية بذاتها.
 *
 * لماذا ملف واحد؟ منصّات النشر تعرض الصفحة داخل إطار معزول، وقد لا تُحلّ فيه
 * المسارات النسبية إلى ملفات الأصول — فتظهر صفحة فارغة. دمج الـJS والـCSS داخل
 * الصفحة يلغي هذا الاعتماد كليًا. كما تُحذف وسوم <html>/<head>/<body> لأن تلك
 * المنصّات تغلّف المحتوى في هيكلها الخاص.
 *
 * Inlines the bundle into one self-contained page: viewer frames may not resolve
 * relative asset paths, and the platform wraps the content in its own skeleton.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const distDir = resolve(here, '../apps/client/dist');
const source = readFileSync(resolve(distDir, 'index.html'), 'utf8');

const headMatch = source.match(/<head>([\s\S]*?)<\/head>/i);
const bodyMatch = source.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
if (!headMatch || !bodyMatch) throw new Error('[build-artifact] unexpected index.html shape');

const readAsset = (href) => readFileSync(resolve(distDir, href.replace(/^\.?\//, '')), 'utf8');

/** يمنع نصًّا مضمَّنًا من إغلاق وسم <script> الحاوي له. */
const guardInline = (code) => code.replace(/<\/script>/gi, '<\\/script>');

let head = headMatch[1]
  // الهيكل الجاهز لدى المنصّة يضع charset وviewport بنفسه، والأيقونة تأتي كمعامل
  .replace(/<meta\s+charset=[^>]*>/gi, '')
  .replace(/<meta\s+name="viewport"[^>]*>/gi, '')
  .replace(/<link\s+rel="icon"[^>]*>/gi, '')
  // التحميل المسبق للوحدات بلا معنى بعد الدمج
  .replace(/<link\s+rel="modulepreload"[^>]*>/gi, '');

// أدرِج ورقة الأنماط
head = head.replace(/<link\s+[^>]*rel="stylesheet"[^>]*href="(\.\/[^"]+)"[^>]*>/gi, (_m, href) => {
  return `<style>\n${readAsset(href)}\n</style>`;
});

/*
  تُنتزع حزمة JS من الرأس وتُلحق بآخر الصفحة. المنصّة تلصق الجزء كما هو داخل
  <body>، فلو بقيت الحزمة (قرابة ميغابايت) في المقدّمة لوجب على المتصفّح تحليلها
  قبل أن يصل أصلًا إلى شاشة الإقلاع — أي لحظات من صفحة فارغة. بوضعها في النهاية
  تُرسم الشاشة أولًا، ثم يُقلع المحرّك.
  The bundle is pulled out of the head and appended last. The platform pastes this
  fragment verbatim into <body>, so a ~1 MB script left at the front would have to be
  parsed before the browser even reaches the boot shell — a stretch of blank page.
  Moving it to the end paints the shell first, then boots the engine.
*/
let bundle = '';
head = head.replace(/<script\s+type="module"[^>]*src="(\.\/[^"]+)"[^>]*><\/script>/gi, (_m, src) => {
  bundle = `<script type="module">\n${guardInline(readAsset(src))}\n</script>`;
  return '';
});
if (!bundle) throw new Error('[build-artifact] no module bundle found to inline');

const page = `${head.trim()}\n\n${bodyMatch[1].trim()}\n\n${bundle}\n`;

if (/src="\.\//.test(page) || /href="\.\//.test(page)) {
  throw new Error('[build-artifact] page still references external assets');
}

const outPath = resolve(distDir, 'artifact.html');
writeFileSync(outPath, page, 'utf8');
console.log(`[build-artifact] wrote ${outPath} (${(page.length / 1024).toFixed(0)} KB, self-contained)`);
