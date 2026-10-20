import { describe, expect, it } from 'vitest';
import { TemplateId, TemplateVersionId } from '../../src/shared/kernel/index.ts';
import { TemplateVersion } from '../../src/modules/templates/domain/entities/template-version.ts';
import { renderTemplate } from '../../src/modules/templates/domain/rules/render-template.ts';
import type { TemplateContent } from '../../src/modules/templates/domain/entities/template-version.ts';
import {
  checkDesign,
  DESIGN_LIMITS,
  emptyDesign,
  escapeKeepingVariables,
  renderDesign,
} from '../../src/modules/templates/domain/rules/email-design.ts';
import type { DesignBlock, EmailDesign } from '../../src/modules/templates/domain/types/email-design.ts';
import type { VariableSpec } from '../../src/modules/templates/domain/types/template-variable.ts';

const at = new Date('2026-10-18T03:00:00Z');
const codes = (issues: readonly { code: string }[]) => issues.map((i) => i.code);

const design = (columns: DesignBlock[][], over: Partial<EmailDesign> = {}): EmailDesign => ({
  ...emptyDesign(),
  rows: [{ id: 'r1', columns: columns.map((blocks, i) => ({ id: `c${i}`, blocks })) }],
  ...over,
});
const text = (value: string): DesignBlock => ({ id: 't', type: 'text', text: value, align: 'left' });
const button = (url: string, label = 'Xem'): DesignBlock => ({
  id: 'b',
  type: 'button',
  label,
  url,
  align: 'center',
  backgroundColor: '#2563eb',
  textColor: '#ffffff',
  borderRadius: 6,
});
const image = (src: string, over: Partial<Extract<DesignBlock, { type: 'image' }>> = {}): DesignBlock => ({
  id: 'i',
  type: 'image',
  src,
  alt: '',
  width: 100,
  link: '',
  align: 'center',
  ...over,
});

/**
 * HTML `renderDesign` sinh (ảnh thu nhỏ của thư viện mẫu — ADR-0037) đặt vào một version kiểu `html` để chạy đúng
 * `validate()` của xuất bản: hàm sinh không được tạo ra thứ luật nội dung từ chối.
 */
const rendered = (subject: string, d: EmailDesign, schema: readonly VariableSpec[]): TemplateContent => ({
  editor: 'html',
  design: null,
  subject,
  ...renderDesign(d),
  schema,
});

/** Thiết kế -> HTML rồi chạy `validate()` của xuất bản. */
const publishIssues = (d: EmailDesign, schema = [{ name: 'payload.vm_name', source: 'payload' as const, required: true }]) =>
  codes(
    new TemplateVersion({
      id: TemplateVersionId.create(),
      templateId: TemplateId.create(),
      version: 1,
      ...rendered('Cảnh báo {{ payload.vm_name }}', d, schema),
      createdAt: at,
    }).validate(),
  );

describe('renderDesign — escape chữ người soạn, giữ biến (ADR-0034)', () => {
  it('thẻ trong chữ bị escape, biến {{ }} giữ nguyên', () => {
    const { html } = renderDesign(design([[text('<b>VM</b> {{ payload.vm_name }} & "x"')]]));
    expect(html).toContain('&lt;b&gt;VM&lt;/b&gt; {{ payload.vm_name }} &amp; &quot;x&quot;');
    expect(html).not.toContain('<b>VM</b>');
  });

  it('khối html KHÔNG bị escape', () => {
    const { html } = renderDesign(design([[{ id: 'h', type: 'html', html: '<b>thô</b>' }]]));
    expect(html).toContain('<b>thô</b>');
  });

  it('**đậm** và [chữ](link) trong đoạn chữ; xuống dòng thành <br>', () => {
    const { html, text: plain } = renderDesign(design([[text('**Gấp**\n[Xem]({{ payload.url }})')]]));
    expect(html).toContain('<strong>Gấp</strong><br><a href="{{ payload.url }}"');
    expect(plain).toBe('Gấp\nXem ({{ payload.url }})');
  });

  it('biến trong thuộc tính: " đổi thành \' và vẫn đổ đúng lúc gửi', () => {
    expect(escapeKeepingVariables('{{ payload.url | default: "https://a.vn" }}', true)).toBe("{{ payload.url | default: 'https://a.vn' }}");
    const content = rendered('s', design([[button('{{ payload.url | default: "https://ews.vn/?a=1&b=2" }}')]]), [
      { name: 'payload.url', source: 'payload', required: false },
    ]);
    const out = renderTemplate(content, { payload: {}, externalId: 'emp_01' });
    expect(out.html).toContain('href="https://ews.vn/?a=1&amp;b=2"');
  });

  it('biến có < > bị escape cả token — không để thẻ thô lọt vào HTML', () => {
    expect(escapeKeepingVariables('{{ payload.x | default: "<img>" }}')).not.toContain('<img>');
  });

  it('thiết kế không có hàng -> html và text rỗng, xuất bản báo HTML_REQUIRED', () => {
    expect(renderDesign(emptyDesign())).toEqual({ html: '', text: '' });
    expect(publishIssues(emptyDesign())).toContain('HTML_REQUIRED');
  });
});

