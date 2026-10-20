import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { TEMPLATE_CATEGORIES, TemplateId, TemplateVersionId } from '../../src/shared/kernel/index.ts';
import { TemplatePresetQueries } from '../../src/modules/templates/application/queries/template-preset-queries.ts';
import { TemplateVersion } from '../../src/modules/templates/domain/entities/template-version.ts';
import { findPreset, TEMPLATE_PRESETS } from '../../src/modules/templates/domain/presets/index.ts';
import { designToMjml } from '../../src/modules/templates/domain/rules/design-to-mjml.ts';
import { checkDesign, DEFAULT_DESIGN_SETTINGS, draftContent, renderDesign } from '../../src/modules/templates/domain/rules/email-design.ts';
import { checkEmailHtml } from '../../src/modules/templates/domain/rules/email-html.ts';
import { renderTemplate } from '../../src/modules/templates/domain/rules/render-template.ts';
import { parseVariables } from '../../src/modules/templates/domain/rules/template-variables.ts';
import { PRESET_LOCALES } from '../../src/modules/templates/domain/types/template-preset.ts';
import { emptyVisualDesign } from '../../src/modules/templates/domain/types/visual-design.ts';
import { mjmlProblems } from './support/mjml-structure.ts';

/**
 * Thư viện mẫu (ADR-0035, ADR-0037): "Dùng mẫu" tạo nháp kiểu `visual` — console biên dịch MJML của mẫu
 * (`designToMjml`) ra HTML bằng grapesjs-mjml. Người soạn bấm "Xuất bản" ngay được, nên MỌI mẫu × MỌI ngôn ngữ:
 * MJML hợp lệ, HTML biên dịch THẬT (`fixtures/preset-html.json`, mjml-browser) qua `checkEmailHtml` và
 * `TemplateVersion.validate()` với 0 lỗi, biến khớp đúng biến đã khai.
 */
const REGENERATE = 'npx tsx test/unit/fixtures/compile-preset-html.ts <mjml-browser dir>';
const FIXTURE = JSON.parse(readFileSync(new URL('./fixtures/preset-html.json', import.meta.url), 'utf8')) as {
  compiler: string;
  presets: Record<string, { mjmlSha256: string; html: string }>;
};
const at = new Date('2026-10-19T03:00:00Z');
const cases = TEMPLATE_PRESETS.flatMap((preset) => PRESET_LOCALES.map((locale) => ({ preset, locale, content: preset.locales[locale] })));

describe('thư viện mẫu — danh mục', () => {
  it('đủ 12 mẫu, id duy nhất dạng kebab-case, version nguyên dương, nhóm hợp lệ', () => {
    expect(TEMPLATE_PRESETS).toHaveLength(12);
    const ids = TEMPLATE_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of TEMPLATE_PRESETS) {
      expect(p.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(Number.isInteger(p.version) && p.version >= 1).toBe(true);
      expect(TEMPLATE_CATEGORIES).toContain(p.category);
    }
  });

  it('mỗi mẫu có đủ vi + en, tên / mô tả / tiêu đề không rỗng; tên không trùng trong một ngôn ngữ', () => {
    for (const p of TEMPLATE_PRESETS) expect(Object.keys(p.locales).sort()).toEqual([...PRESET_LOCALES].sort());
    for (const { content } of cases) {
      expect(content.name.trim()).not.toBe('');
      expect(content.description.trim()).not.toBe('');
      expect(content.subject.trim()).not.toBe('');
    }
    for (const locale of PRESET_LOCALES) {
      const names = TEMPLATE_PRESETS.map((p) => p.locales[locale].name);
      expect(new Set(names).size).toBe(names.length);
    }
  });

  it(`preset-html.json đủ mọi mẫu × mọi ngôn ngữ, không thừa — sinh bằng ${REGENERATE}`, () => {
    expect(Object.keys(FIXTURE.presets).sort()).toEqual(cases.map((c) => `${c.preset.id}/${c.locale}`).sort());
    expect(FIXTURE.compiler).toMatch(/^mjml-browser@/);
  });

  it('findPreset theo id; id lạ -> undefined', () => {
    expect(findPreset('incident-alert')?.category).toBe('alert');
    expect(findPreset('nope')).toBeUndefined();
  });
});

