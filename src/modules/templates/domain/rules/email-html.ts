import { issue, type Issue } from '../../../../shared/kernel/index.ts';
import type { VisualDesign } from '../types/visual-design.ts';

/**
 * HTML thư do TRÌNH DUYỆT sinh (bộ soạn trực quan GrapesJS + MJML — ADR-0036): backend không tin nó,
 * kiểm rồi TỪ CHỐI (không âm thầm sửa). Ba hàm thuần:
 *
 *   checkEmailHtml   — kiểm an toàn lúc lưu: thẻ / thuộc tính trong danh sách cho phép, không `on*`, CSS
 *                      không có thứ chạy được, link không có scheme nguy hiểm, ảnh chỉ `https://`, cỡ.
 *   normalizeLiquid  — `&quot;` trong `{{ … }}` -> `'` (ngoại lệ DUY NHẤT được sửa — cùng nghĩa với Liquid).
 *   emailHtmlToText  — bản chữ thường để gửi kèm.
 *
 * Không dùng thư viện đọc HTML: domain không import package ngoài (luật kiến trúc), và hàm này chỉ cần
 * QUÉT thẻ chứ không dựng cây. Bộ quét cố ý khắt khe: thứ gì nó không hiểu chắc chắn thì báo
 * `HTML_MALFORMED` — từ chối nhầm còn hơn để lọt. Phần trong `<!--[if mso]> … <![endif]-->` (MJML sinh cho
 * Outlook) được quét như HTML thường và GIỮ NGUYÊN — xoá nó là hỏng thư trên Outlook.
 *
 * Luật NỘI DUNG (link chỉ `https://` / `mailto:`, biến đã khai, "unsubscribe") vẫn chạy lúc xuất bản bằng
 * `TemplateVersion.validate()` — ở đây chỉ chặn thứ nguy hiểm, nháp vẫn lưu được khi link còn `http://`.
 */

/** Như `MAX_EMAIL_BODY_BYTES` của notifications (ADR-0016): HTML lớn hơn thì gửi đi cũng bị từ chối. */
export const EMAIL_HTML_MAX_BYTES = 256 * 1024;
/**
 * Cỡ phần dự án của kiểu `visual` (ký tự JSON / MJML). Cả body lưu nháp vẫn chịu `LARGE_BODY_LIMIT_BYTES`
 * (512 KB) — không nới; thư thường (dưới 100 KB HTML) còn rất xa trần.
 */
export const VISUAL_DESIGN_LIMITS = { projectJsonChars: 200_000, mjmlChars: 64_000 } as const;

/** Kiểm cỡ dự án GrapesJS + MJML lúc lưu. Hình dạng (`format`, `version`) đã kiểm bằng zod ở route. */
export function checkVisualDesign(design: VisualDesign): Issue[] {
  const issues: Issue[] = [];
  if (JSON.stringify(design.project).length > VISUAL_DESIGN_LIMITS.projectJsonChars) {
    issues.push(issue('DESIGN_TOO_LARGE', `design project must be at most ${VISUAL_DESIGN_LIMITS.projectJsonChars} characters of JSON`, 'design.project'));
  }
  if (design.mjml.length > VISUAL_DESIGN_LIMITS.mjmlChars) {
    issues.push(issue('DESIGN_TOO_LARGE', `design mjml must be at most ${VISUAL_DESIGN_LIMITS.mjmlChars} characters`, 'design.mjml'));
  }
  return issues;
}

/** Báo tối đa chừng này lỗi — HTML hỏng nặng không cần liệt kê hết. */
const MAX_ISSUES = 20;

const UTF8 = new TextEncoder();

/** Thẻ được phép (chữ thường). Thẻ `o:` / `v:` / `w:` là của Outlook (MJML sinh trong nhánh mso). */
const ALLOWED_TAGS = new Set([
  'html', 'head', 'body', 'meta', 'title', 'style',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'caption', 'colgroup', 'col',
  'div', 'span', 'p', 'br', 'hr', 'a', 'img', 'center', 'font',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'strong', 'b', 'em', 'i', 'u', 's', 'strike', 'del', 'ins', 'sub', 'sup', 'small', 'big', 'mark',
  'blockquote', 'pre', 'code', 'ul', 'ol', 'li', 'dl', 'dt', 'dd',
  'section', 'article', 'header', 'footer', 'main', 'nav', 'figure', 'figcaption', 'abbr', 'address', 'cite', 'q',
  'noscript', 'xml',
  'o:officedocumentsettings', 'o:allowpng', 'o:pixelsperinch',
  'v:roundrect', 'v:rect', 'v:fill', 'v:textbox', 'v:image', 'v:stroke', 'w:anchorlock',
]);