describe('renderDesign — hàng và cột', () => {
  it('1 / 2 / 3 cột: mỗi cột inline-block, max-width chia đều, Outlook có bảng ẩn', () => {
    const one = renderDesign(design([[text('a')]])).html;
    const three = renderDesign(design([[text('a')], [text('b')], [text('c')]])).html;
    expect(one).toContain('max-width:568px');
    expect(three.match(/display:inline-block;width:100%;max-width:189px/g)).toHaveLength(3);
    expect(three).toContain('<!--[if mso]><td width="189" valign="top"><![endif]-->');
    expect(three).toContain('max-width:600px');
  });

  it('ảnh: luôn có alt (rỗng nếu trống), co lại trên điện thoại, link tuỳ chọn', () => {
    const { html } = renderDesign(design([[image('https://cdn.ews.vn/a.png', { width: 50, link: 'https://ews.vn' })]]));
    expect(html).toContain('alt=""');
    expect(html).toContain('max-width:100%;height:auto');
    expect(html).toMatch(/<a href="https:\/\/ews\.vn"[^>]*><img src="https:\/\/cdn\.ews\.vn\/a\.png"/);
    expect(renderDesign(design([[image('')]])).html).not.toContain('<img');
  });

  it('bản chữ thường: tiêu đề, chữ, nút (nhãn: link), đường kẻ, khối html bỏ thẻ', () => {
    const { text: plain } = renderDesign(
      design([
        [
          { id: 'h', type: 'heading', text: 'Cảnh báo', level: 1, align: 'left' },
          button('https://ews.vn', 'Mở'),
          { id: 'd', type: 'divider', color: '#e2e8f0', thickness: 1 },
          { id: 's', type: 'spacer', height: 20 },
          { id: 'x', type: 'html', html: '<p>Một&nbsp;<b>hai</b></p><style>p{}</style>' },
        ],
      ]),
    );
    expect(plain).toBe('Cảnh báo\n\nMở: https://ews.vn\n\n----------\n\nMột hai');
  });
});

describe('xuất bản kiểu blocks chạy đúng validate() hiện có', () => {
  it('link nút sai scheme -> LINK_SCHEME_NOT_ALLOWED lúc xuất bản (nháp vẫn lưu được)', () => {
    expect(publishIssues(design([[text('{{ payload.vm_name }}'), button('javascript:alert(1)')]]))).toEqual(['LINK_SCHEME_NOT_ALLOWED']);
    expect(publishIssues(design([[text('{{ payload.vm_name }}'), button('')]]))).toEqual(['LINK_SCHEME_NOT_ALLOWED']);
    expect(publishIssues(design([[text('{{ payload.vm_name }}'), button('mailto:a@b.vn'), button('{{ payload.vm_name }}')]]))).toEqual([]);
  });

  it('chữ "unsubscribe" và biến chưa khai bị chặn như HTML tay', () => {
    const got = publishIssues(design([[text('Unsubscribe {{ payload.other }}')]]));
    expect(got).toContain('UNSUBSCRIBE_LINK_NOT_ALLOWED');
    expect(got).toContain('VARIABLE_NOT_IN_SCHEMA');
  });
});

describe('checkDesign — giới hạn và link ảnh (lúc lưu)', () => {
  it('ảnh chỉ https://, không biến; rỗng thì được', () => {
    expect(codes(checkDesign(design([[image('http://a.vn/x.png')]])))).toEqual(['IMAGE_URL_NOT_ALLOWED']);
    expect(codes(checkDesign(design([[image('{{ payload.img }}')]])))).toEqual(['IMAGE_URL_NOT_ALLOWED']);
    expect(codes(checkDesign(design([[image('https://a.vn/{{ payload.id }}.png')]])))).toEqual(['IMAGE_URL_NOT_ALLOWED']);
    expect(checkDesign(design([[image('')], [image('https://a.vn/x.png')]]))).toEqual([]);
  });

  it('vượt số hàng / số khối / cỡ JSON -> mã riêng; draftContent ném ValidationError', () => {
    const rows = Array.from({ length: DESIGN_LIMITS.rows + 1 }, (_, i) => ({ id: `r${i}`, columns: [{ id: 'c', blocks: [] }] }));
    expect(codes(checkDesign({ ...emptyDesign(), rows }))).toEqual(['DESIGN_TOO_MANY_ROWS']);
    const many = Array.from({ length: DESIGN_LIMITS.blocks + 1 }, () => text('a'));
    expect(codes(checkDesign(design([many])))).toEqual(['DESIGN_TOO_MANY_BLOCKS']);
    const big = Array.from({ length: 20 }, () => text('x'.repeat(DESIGN_LIMITS.textChars)));
    expect(codes(checkDesign(design([big])))).toEqual(['DESIGN_TOO_LARGE']);
  });
});
