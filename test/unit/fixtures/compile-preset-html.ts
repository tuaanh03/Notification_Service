/**
 * Sinh lại `preset-html.json`: HTML THẬT do `mjml-browser` (đúng gói grapesjs-mjml của console dùng để biên dịch)
 * sinh từ MJML của MỌI mẫu × MỌI ngôn ngữ (`designToMjml`). Backend không có trình biên dịch MJML (ADR-0037), nên
 * test `template-presets.test.ts` kiểm HTML trong file này bằng đúng `checkEmailHtml` / `validate()` của backend,
 * và đòi MJML hiện tại khớp `mjmlSha256` đã ghi — sửa mẫu / `designToMjml` mà quên chạy lại script này là test đỏ.
 *
 *   npx tsx test/unit/fixtures/compile-preset-html.ts <thư mục gói mjml-browser>
 *   vd: ../ews-astrolink/node_modules/.pnpm/mjml-browser@4.18.0/node_modules/mjml-browser
 *
 * Không phải dependency của backend: script chỉ chạy tay trên máy dev, đọc gói từ node_modules của console.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import { TEMPLATE_PRESETS } from '../../../src/modules/templates/domain/presets/index.ts';
import { designToMjml } from '../../../src/modules/templates/domain/rules/design-to-mjml.ts';
import { PRESET_LOCALES } from '../../../src/modules/templates/domain/types/template-preset.ts';

type Mjml2Html = (mjml: string, options: Record<string, unknown>) => { html: string; errors: { formattedMessage: string }[] };

const dir = process.argv[2];
if (!dir) throw new Error('usage: npx tsx test/unit/fixtures/compile-preset-html.ts <mjml-browser package dir>');
const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as { version: string };
// mjml-browser là gói cho trình duyệt: cần `window` lúc nạp, ngoài ra không đụng DOM.
(globalThis as Record<string, unknown>)['window'] = globalThis;
const mjml2html = createRequire(import.meta.url)(resolve(dir)) as Mjml2Html;

const presets: Record<string, { mjmlSha256: string; html: string }> = {};
for (const preset of TEMPLATE_PRESETS) {
  for (const locale of PRESET_LOCALES) {
    const mjml = designToMjml(preset.locales[locale].design);
    const strict = mjml2html(mjml, { validationLevel: 'strict', fonts: {} });
    if (strict.errors.length) throw new Error(`${preset.id}/${locale}: ${strict.errors.map((e) => e.formattedMessage).join('; ')}`);
    // Đúng tuỳ chọn lệnh `mjml-code-to-html` của console: `fonts: {}` (không font Google), còn lại mặc định.
    const { html } = mjml2html(mjml, { fonts: {} });
    presets[`${preset.id}/${locale}`] = { mjmlSha256: createHash('sha256').update(mjml).digest('hex'), html };
  }
}
const out = new URL('./preset-html.json', import.meta.url);
writeFileSync(out, `${JSON.stringify({ compiler: `mjml-browser@${pkg.version}`, presets }, null, 2)}\n`);
process.stdout.write(`wrote ${Object.keys(presets).length} presets to ${fileURLToPath(out)}\n`);