/** Thuộc tính được phép (chữ thường). `data-*` và `aria-*` luôn được phép (không chạy được gì). */
const ALLOWED_ATTRIBUTES = new Set([
  'class', 'id', 'style', 'title', 'lang', 'dir', 'role', 'name', 'type', 'media',
  'align', 'valign', 'width', 'height', 'border', 'cellpadding', 'cellspacing', 'bgcolor', 'background',
  'colspan', 'rowspan', 'scope', 'nowrap', 'hspace', 'vspace', 'summary', 'start',
  'href', 'target', 'rel', 'src', 'alt',
  'color', 'face', 'size',
  'charset', 'content', 'http-equiv',
  'xmlns', 'xmlns:v', 'xmlns:o', 'xmlns:w',
  // VML của Outlook (nút bo góc, ảnh nền)
  'arcsize', 'strokecolor', 'strokeweight', 'fillcolor', 'stroke', 'fill', 'inset', 'aspect', 'origin', 'position',
  'o:button', 'o:allowincell',
]);

/** Thuộc tính chứa URL — giải entity rồi mới xét scheme (`&#106;avascript:` vẫn là javascript:). */
const URL_ATTRIBUTES = new Set(['href', 'src', 'background']);
/** Lưu nháp: chỉ chặn scheme nguy hiểm. `http://` / link tương đối để `validateLinks` báo lúc xuất bản. */
const SAFE_LINK_SCHEMES = new Set(['https', 'http', 'mailto']);
/** Ảnh (src, background, url() trong CSS): chỉ `https://`, không biến — như kiểu kéo-thả (ADR-0034 §6). */
const IMAGE_URL_RE = /^https:\/\/[^\s"'<>{}]+$/i;
/** `http-equiv` vô hại; `refresh` / `set-cookie` thì không. */
const ALLOWED_HTTP_EQUIV = new Set(['content-type', 'x-ua-compatible']);
/** Thẻ mà nội dung là chữ thô tới thẻ đóng của chính nó. */
const RAW_TEXT_TAGS = new Set(['style', 'title']);

const TAG_NAME_RE = /^[A-Za-z][A-Za-z0-9:-]*/;
const ATTR_NAME_RE = /^[^\s"'<>/=`]+/;
/** Liquid đặt ngoài phần chữ (`{% … %}`) không có trong cú pháp biến của mình — chặn để khỏi hiểu nhầm. */
const LIQUID_TAG_RE = /\{%/;

export function checkEmailHtml(html: string): Issue[] {
  const issues: Issue[] = [];
  const seen = new Set<string>();
  const report = (code: string, message: string) => {
    const key = `${code}|${message}`;
    if (seen.has(key) || issues.length >= MAX_ISSUES) return;
    seen.add(key);
    issues.push(issue(code, message, 'html'));
  };
  if (UTF8.encode(html).length > EMAIL_HTML_MAX_BYTES) {
    report('HTML_TOO_LARGE', `html must be at most ${EMAIL_HTML_MAX_BYTES} bytes`);
    return issues;
  }
  if (LIQUID_TAG_RE.test(html)) report('HTML_MALFORMED', 'liquid tags {% … %} are not supported, only {{ … }} variables');
  scanHtml(html, report, 0);
  return issues;
}

type Report = (code: string, message: string) => void;

/** Quét một đoạn HTML; `depth` > 0 = đang ở trong phần chú thích điều kiện của Outlook. */
function scanHtml(html: string, report: Report, depth: number): void {
  let i = 0;
  while (i < html.length) {
    const lt = html.indexOf('<', i);
    if (lt === -1) return;
    const next = html[lt + 1] ?? '';
    if (html.startsWith('<!--', lt)) {
      const end = html.indexOf('-->', lt + 4);
      if (end === -1) return report('HTML_MALFORMED', 'unterminated comment');
      if (depth > 3) return report('HTML_MALFORMED', 'comments are nested too deeply');
      scanHtml(conditionalBody(html.slice(lt + 4, end)), report, depth + 1);
      i = end + 3;
    } else if (html.startsWith('<![', lt)) {
      // `<![endif]>` / `<![endif]` của chú thích điều kiện kiểu "downlevel-revealed".
      const end = html.indexOf(']', lt + 3);
      const marker = end === -1 ? '' : html.slice(lt + 3, end).trim().toLowerCase();
      if (!/^(endif|if [^<>]*)$/.test(marker)) return report('HTML_MALFORMED', 'unexpected <![ … ]> section');
      i = html[end + 1] === '>' ? end + 2 : end + 1;
    } else if (next === '!') {
      const end = html.indexOf('>', lt);
      if (end === -1 || !/^<!doctype\s+html\b[^<>]*$/i.test(html.slice(lt, end))) {
        return report('HTML_MALFORMED', 'only <!DOCTYPE html> is allowed as a declaration');
      }
      i = end + 1;
    } else if (next === '?') {
      return report('HTML_MALFORMED', 'processing instructions <? … ?> are not allowed');
    } else if (next === '/') {
      const name = TAG_NAME_RE.exec(html.slice(lt + 2))?.[0];
      const end = html.indexOf('>', lt);
      if (!name || end === -1) return report('HTML_MALFORMED', 'malformed closing tag');
      checkTagName(name.toLowerCase(), report);
      i = end + 1;
    } else if (/[A-Za-z]/.test(next)) {
      const parsed = parseTag(html, lt);
      if (!parsed) return report('HTML_MALFORMED', 'malformed tag');
      const name = parsed.name.toLowerCase();
      checkTagName(name, report);
      for (const attr of parsed.attributes) checkAttribute(name, attr, report);
      i = parsed.end;
      if (RAW_TEXT_TAGS.has(name) && !parsed.selfClosing) {
        const close = html.toLowerCase().indexOf(`</${name}`, i);
        if (close === -1) return report('HTML_MALFORMED', `unterminated <${name}>`);
        if (name === 'style') checkCss(html.slice(i, close), report);
        i = close;
      }
    } else {
      // `<` đứng một mình (vd "a < b") là chữ.
      i = lt + 1;
    }
  }
}

/** `[if mso | IE]><table …><![endif]` -> phần HTML ở giữa; chú thích thường trả nguyên văn (chỉ là chữ). */
function conditionalBody(comment: string): string {
  const open = /^\s*\[if [^\]<>]*\]>/i.exec(comment);
  const body = open ? comment.slice(open[0].length) : comment;
  // `<!--[if !mso]><!-->` kết thúc bằng `<!`; `<!--<![endif]-->` chỉ có `<![endif]`.
  return body.replace(/<!\[endif\]\s*$/i, '').replace(/<!\s*$/, '');
}

interface Attribute {
  name: string;
  value: string | null;
}

/** Đọc `<tag a="1" b='2' c=3 d>` từ vị trí `<`. Trả null nếu không đọc nổi (thiếu `>`, nháy không đóng). */
function parseTag(html: string, start: number): { name: string; attributes: Attribute[]; end: number; selfClosing: boolean } | null {
  const name = TAG_NAME_RE.exec(html.slice(start + 1))?.[0];
  if (!name) return null;
  let i = start + 1 + name.length;
  const attributes: Attribute[] = [];
  for (;;) {
    while (i < html.length && /\s/.test(html[i] ?? '')) i++;
    if (i >= html.length) return null;
    const ch = html[i];
    if (ch === '>') return { name, attributes, end: i + 1, selfClosing: false };
    if (ch === '/' && html[i + 1] === '>') return { name, attributes, end: i + 2, selfClosing: true };
    if (ch === '/') {
      i++;
      continue;
    }
    const attrName = ATTR_NAME_RE.exec(html.slice(i))?.[0];
    if (!attrName) return null;
    i += attrName.length;
    while (i < html.length && /\s/.test(html[i] ?? '')) i++;
    if (html[i] !== '=') {
      attributes.push({ name: attrName, value: null });
      continue;
    }
    i++;
    while (i < html.length && /\s/.test(html[i] ?? '')) i++;
    const quote = html[i];
    if (quote === '"' || quote === "'") {
      const close = html.indexOf(quote, i + 1);
      if (close === -1) return null;
      attributes.push({ name: attrName, value: html.slice(i + 1, close) });
      i = close + 1;
    } else {
      const raw = /^[^\s"'=<>`]+/.exec(html.slice(i))?.[0];
      if (!raw) return null;
      attributes.push({ name: attrName, value: raw });
      i += raw.length;
    }
  }
}

function checkTagName(name: string, report: Report): void {
  if (!ALLOWED_TAGS.has(name)) report('HTML_TAG_NOT_ALLOWED', `tag <${name}> is not allowed in an email`);
}

function checkAttribute(tag: string, attr: Attribute, report: Report): void {
  const name = attr.name.toLowerCase();
  if (name.startsWith('on')) {
    report('HTML_ATTRIBUTE_NOT_ALLOWED', `event handler attribute ${name} is not allowed`);
    return;
  }
  if (!ALLOWED_ATTRIBUTES.has(name) && !/^(data|aria)-[a-z0-9_.:-]+$/.test(name)) {
    report('HTML_ATTRIBUTE_NOT_ALLOWED', `attribute ${name} is not allowed on <${tag}>`);
    return;
  }
  const value = decodeEntities(attr.value ?? '');
  if (name === 'style') checkCss(value, report);
  if (name === 'http-equiv' && !ALLOWED_HTTP_EQUIV.has(value.trim().toLowerCase())) {
    report('HTML_ATTRIBUTE_NOT_ALLOWED', `http-equiv "${value.trim()}" is not allowed`);
  }
  if (!URL_ATTRIBUTES.has(name)) return;
  const url = value.trim();
  // Ảnh: `src` của mọi thẻ trừ `v:roundrect` (không có), `background` — chỉ https, không biến.
  if (name === 'src' || name === 'background') {
    if (url !== '' && !IMAGE_URL_RE.test(url)) {
      report('IMAGE_URL_NOT_ALLOWED', `image source "${shorten(url)}" must be an https:// URL without variables`);
    }
    return;
  }
  const scheme = schemeOf(url);
  if (scheme !== null && !SAFE_LINK_SCHEMES.has(scheme)) {
    report('HTML_URL_NOT_ALLOWED', `link scheme "${scheme}:" is not allowed`);
  }
}

/**
 * Scheme của một URL như trình duyệt hiểu: bỏ khoảng trắng / ký tự điều khiển chen giữa (`java\tscript:`).
 * Link bắt đầu bằng biến (`{{ payload.url }}`) chưa có scheme — kiểm lại sau khi đổ biến lúc gửi.
 */
function schemeOf(url: string): string | null {
  if (url.startsWith('{{')) return null;
  // eslint-disable-next-line no-control-regex
  const compact = url.replace(/[\u0000- \u007f]/g, '').toLowerCase();
  const match = /^([a-z][a-z0-9+.-]*):/.exec(compact);
  return match?.[1] ?? null;
}

/** CSS trong `style="…"` hoặc `<style>`: không có thứ chạy được, ảnh nền chỉ https. */
function checkCss(css: string, report: Report): void {
  // Bỏ chú thích CSS và ký tự thoát `\` trước khi tìm — `exp/**/ression(` / `\65 xpression(` là trò quen.
  const flat = decodeEntities(css).replace(/\/\*[\s\S]*?\*\//g, '').toLowerCase();
  if (flat.includes('\\')) report('HTML_STYLE_NOT_ALLOWED', 'CSS escapes (\\) are not allowed');
  for (const bad of ['expression(', 'javascript:', 'vbscript:', 'behavior', '-moz-binding', '@import']) {
    if (flat.includes(bad)) report('HTML_STYLE_NOT_ALLOWED', `CSS must not contain "${bad.replace(/\($/, '')}"`);
  }
  for (const match of flat.matchAll(/url\(\s*(['"]?)(.*?)\1\s*\)/g)) {
    const url = (match[2] ?? '').trim();
    if (!IMAGE_URL_RE.test(url)) report('IMAGE_URL_NOT_ALLOWED', `CSS url "${shorten(url)}" must be an https:// URL`);
  }
}

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', colon: ':', tab: '\t', newline: '\n', sol: '/', lpar: '(', rpar: ')',
};

function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);?/gi, (whole, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? whole;
  });
}

const shorten = (value: string) => (value.length > 80 ? `${value.slice(0, 77)}...` : value);

/**
 * Biến trong thuộc tính bị bộ soạn ghi `"` thành `&quot;` (`href="{{ payload.url | default: &quot;x&quot; }}"`).
 * `renderTemplate` đọc chuỗi thô nên sẽ hiểu sai giá trị mặc định -> đổi về `'` (cùng nghĩa trong Liquid),
 * cùng `&#39;` / `&apos;` / `&amp;`. CHỈ bên trong `{{ … }}`; chỗ khác giữ nguyên từng byte.
 */
export function normalizeLiquid(html: string): string {
  return html.replace(/\{\{[^{}]*\}\}/g, (token) =>
    token
      .replace(/&(quot|#34|#x22|apos|#39|#x27);/gi, "'")
      .replace(/&amp;/gi, '&'),
  );
}

/** Thẻ khối: hết thẻ thì xuống dòng. */
const BLOCK_CLOSE_RE = /<\/(p|div|tr|li|h[1-6]|table|blockquote|pre|section|article|header|footer|ul|ol)\s*>/gi;

/**
 * HTML thư -> bản chữ thường. Bỏ phần `<head>`, mọi chú thích (nhánh Outlook trùng nội dung), thẻ;
 * link thành "chữ (link)" khi chữ khác link. Biến `{{ … }}` giữ nguyên để đổ lúc gửi.
 */
export function emailHtmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<(head|style|title|script|noscript|xml)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
      .replace(/<a\b[^>]*?\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')[^>]*>([\s\S]*?)<\/a\s*>/gi, (_m, dq: string | undefined, sq: string | undefined, inner: string) => {
        const href = (dq ?? sq ?? '').trim();
        const label = inner.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
        if (!href || href === '#' || href === label) return label;
        return label ? `${label} (${href})` : href;
      })
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(BLOCK_CLOSE_RE, '\n')
      .replace(/<[^>]+>/g, ''),
  )
    .replace(/ /g, ' ')
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
