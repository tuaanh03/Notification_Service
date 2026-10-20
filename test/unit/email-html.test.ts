import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  checkEmailHtml,
  EMAIL_HTML_MAX_BYTES,
  emailHtmlToText,
  normalizeLiquid,
} from '../../src/modules/templates/domain/rules/email-html.ts';
import { parseVariables } from '../../src/modules/templates/domain/rules/template-variables.ts';
import { draftContent, normalizeSubject } from '../../src/modules/templates/domain/rules/email-design.ts';
import { TemplateVersion } from '../../src/modules/templates/domain/entities/template-version.ts';
import { emptyVisualDesign, type VisualDesign } from '../../src/modules/templates/domain/types/visual-design.ts';
import { TemplateId, TemplateVersionId } from '../../src/shared/kernel/index.ts';

/** HTML THẬT do GrapesJS + grapesjs-mjml sinh ở trình duyệt (bản thử UX-2): có nhánh `[if mso]`, biến, link. */
const MJML_HTML = readFileSync(new URL('./fixtures/grapesjs-mjml-email.html', import.meta.url), 'utf8');

const codes = (html: string) => checkEmailHtml(html).map((i) => i.code);
const wrap = (body: string) => `<!doctype html><html><head><meta charset="utf-8"><title></title></head><body>${body}</body></html>`;

describe('checkEmailHtml — HTML do bộ soạn trực quan sinh phải ĐẬU', () => {
  it('HTML MJML thật (có <!--[if mso]>, noscript/xml của Outlook, @media, biến trong href) không có lỗi', () => {
    expect(MJML_HTML).toContain('<!--[if mso | IE]>');
    expect(MJML_HTML).toContain('<o:OfficeDocumentSettings>');
    expect(checkEmailHtml(MJML_HTML)).toEqual([]);
  });

  it('chú thích điều kiện kiểu "downlevel-revealed" và chữ có dấu < đứng riêng', () => {
    const html = wrap('<!--[if !mso]><!--><div>a &lt; b, 3 < 4</div><!--<![endif]--><!-- ghi chú thường -->');
    expect(checkEmailHtml(html)).toEqual([]);
  });

  it('link http:// và link tương đối lưu được — validateLinks báo lúc xuất bản, không chặn nháp', () => {
    expect(codes(wrap('<a href="http://x.vn">x</a><a href="#">y</a><a href="">z</a><a href="mailto:a@b.vn">m</a>'))).toEqual([]);
  });

  it('biến trong href, data-* / aria-*, VML của Outlook được phép', () => {
    const html = wrap(
      `<a href="{{ payload.url | default: 'https://x.vn' }}" data-x="1" aria-label="x">x</a>` +
        '<!--[if mso]><v:roundrect arcsize="10%" strokecolor="#000000" fillcolor="#2563eb" href="https://x.vn"><w:anchorlock/></v:roundrect><![endif]-->',
    );
    expect(checkEmailHtml(html)).toEqual([]);
  });
});

describe('checkEmailHtml — biến Liquid trong thuộc tính (UX-3)', () => {
  it('nháy kép bên trong {{ }} không kết thúc thuộc tính — kiểu viết thật của người soạn HTML', () => {
    const html = wrap(
      '<td style="background-color:{{ payload.accent | default: "#F87171" }};">x</td>' +
        '<p style="display:{{ payload.show_note | default: "none" }};">ghi chú</p>' +
        `<a href="{{ payload.url | default: 'https://x.vn' }}" title="{{ payload.name }}">Xem</a>` +
        '<a href="{{ payload.detail_url | default: &quot;https://x.vn&quot; }}">Xem</a>',
    );
    expect(checkEmailHtml(html)).toEqual([]);
  });

  it.each([
    // giấu thuộc tính / thẻ trong {{ }} của thuộc tính
    ['<img src="https://x.vn/a.png" title="{{ payload.a | default: "x" onerror="alert(1)" }}">', 'HTML_MALFORMED'],
    ['<p title="{{ payload.a | default: "<script>alert(1)</script>" }}">x</p>', 'HTML_MALFORMED'],
    ['<p style="color:{{ x }}{{ y }}" onclick="a()">x</p>', 'HTML_ATTRIBUTE_NOT_ALLOWED'],
    ['<p style="{{ payload.css }}" onmouseover="a()">x</p>', 'HTML_ATTRIBUTE_NOT_ALLOWED'],
    ['<p title="{{ payload.a }}" onerror="alert(1)">x</p>', 'HTML_ATTRIBUTE_NOT_ALLOWED'],
    ['<p title="{{ payload.a | upcase }}">x</p>', 'HTML_MALFORMED'],
    ['<p title="{{ payload.a">x</p>', 'HTML_MALFORMED'],
    // ngoài thuộc tính: {{ }} trong chữ vẫn bị quét như HTML
    ['<p>{{ payload.a | default: "<script>alert(1)</script>" }}</p>', 'HTML_TAG_NOT_ALLOWED'],
    ['<p>{{ payload.a | default: "<img src=x onerror=alert(1)>" }}</p>', 'HTML_ATTRIBUTE_NOT_ALLOWED'],
    ['<div style="background:url({{ payload.img }})">x</div>', 'IMAGE_URL_NOT_ALLOWED'],
  ])('%s -> %s', (body, code) => {
    expect(codes(wrap(body))).toContain(code);
  });
});

