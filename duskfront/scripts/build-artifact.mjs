/**
 * يحوّل مخرجات Vite إلى صفحة تصلح للنشر كـ Artifact.
 *
 * منصّة Artifacts تغلّف الملف في هيكل <!doctype html><head>…<body> خاص بها،
 * فلا يجوز أن يحمل ملفنا وسومه الخاصة. هذا السكربت يستخرج محتوى <head> و<body>
 * من ناتج البناء ويدمجهما في شظية واحدة، مع إبقاء مسارات الأصول نسبية.
 *
 * Artifacts wrap the published file in their own document skeleton, so the file must
 * not carry its own <html>/<head>/<body>. This flattens Vite's output into a fragment.
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

const head = headMatch[1]
  // الهيكل الجاهز يضع charset وviewport بنفسه
  .replace(/<meta\s+charset=[^>]*>/gi, '')
  .replace(/<meta\s+name="viewport"[^>]*>/gi, '')
  // الأيقونة تأتي من معامل favicon عند النشر
  .replace(/<link\s+rel="icon"[^>]*>/gi, '')
  // الأصول على نفس الأصل، فلا داعي لوضع طلبها في نمط CORS (الخطوط الخارجية تحتفظ به)
  .replace(/<(script|link)\b[^>]*>/gi, (tag) =>
    /(?:src|href)="\.\//.test(tag) ? tag.replace(/\s+crossorigin(?=[\s>])/gi, '') : tag,
  )
  .trim();

const body = bodyMatch[1].trim();

const page = `${head}\n\n${body}\n`;
const outPath = resolve(distDir, 'artifact.html');
writeFileSync(outPath, page, 'utf8');
console.log(`[build-artifact] wrote ${outPath} (${page.length} bytes)`);
