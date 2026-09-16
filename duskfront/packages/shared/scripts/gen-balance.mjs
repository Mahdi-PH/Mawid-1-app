/**
 * يحوّل balance.json إلى وحدة TypeScript مضمّنة.
 * Compiles balance.json into an inlined TS module so both Node ESM and the
 * browser bundler consume the same numbers with no JSON-import attributes.
 *
 * شغّله بعد أي تعديل على balance.json:  npm run gen:balance -w @duskfront/shared
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const jsonPath = resolve(here, '../src/balance.json');
const outPath = resolve(here, '../src/balance.generated.ts');

const text = readFileSync(jsonPath, 'utf8');
const data = JSON.parse(text);
delete data.$schema;

const banner = `// ⚠️ ملف مولَّد آليًا — لا تعدّله. عدّل packages/shared/src/balance.json ثم شغّل: npm run gen:balance
// ⚠️ AUTO-GENERATED from balance.json — do not edit by hand.
/* eslint-disable */
`;

const body = `export const balanceData = ${JSON.stringify(data, null, 2)};\n`;
writeFileSync(outPath, banner + body, 'utf8');
console.log(`[gen-balance] wrote ${outPath} (${(banner + body).length} bytes)`);
