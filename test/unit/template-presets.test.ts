import { describe, expect, it } from 'vitest';
import { TEMPLATE_CATEGORIES, TemplateId, TemplateVersionId } from '../../src/shared/kernel/index.ts';
import { TemplatePresetQueries } from '../../src/modules/templates/application/queries/template-preset-queries.ts';
import { TemplateVersion } from '../../src/modules/templates/domain/entities/template-version.ts';
import { findPreset, TEMPLATE_PRESETS } from '../../src/modules/templates/domain/presets/index.ts';
import { checkDesign, draftContent } from '../../src/modules/templates/domain/rules/email-design.ts';
import { renderTemplate } from '../../src/modules/templates/domain/rules/render-template.ts';
import { parseVariables } from '../../src/modules/templates/domain/rules/template-variables.ts';
import { PRESET_LOCALES } from '../../src/modules/templates/domain/types/template-preset.ts';

/**
 * Thư viện mẫu (ADR-0035): mẫu chép thẳng vào nháp, người soạn bấm "Xuất bản" ngay được — nên MỌI mẫu
 * × MỌI ngôn ngữ phải qua đúng `TemplateVersion.validate()` mà xuất bản dùng, với 0 lỗi.
 */
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

  it('findPreset theo id; id lạ -> undefined', () => {
    expect(findPreset('incident-alert')?.category).toBe('alert');
    expect(findPreset('nope')).toBeUndefined();
  });
});

describe.each(cases.map((c) => [`${c.preset.id} (${c.locale})`, c] as const))('mẫu %s', (_label, { preset, locale, content }) => {
  const version = () =>
    new TemplateVersion({
      id: TemplateVersionId.create(),
      templateId: TemplateId.create(),
      version: 1,
      ...draftContent({ editor: 'blocks', subject: content.subject, design: content.design, schema: content.schema }),
      createdAt: at,
    });

  it('thiết kế qua checkDesign, chỉ khối heading / text / button / divider / spacer, 1–2 cột', () => {
    expect(checkDesign(content.design)).toEqual([]);
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

  it('nội dung sinh ra qua validate() của xuất bản với 0 lỗi', () => {
    const v = version();
    expect(v.html).toContain('<!DOCTYPE html>');
    expect(v.text.trim()).not.toBe('');
    expect(v.validate()).toEqual([]);
  });

  it('biến dùng trong tiêu đề / thư khớp đúng biến đã khai — không thiếu, không thừa', () => {
    const v = version();
    const used = new Set([v.subject, v.html, v.text].flatMap((body) => parseVariables(body).map((x) => x.path)));
    expect([...used].sort()).toEqual(content.schema.map((s) => s.name).sort());
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

  it(`danh sách mẫu (${locale}) trả html đã sinh + đúng nội dung của ngôn ngữ`, () => {
    const dto = new TemplatePresetQueries().list({ locale }).find((p) => p.id === preset.id);
    expect(dto).toMatchObject({ version: preset.version, category: preset.category, locale, name: content.name, subject: content.subject });
    expect(dto?.html).toBe(version().html);
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