describe('checkEmailHtml — ca độc phải bị chặn', () => {
  it.each([
    ['<script>alert(1)</script>', 'HTML_TAG_NOT_ALLOWED'],
    ['<iframe src="https://x.vn"></iframe>', 'HTML_TAG_NOT_ALLOWED'],
    ['<svg><circle/></svg>', 'HTML_TAG_NOT_ALLOWED'],
    ['<form action="https://x.vn"><input name="p"></form>', 'HTML_TAG_NOT_ALLOWED'],
    ['<link rel="stylesheet" href="https://x.vn/a.css">', 'HTML_TAG_NOT_ALLOWED'],
    ['<base href="https://evil.vn/">', 'HTML_TAG_NOT_ALLOWED'],
    ['<SCRIPT >x</SCRIPT>', 'HTML_TAG_NOT_ALLOWED'],
    ['<img src="https://x.vn/a.png" onerror="alert(1)">', 'HTML_ATTRIBUTE_NOT_ALLOWED'],
    ['<div ONCLICK=alert(1)>x</div>', 'HTML_ATTRIBUTE_NOT_ALLOWED'],
    ['<div formaction="https://x.vn">x</div>', 'HTML_ATTRIBUTE_NOT_ALLOWED'],
    ['<a href="javascript:alert(1)">x</a>', 'HTML_URL_NOT_ALLOWED'],
    ['<a href="&#106;avascript:alert(1)">x</a>', 'HTML_URL_NOT_ALLOWED'],
    ['<a href="java\tscript:alert(1)">x</a>', 'HTML_URL_NOT_ALLOWED'],
    ['<a href="JaVaScRiPt&colon;alert(1)">x</a>', 'HTML_URL_NOT_ALLOWED'],
    ['<a href="data:text/html;base64,PHNjcmlwdD4=">x</a>', 'HTML_URL_NOT_ALLOWED'],
    ['<img src="http://x.vn/a.png">', 'IMAGE_URL_NOT_ALLOWED'],
    ['<img src="{{ payload.avatar }}">', 'IMAGE_URL_NOT_ALLOWED'],
    ['<img src="data:image/png;base64,AAAA">', 'IMAGE_URL_NOT_ALLOWED'],
    ['<td background="http://x.vn/bg.png">x</td>', 'IMAGE_URL_NOT_ALLOWED'],
    ['<div style="background:url(javascript:alert(1))">x</div>', 'HTML_STYLE_NOT_ALLOWED'],
    ['<div style="width: expression(alert(1))">x</div>', 'HTML_STYLE_NOT_ALLOWED'],
    ['<div style="width: exp/**/ression(alert(1))">x</div>', 'HTML_STYLE_NOT_ALLOWED'],
    ['<div style="x:\\65 xpression(1)">x</div>', 'HTML_STYLE_NOT_ALLOWED'],
    ['<div style="background-image:url(http://x.vn/a.png)">x</div>', 'IMAGE_URL_NOT_ALLOWED'],
    ['<style>@import url(https://x.vn/a.css);</style>', 'HTML_STYLE_NOT_ALLOWED'],
    ['<style>div{-moz-binding:url(https://x.vn/a.xml)}</style>', 'HTML_STYLE_NOT_ALLOWED'],
    ['<meta http-equiv="refresh" content="0;url=https://evil.vn">', 'HTML_ATTRIBUTE_NOT_ALLOWED'],
    ['<div title="x>y', 'HTML_MALFORMED'],
    ['<!-- không đóng', 'HTML_MALFORMED'],
    ['<?xml version="1.0"?>', 'HTML_MALFORMED'],
    ['<!ENTITY x "y">', 'HTML_MALFORMED'],
    ['{% if x %}a{% endif %}', 'HTML_MALFORMED'],
  ])('%s -> %s', (body, code) => {
    expect(codes(wrap(body))).toContain(code);
  });

  it('thứ giấu trong chú thích điều kiện của Outlook vẫn bị quét', () => {
    expect(codes(wrap('<!--[if mso]><script>alert(1)</script><![endif]-->'))).toContain('HTML_TAG_NOT_ALLOWED');
    expect(codes(wrap('<!-- <img src=x onerror=alert(1)> -->'))).toContain('HTML_ATTRIBUTE_NOT_ALLOWED');
  });

  it('quá cỡ -> HTML_TOO_LARGE, đếm theo byte UTF-8 chứ không theo ký tự', () => {
    const vietnamese = 'ữ'.repeat(Math.floor(EMAIL_HTML_MAX_BYTES / 3) + 1); // 3 byte mỗi ký tự
    expect(vietnamese.length).toBeLessThan(EMAIL_HTML_MAX_BYTES);
    expect(codes(wrap(vietnamese))).toEqual(['HTML_TOO_LARGE']);
  });

  it('mỗi lỗi có path "html", không lặp, tối đa 20', () => {
    const issues = checkEmailHtml(wrap('<script></script>'.repeat(5) + Array.from({ length: 30 }, (_, i) => `<x${i}>`).join('')));
    expect(issues.every((i) => i.path === 'html')).toBe(true);
    expect(issues.filter((i) => i.message.includes('<script>'))).toHaveLength(1);
    expect(issues.length).toBe(20);
  });
});

