import { describe, expect, it } from 'vitest';
import { designToMjml, MJML_FONT_STACKS } from '../../src/modules/templates/domain/rules/design-to-mjml.ts';
import { emptyDesign } from '../../src/modules/templates/domain/rules/email-design.ts';
import type { DesignBlock, EmailDesign } from '../../src/modules/templates/domain/types/email-design.ts';
import { mjmlProblems } from './support/mjml-structure.ts';

/** `designToMjml` (ADR-0037): thiết kế kéo-thả -> MJML cho bộ soạn trực quan; mẫu dựng sẵn đi qua đây. */
const design = (columns: DesignBlock[][], over: Partial<EmailDesign> = {}): EmailDesign => ({
  ...emptyDesign(),
  rows: [{ id: 'r1', columns: columns.map((blocks, i) => ({ id: `c${i}`, blocks })) }],
  ...over,
});

describe('designToMjml', () => {
  it('thư trống vẫn là MJML hợp lệ, giữ rộng + nền thư', () => {
    const mjml = designToMjml(emptyDesign());
    expect(mjmlProblems(mjml)).toEqual([]);
    expect(mjml).toContain('<mj-body width="600px" background-color="#f1f5f9">');
    expect(mjml).not.toContain('<mj-section');
  });

  it('mỗi khối ra đúng thẻ, giữ màu / cỡ / căn lề / font trên chính khối', () => {
    const mjml = designToMjml(
      design(
        [
          [
            { id: 'h', type: 'heading', text: 'Tiêu đề', level: 2, align: 'center', color: '#111111' },
            { id: 't', type: 'text', text: 'Chữ', align: 'right' },
            { id: 'b', type: 'button', label: 'Xem', url: 'https://ews.vn', align: 'left', backgroundColor: '#059669', textColor: '#ffffff', borderRadius: 24 },
          ],
          [
            { id: 'i', type: 'image', src: 'https://cdn.ews.vn/a.png', alt: 'Ảnh', width: 50, link: 'https://ews.vn/x', align: 'center' },
            { id: 'd', type: 'divider', color: '#e2e8f0', thickness: 2 },
            { id: 's', type: 'spacer', height: 24 },
            { id: 'x', type: 'html', html: '<p>tự viết</p>' },
          ],
        ],
        { settings: { ...emptyDesign().settings, fontFamily: 'serif', width: 540, textColor: '#334155' } },
      ),
    );
    expect(mjmlProblems(mjml)).toEqual([]);
    const font = MJML_FONT_STACKS.serif;
    expect(mjml).toContain(`<mj-all font-family="${font}">`);
    expect(mjml).toContain(`<mj-text align="center" color="#111111" font-family="${font}" font-size="22px" font-weight="700"`);
    expect(mjml).toContain(`<mj-text align="right" color="#334155" font-family="${font}" font-size="16px"`);
    expect(mjml).toContain('<mj-button href="https://ews.vn" align="left" background-color="#059669" color="#ffffff"');
    expect(mjml).toContain('border-radius="24px"');
    // 540 - 2×16 = 508 chia 2 cột = 254, trừ 2×8 lề khối = 238 -> 50% = 119px
    expect(mjml).toContain('<mj-image src="https://cdn.ews.vn/a.png" alt="Ảnh" width="119px" href="https://ews.vn/x" align="center"');
    expect(mjml).toContain('<mj-divider border-width="2px" border-style="solid" border-color="#e2e8f0"');
    expect(mjml).toContain('<mj-spacer height="24px"></mj-spacer>');
    expect(mjml).toContain('<mj-raw><p>tự viết</p></mj-raw>');
    expect(mjml).toContain('<mj-body width="540px"');
    expect(mjml.match(/<mj-column>/g)).toHaveLength(2);
  });

  it('escape chữ người soạn, giữ biến; trong thuộc tính " của biến thành \'', () => {
    const mjml = designToMjml(
      design([
        [
          { id: 't', type: 'text', text: '<b>VM</b> {{ payload.vm_name | default: "máy" }} & **đậm** [xem](https://ews.vn/?a=1&b=2)\ndòng 2', align: 'left' },
          { id: 'b', type: 'button', label: 'Mở <ngay>', url: '{{ payload.url | default: "https://ews.vn" }}', align: 'center', backgroundColor: '#2563eb', textColor: '#ffffff', borderRadius: 6 },
        ],
      ]),
    );
    expect(mjmlProblems(mjml)).toEqual([]);
    expect(mjml).toContain('&lt;b&gt;VM&lt;/b&gt; {{ payload.vm_name | default: "máy" }} &amp; <strong>đậm</strong>');
    expect(mjml).toContain('<a href="https://ews.vn/?a=1&amp;b=2" style="color:#2563eb;text-decoration:underline;">xem</a><br>dòng 2');
    expect(mjml).toContain(`href="{{ payload.url | default: 'https://ews.vn' }}"`);
    expect(mjml).toContain('>Mở &lt;ngay&gt;</mj-button>');
  });

  it('ảnh chưa có link thì bỏ; hàng có nền riêng giữ nền đó', () => {
    const mjml = designToMjml({
      ...design([[{ id: 'i', type: 'image', src: ' ', alt: '', width: 100, link: '', align: 'center' }]]),
      rows: [{ id: 'r1', backgroundColor: '#f8fafc', columns: [{ id: 'c', blocks: [{ id: 'i', type: 'image', src: '', alt: '', width: 100, link: '', align: 'center' }] }] }],
    });
    expect(mjmlProblems(mjml)).toEqual([]);
    expect(mjml).not.toContain('mj-image');
    expect(mjml).toContain('<mj-section background-color="#f8fafc"');
  });

  it('bộ soát cấu trúc bắt được MJML sai', () => {
    expect(mjmlProblems('<mjml><mj-body><mj-column></mj-column></mj-body></mjml>')).toEqual(['<mj-column> not allowed inside <mj-body>']);
    expect(mjmlProblems('<mjml><mj-body><mj-section foo="1"></mj-section></mj-body></mjml>')).toEqual(['<mj-section> has unknown attribute foo']);
    expect(mjmlProblems('<mjml><mj-body>')).toEqual(['not closed: mjml, mj-body']);
    expect(mjmlProblems('<mjml><mj-body><mj-section><mj-column><mj-text><mj-raw>x</mj-raw></mj-text></mj-column></mj-section></mj-body></mjml>')).toEqual([
      '<mj-text> content contains an mj-* tag',
    ]);
  });
});
