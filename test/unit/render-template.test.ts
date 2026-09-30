import { describe, expect, it } from 'vitest';
import type { TemplateContent } from '../../src/modules/templates/domain/entities/template-version.ts';
import { renderTemplate } from '../../src/modules/templates/domain/rules/render-template.ts';

const content = (over: Partial<TemplateContent> = {}): TemplateContent => ({
  subject: '[Cảnh báo] {{ payload.vm_name }} vượt {{ payload.threshold }}%',
  html: '<p>Máy ảo {{ payload.vm_name }} — chủ: {{ payload.owner | default: "chưa rõ" }}</p>',
  text: 'Máy ảo {{ payload.vm_name }} (mã {{ user.external_id }})',
  schema: [
    { name: 'payload.vm_name', source: 'payload', required: true },
    { name: 'payload.threshold', source: 'payload', required: true },
    { name: 'payload.owner', source: 'payload', required: false },
  ],
  ...over,
});
const codesOf = (fn: () => unknown): string[] => {
  try {
    fn();
  } catch (err) {
    return ((err as { issues?: { code: string }[] }).issues ?? []).map((i) => i.code);
  }
  return [];
};

describe('renderTemplate — đổ biến lúc API nhận request (ADR-0020)', () => {
  it('đổ payload, số thành chữ, user.external_id lấy từ người nhận, biến tuỳ chọn dùng default', () => {
    const out = renderTemplate(content(), { payload: { vm_name: 'ai-gateway', threshold: 80 }, externalId: 'emp_01' });
    expect(out).toEqual({
      subject: '[Cảnh báo] ai-gateway vượt 80%',
      html: '<p>Máy ảo ai-gateway — chủ: chưa rõ</p>',
      text: 'Máy ảo ai-gateway (mã emp_01)',
    });
  });

  it('khoá thừa trong payload bị bỏ qua', () => {
    const out = renderTemplate(content(), {
      payload: { vm_name: 'a', threshold: 1, owner: 'Lan', unused: { deep: true } },
      externalId: 'x',
    });
    expect(out.html).toContain('chủ: Lan');
  });

  it('thiếu nhiều biến bắt buộc -> báo MỌI biến trong một lần', () => {
    expect(codesOf(() => renderTemplate(content(), { payload: {}, externalId: 'x' }))).toEqual([
      'MISSING_VARIABLE',
      'MISSING_VARIABLE',
    ]);
  });

  it.each([[null], [{ a: 1 }], [[1, 2]]])('giá trị %j -> INVALID_PAYLOAD_VALUE', (value) => {
    expect(codesOf(() => renderTemplate(content(), { payload: { vm_name: value, threshold: 1 }, externalId: 'x' }))).toEqual([
      'INVALID_PAYLOAD_VALUE',
    ]);
  });

  it('html escape giá trị; subject / text giữ nguyên', () => {
    const out = renderTemplate(content(), {
      payload: { vm_name: '<b>x</b> & "y"', threshold: 1 },
      externalId: 'x',
    });
    expect(out.html).toContain('&lt;b&gt;x&lt;/b&gt; &amp; &quot;y&quot;');
    expect(out.subject).toContain('<b>x</b> & "y"');
  });

  it('một lượt: {{ }} trong dữ liệu của app giữ nguyên chữ, không bị đổ tiếp', () => {
    const out = renderTemplate(content(), { payload: { vm_name: '{{ user.external_id }}', threshold: 1 }, externalId: 'secret' });
    expect(out.text).toBe('Máy ảo {{ user.external_id }} (mã secret)');
  });

  describe('link là biến — kiểm lại sau khi đổ', () => {
    const linked = content({
      html: '<a href="{{ payload.url }}">Xem</a>',
      schema: [{ name: 'payload.url', source: 'payload', required: true }],
      subject: 'x',
      text: '',
    });
    it('https / mailto -> được', () => {
      expect(renderTemplate(linked, { payload: { url: 'https://a.vn/x?a=1&b=2' }, externalId: 'x' }).html).toBe(
        '<a href="https://a.vn/x?a=1&amp;b=2">Xem</a>',
      );
    });
    it.each(['javascript:alert(1)', 'http://a.vn', ' data:text/html,x'])('%s -> LINK_SCHEME_NOT_ALLOWED', (url) => {
      expect(codesOf(() => renderTemplate(linked, { payload: { url }, externalId: 'x' }))).toEqual(['LINK_SCHEME_NOT_ALLOWED']);
    });
  });
});