describe('normalizeLiquid', () => {
  it('&quot; trong {{ }} của thuộc tính -> nháy đơn, parseVariables đọc đúng giá trị mặc định', () => {
    const html = '<a href="{{ payload.url | default: &quot;https://x.vn/?a=1&amp;b=2&quot; }}">x</a>';
    const out = normalizeLiquid(html);
    expect(out).toBe(`<a href="{{ payload.url | default: 'https://x.vn/?a=1&b=2' }}">x</a>`);
    expect(parseVariables(out)[0]?.defaultValue).toBe('https://x.vn/?a=1&b=2');
  });

  it('chỉ đụng bên trong {{ }}; chữ và biến đã đúng giữ nguyên từng byte', () => {
    const html = '<p title="&quot;x&quot;">Xin chào {{ payload.name | default: "bạn" }} &amp; &quot;bạn&quot;</p>';
    expect(normalizeLiquid(html)).toBe(html);
    expect(normalizeLiquid(MJML_HTML)).toBe(MJML_HTML);
  });

  it('&#39; / &#34; / &apos; cũng về nháy đơn', () => {
    expect(normalizeLiquid('{{ payload.a | default: &#34;x&#34; }}{{ payload.b | default: &#39;y&apos; }}')).toBe(
      "{{ payload.a | default: 'x' }}{{ payload.b | default: 'y' }}",
    );
  });
});

describe('emailHtmlToText', () => {
  it('HTML MJML thật -> chữ: bỏ head / nhánh Outlook, giữ biến, link thành "chữ (link)"', () => {
    const text = emailHtmlToText(MJML_HTML);
    expect(text).toContain('Cảnh báo: {{ payload.vm_name }}');
    expect(text).toContain('Xin chào {{ payload.name | default: "bạn" }}, máy {{ payload.vm_name }} vượt ngưỡng & cần xử lý.');
    expect(text).toContain('Xem tài liệu (https://eon.vn/docs).');
    expect(text).toContain("Xem chi tiết ({{ payload.detail_url | default: 'https://eon.vn' }})");
    expect(text).toContain('Cột 2: {{ user.external_id }}');
    expect(text).not.toMatch(/mso|OfficeDocumentSettings|@media|<|>/);
    expect(text).not.toMatch(/\n{3,}/);
  });

  it('link mà chữ trùng link, href rỗng hoặc # thì chỉ giữ chữ', () => {
    expect(emailHtmlToText('<a href="https://x.vn">https://x.vn</a> <a href="#">A</a> <a href="">B</a>')).toBe('https://x.vn A B');
  });
});