describe.each(cases.map((c) => [`${c.preset.id} (${c.locale})`, c] as const))('mẫu %s', (_label, { preset, locale, content }) => {
  const mjml = () => designToMjml(content.design);
  const compiled = () => {
    const entry = FIXTURE.presets[`${preset.id}/${locale}`];
    if (!entry) throw new Error(`missing in preset-html.json — run ${REGENERATE}`);
    return entry;
  };
  /** Đúng thứ "Dùng mẫu" tạo ra: nháp visual = HTML biên dịch từ MJML của mẫu + tiêu đề / biến của mẫu. */
  const version = () =>
    new TemplateVersion({
      id: TemplateVersionId.create(),
      templateId: TemplateId.create(),
      version: 1,
      ...draftContent({
        editor: 'visual',
        subject: content.subject,
        html: compiled().html,
        design: { ...emptyVisualDesign(), mjml: mjml() },
        schema: content.schema,
      }),
      createdAt: at,
    });

  it('thiết kế qua checkDesign, chỉ khối heading / text / button / divider / spacer, 1–2 cột, cài đặt mặc định', () => {
    expect(checkDesign(content.design)).toEqual([]);
    // Console mở template từ mẫu với "Cài đặt thư" mặc định (`project.ewsSettings` vắng) — phải trùng cài đặt của mẫu.
    expect(content.design.settings).toEqual(DEFAULT_DESIGN_SETTINGS);
    for (const row of content.design.rows) {
      expect(row.columns.length).toBeGreaterThanOrEqual(1);
      expect(row.columns.length).toBeLessThanOrEqual(2);
      for (const column of row.columns) {
        for (const block of column.blocks) expect(['heading', 'text', 'button', 'divider', 'spacer']).toContain(block.type);
      }
    }
  });

  it('id khối / cột / hàng duy nhất trong thiết kế', () => {
    const ids = content.design.rows.flatMap((r) => [r.id, ...r.columns.flatMap((c) => [c.id, ...c.blocks.map((b) => b.id)])]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('designToMjml ra MJML hợp lệ (thẻ / thuộc tính / lồng nhau), đủ số hàng của thiết kế', () => {
    expect(mjmlProblems(mjml())).toEqual([]);
    expect(mjml().match(/<mj-section /g)).toHaveLength(content.design.rows.length);
  });

  it(`HTML biên dịch (preset-html.json) khớp MJML hiện tại — sửa mẫu thì chạy lại ${REGENERATE}`, () => {
    expect(compiled().mjmlSha256).toBe(createHash('sha256').update(mjml()).digest('hex'));
  });

  it('HTML biên dịch qua checkEmailHtml với 0 lỗi, nháp visual qua validate() của xuất bản với 0 lỗi', () => {
    expect(checkEmailHtml(compiled().html)).toEqual([]);
    const v = version();
    expect(v.html).toContain('<!doctype html>');
    expect(v.text.trim()).not.toBe('');
    expect(v.validate()).toEqual([]);
  });

  it('biến dùng trong tiêu đề / MJML / thư khớp đúng biến đã khai — không thiếu, không thừa', () => {
    const v = version();
    for (const body of [mjml(), v.html]) {
      const used = new Set([v.subject, body].flatMap((b) => parseVariables(b).map((x) => x.path)));
      expect([...used].sort()).toEqual(content.schema.map((s) => s.name).sort());
    }
    // Mọi biến đều có giá trị mẫu + mô tả để console xem trước và đội app biết phải gửi gì.
    for (const spec of content.schema) {
      expect(spec.sample?.trim()).toBeTruthy();
      expect(spec.description?.trim()).toBeTruthy();
    }
  });

  it('đổ giá trị mẫu thì không còn biến sót, link nút thành https://', () => {
    const v = version();
    const payload = Object.fromEntries(content.schema.map((s) => [s.name.slice('payload.'.length), s.sample ?? '']));
    const rendered = renderTemplate(v.content, { payload, externalId: 'u-1' });
    expect(rendered.subject).not.toMatch(/\{\{/);
    expect(rendered.html).not.toMatch(/\{\{/);
    for (const match of rendered.html.matchAll(/href="([^"]*)"/g)) expect(match[1]).toMatch(/^https:\/\//);
  });

  it(`danh sách mẫu (${locale}) trả mjml + html ảnh thu nhỏ + đúng nội dung của ngôn ngữ`, () => {
    const dto = new TemplatePresetQueries().list({ locale }).find((p) => p.id === preset.id);
    expect(dto).toMatchObject({ version: preset.version, category: preset.category, locale, name: content.name, subject: content.subject });
    expect(dto?.mjml).toBe(mjml());
    expect(dto?.html).toBe(renderDesign(content.design).html);
  });
});

describe('TemplatePresetQueries', () => {
  it('lọc theo nhóm; nhóm không có mẫu -> rỗng', () => {
    const q = new TemplatePresetQueries();
    expect(q.list({ locale: 'vi', category: 'alert' }).map((p) => p.id)).toEqual(['incident-alert', 'incident-resolved']);
    expect(q.list({ locale: 'en', category: 'other' })).toEqual([]);
    expect(q.list({ locale: 'en' })).toHaveLength(12);
  });
});