describe('draftContent — kiểu visual (ADR-0036)', () => {
  const design = (over: Partial<VisualDesign> = {}): VisualDesign => ({
    ...emptyVisualDesign(),
    project: { pages: [] },
    mjml: '<mjml><mj-body></mj-body></mjml>',
    ...over,
  });
  const schema = [
    { name: 'payload.vm_name', source: 'payload' as const, required: true },
    { name: 'payload.name', source: 'payload' as const, required: false },
    { name: 'payload.detail_url', source: 'payload' as const, required: false },
    { name: 'user.external_id', source: 'user' as const, required: true },
  ];
  const visual = (html: string, d = design()) => draftContent({ editor: 'visual', subject: 'Cảnh báo {{ payload.vm_name }}', html, design: d, schema });
  const thrown = (fn: () => unknown) => {
    try {
      fn();
    } catch (err) {
      return (err as { issues?: { code: string; path?: string }[] }).issues ?? [];
    }
    return [];
  };

  it('HTML MJML thật: giữ html (đã chuẩn hoá), backend tự sinh text, lưu nguyên dự án', () => {
    const d = design();
    const content = visual(MJML_HTML, d);
    expect(content.editor).toBe('visual');
    expect(content.html).toBe(MJML_HTML);
    expect(content.text).toContain('Cảnh báo: {{ payload.vm_name }}');
    expect(content.design).toBe(d);
  });

  it('&quot; trong biến của href được chuẩn hoá trước khi lưu', () => {
    const content = visual('<a href="{{ payload.detail_url | default: &quot;https://x.vn&quot; }}">Xem</a>');
    expect(content.html).toBe(`<a href="{{ payload.detail_url | default: 'https://x.vn' }}">Xem</a>`);
  });

  it('HTML độc -> ValidationError, không lưu gì', () => {
    expect(thrown(() => visual('<img src="https://x.vn/a.png" onerror="alert(1)">')).map((i) => i.code)).toEqual(['HTML_ATTRIBUTE_NOT_ALLOWED']);
  });

  it('dự án quá cỡ -> DESIGN_TOO_LARGE ở design.project', () => {
    const big = design({ project: { blob: 'x'.repeat(200_001) } });
    expect(thrown(() => visual('<p>x</p>', big))).toEqual([expect.objectContaining({ code: 'DESIGN_TOO_LARGE', path: 'design.project' })]);
  });

  it('nháp visual xuất bản bằng đúng validate() hiện có; không lưu được bằng nội dung kiểu khác', () => {
    const at = new Date('2026-10-19T03:00:00Z');
    const v = new TemplateVersion({ id: TemplateVersionId.create(), templateId: TemplateId.create(), version: 1, ...visual(MJML_HTML), createdAt: at });
    expect(v.validate()).toEqual([]);
    expect(v.design).not.toBeNull();
    const html = draftContent({ editor: 'html', subject: 'x', html: '<p>x</p>', text: 'x', schema: [] });
    expect(() => v.edit(html, at)).toThrow(expect.objectContaining({ code: 'EDITOR_MISMATCH' }));
  });
});

describe('normalizeSubject — tiêu đề lưu nháp (mọi kiểu soạn)', () => {
  it('U+00A0 quanh chip -> dấu cách thường; dấu cách người gõ giữ nguyên', () => {
    const raw = 'Báo cáo{{ payload.ky_bao_cao }}X cho\u00a0{{ user.external_id }}\u00a0tháng  này!';
    expect(normalizeSubject(raw)).toBe('Báo cáo{{ payload.ky_bao_cao }}X cho {{ user.external_id }} tháng  này!');
  });

  it('draftContent chuẩn hoá tiêu đề cả kiểu html, visual', () => {
    const subject = 'A\u00a0B';
    expect(draftContent({ editor: 'html', subject, html: '', text: '', schema: [] }).subject).toBe('A B');
    expect(draftContent({ editor: 'visual', subject, html: '<p>x</p>', design: emptyVisualDesign(), schema: [] }).subject).toBe('A B');
  });
});
