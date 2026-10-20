import { issue, ValidationError, type Issue } from '../../../../shared/kernel/index.ts';
import type { TemplateContent } from '../entities/template-version.ts';
import {
  EMAIL_DESIGN_VERSION,
  type DesignAlign,
  type DesignBlock,
  type DesignFont,
  type DesignSettings,
  type EmailDesign,
} from '../types/email-design.ts';
import type { VariableSpec } from '../types/template-variable.ts';
import type { VisualDesign } from '../types/visual-design.ts';
import { checkEmailHtml, checkVisualDesign, emailHtmlToText, normalizeLiquid } from './email-html.ts';
import { VARIABLE_RE } from './template-variables.ts';

/**
 * Thiết kế JSON (`EmailDesign`, ADR-0034) -> HTML email + bản chữ thường. Trình kéo-thả đã gỡ (ADR-0037): định dạng
 * này chỉ còn là cách VIẾT thư viện mẫu dựng sẵn; `renderDesign` làm ảnh thu nhỏ, `designToMjml` ra MJML để console
 * biên dịch. File này cũng giữ `draftContent` — đường lưu nháp chung của kiểu `html` / `visual`.
 *
 * HTML dạng bảng, style inline, rộng tối đa 600px — chạy được trên Outlook bản Windows. Cột kiểu
 * "fluid hybrid": mỗi cột `inline-block` có `max-width`, Outlook đọc bảng ẩn trong `<!--[if mso]>`;
 * màn hẹp thì cột tự xếp chồng mà không cần media query.
 *
 * Mọi chữ người soạn nhập đều được escape, TRỪ khối `html`. Biến `{{ … }}` giữ nguyên để
 * `renderTemplate` đổ lúc gửi. Luật nội dung (link, "unsubscribe", biến đã khai) KHÔNG kiểm ở đây —
 * xuất bản chạy `TemplateVersion.validate()` trên chính HTML này.
 */

/** Giới hạn của một thiết kế — đủ để HTML sinh ra nằm dưới 256 KB của `EmailContent` (ADR-0016). */
export const DESIGN_LIMITS = {
  rows: 40,
  columnsPerRow: 3,
  blocks: 100,
  /** Ký tự của JSON thiết kế. */
  jsonChars: 64_000,
  /** Chữ của một khối (tiêu đề, đoạn chữ, nhãn nút, link, alt). */
  textChars: 5_000,
  htmlBlockChars: 32_000,
} as const;

export const DEFAULT_DESIGN_SETTINGS: DesignSettings = {
  width: 600,
  backgroundColor: '#f1f5f9',
  contentBackgroundColor: '#ffffff',
  textColor: '#1e293b',
  linkColor: '#2563eb',
  fontFamily: 'sans',
};

export const emptyDesign = (): EmailDesign => ({
  version: EMAIL_DESIGN_VERSION,
  settings: { ...DEFAULT_DESIGN_SETTINGS },
  rows: [],
});

/** Link ảnh: chỉ `https://`, không biến — `validateLinks` chỉ xem `href`, `src` sai sẽ lọt qua xuất bản. */
const IMAGE_SRC_RE = /^https:\/\/[^\s"'<>{}]+$/i;

/** Kiểm lúc LƯU / XEM TRƯỚC (không phải lúc xuất bản): giới hạn kích thước + link ảnh. Rỗng = hợp lệ. */
export function checkDesign(design: EmailDesign): Issue[] {
  const issues: Issue[] = [];
  if (JSON.stringify(design).length > DESIGN_LIMITS.jsonChars) {
    issues.push(issue('DESIGN_TOO_LARGE', `design must be at most ${DESIGN_LIMITS.jsonChars} characters of JSON`, 'design'));
  }
  if (design.rows.length > DESIGN_LIMITS.rows) {
    issues.push(issue('DESIGN_TOO_MANY_ROWS', `design must have at most ${DESIGN_LIMITS.rows} rows`, 'design.rows'));
  }
  let blocks = 0;
  design.rows.forEach((row, r) => {
    if (row.columns.length < 1 || row.columns.length > DESIGN_LIMITS.columnsPerRow) {
      issues.push(issue('DESIGN_INVALID_COLUMNS', `a row must have 1 to ${DESIGN_LIMITS.columnsPerRow} columns`, `design.rows.${r}.columns`));
    }
    row.columns.forEach((column, c) => {
      column.blocks.forEach((block, b) => {
        blocks += 1;
        if (block.type === 'image' && block.src.trim() !== '' && !IMAGE_SRC_RE.test(block.src.trim())) {
          issues.push(
            issue(
              'IMAGE_URL_NOT_ALLOWED',
              'image source must be an https:// URL without variables',
              `design.rows.${r}.columns.${c}.blocks.${b}.src`,
            ),
          );
        }
      });
    });
  });
  if (blocks > DESIGN_LIMITS.blocks) {
    issues.push(issue('DESIGN_TOO_MANY_BLOCKS', `design must have at most ${DESIGN_LIMITS.blocks} blocks`, 'design.rows'));
  }
  return issues;
}

/**
 * Nội dung người soạn gửi khi lưu nháp — kiểu `visual` có `html` (trình duyệt sinh) nhưng không có `text`
 * (backend sinh từ HTML đã kiểm).
 */
export type DraftInput =
  | { editor: 'html'; subject: string; html: string; text: string; schema: readonly VariableSpec[] }
  | { editor: 'visual'; subject: string; html: string; design: VisualDesign; schema: readonly VariableSpec[] };

/**
 * Tiêu đề thư là một dòng chữ thường: dấu cách không ngắt (U+00A0 — ô `contenteditable` của trình duyệt chèn
 * quanh chip biến) đổi thành dấu cách thường. Chỉ đổi đúng ký tự đó, không gộp / cắt dấu cách người soạn gõ.
 */
export function normalizeSubject(subject: string): string {
  return subject.replace(/\u00a0/g, ' ');
}

/**
 * Đổi nội dung nháp thành `TemplateContent`; kiểu `visual` kiểm an toàn HTML + cỡ dự án, chuẩn hoá biến rồi
 * sinh `text` (ADR-0036).
 */
export function draftContent(raw: DraftInput): TemplateContent {
  const input = { ...raw, subject: normalizeSubject(raw.subject) };
  if (input.editor === 'html') {
    return { editor: 'html', design: null, subject: input.subject, html: input.html, text: input.text, schema: input.schema };
  }
  const issues = [...checkVisualDesign(input.design), ...checkEmailHtml(input.html)];
  if (issues.length) throw new ValidationError(issues);
  const html = normalizeLiquid(input.html);
  return { editor: 'visual', design: input.design, subject: input.subject, html, text: emailHtmlToText(html), schema: input.schema };
}


// ---------------------------------------------------------------- sinh HTML

const FONT_STACKS: Readonly<Record<DesignFont, string>> = {
  sans: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
  serif: "Georgia, 'Times New Roman', Times, serif",
  mono: "'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace",
};
const HEADING_SIZES = { 1: 28, 2: 22, 3: 18 } as const;
/** Lề trái / phải của một hàng và của một cột, px. */
const ROW_PADDING = 16;
const COLUMN_PADDING = 8;

const HTML_ESCAPES: Readonly<Record<string, string>> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch] ?? ch);

/**
 * Escape chữ người soạn nhưng giữ `{{ … }}` để đổ lúc gửi. Biến có `<` / `>` (vd default lạ) thì escape
 * luôn — không để thẻ thô lọt vào HTML trước khi đổ. Trong thuộc tính, `"` của biến đổi thành `'`
 * (`| default: "x"` -> `'x'`, `parseVariables` hiểu như nhau) để không vỡ thuộc tính.
 */
export function escapeKeepingVariables(value: string, inAttribute = false): string {
  let out = '';
  let last = 0;
  for (const match of value.matchAll(VARIABLE_RE)) {
    const token = match[0];
    out += escapeHtml(value.slice(last, match.index));
    if (/[<>]/.test(token)) out += escapeHtml(token);
    else out += inAttribute ? token.replace(/"/g, "'") : token;
    last = match.index + token.length;
  }
  return out + escapeHtml(value.slice(last));
}

const INLINE_RE = /\*\*([^*\n]+)\*\*|\[([^\]\n]+)\]\(([^)\n]+)\)/g;

/** Đoạn chữ: `**đậm**`, `[chữ](link)`, xuống dòng = `<br>`. Phần còn lại escape. Dùng chung với `designToMjml`. */
export function inlineHtml(text: string, linkColor: string): string {
  let out = '';
  let last = 0;
  for (const match of text.matchAll(INLINE_RE)) {
    out += escapeKeepingVariables(text.slice(last, match.index));
    if (match[1] !== undefined) {
      out += `<strong>${escapeKeepingVariables(match[1])}</strong>`;
    } else {
      const href = escapeKeepingVariables((match[3] ?? '').trim(), true);
      out += `<a href="${href}" style="color:${linkColor};text-decoration:underline;">${escapeKeepingVariables(match[2] ?? '')}</a>`;
    }
    last = match.index + match[0].length;
  }
  out += escapeKeepingVariables(text.slice(last));
  return out.replace(/\r?\n/g, '<br>');
}

const presentation = 'role="presentation" cellpadding="0" cellspacing="0" border="0"';

function blockHtml(block: DesignBlock, ctx: { settings: DesignSettings; font: string; columnWidth: number }): string {
  const { settings, font } = ctx;
  const cell = (align: DesignAlign, inner: string) =>
    `<table ${presentation} width="100%"><tr><td align="${align}" style="padding:8px 0;text-align:${align};">${inner}</td></tr></table>`;
  switch (block.type) {
    case 'heading': {
      const size = HEADING_SIZES[block.level];
      const color = block.color ?? settings.textColor;
      return cell(
        block.align,
        `<h${block.level} style="margin:0;font-family:${font};font-size:${size}px;line-height:1.25;font-weight:700;color:${color};">${escapeKeepingVariables(block.text).replace(/\r?\n/g, '<br>')}</h${block.level}>`,
      );
    }
    case 'text': {
      const color = block.color ?? settings.textColor;
      return cell(
        block.align,
        `<p style="margin:0;font-family:${font};font-size:16px;line-height:1.6;color:${color};">${inlineHtml(block.text, settings.linkColor)}</p>`,
      );
    }
    case 'button':
      return cell(
        block.align,
        `<table ${presentation} align="${block.align}" style="margin:${block.align === 'center' ? '0 auto' : '0'};"><tr>` +
          `<td bgcolor="${block.backgroundColor}" style="border-radius:${block.borderRadius}px;background-color:${block.backgroundColor};">` +
          `<a href="${escapeKeepingVariables(block.url.trim(), true)}" style="display:inline-block;padding:12px 24px;font-family:${font};font-size:16px;font-weight:600;line-height:1.2;color:${block.textColor};text-decoration:none;border-radius:${block.borderRadius}px;">${escapeKeepingVariables(block.label)}</a>` +
          `</td></tr></table>`,
      );
    case 'image': {
      const src = block.src.trim();
      if (!src) return '';
      const px = Math.max(1, Math.round((ctx.columnWidth * block.width) / 100));
      const margin = block.align === 'center' ? '0 auto' : block.align === 'right' ? '0 0 0 auto' : '0';
      const img = `<img src="${escapeHtml(src)}" alt="${escapeKeepingVariables(block.alt, true)}" width="${px}" style="display:block;width:${px}px;max-width:100%;height:auto;margin:${margin};border:0;outline:none;text-decoration:none;">`;
      const link = block.link.trim();
      return cell(block.align, link ? `<a href="${escapeKeepingVariables(link, true)}" style="text-decoration:none;">${img}</a>` : img);
    }
    case 'divider':
      return `<table ${presentation} width="100%"><tr><td style="padding:8px 0;"><table ${presentation} width="100%"><tr><td style="border-top:${block.thickness}px solid ${block.color};font-size:1px;line-height:1px;">&nbsp;</td></tr></table></td></tr></table>`;
    case 'spacer':
      return `<div style="height:${block.height}px;line-height:${block.height}px;font-size:1px;">&nbsp;</div>`;
    case 'html':
      return block.html;
  }
}

/** Thiết kế -> `{ html, text }`. Không có hàng nào -> cả hai rỗng (xuất bản báo `HTML_REQUIRED`). */
export function renderDesign(design: EmailDesign): { html: string; text: string } {
  if (design.rows.length === 0) return { html: '', text: '' };
  const { settings } = design;
  const font = FONT_STACKS[settings.fontFamily];
  const inner = settings.width - ROW_PADDING * 2;

  const rows = design.rows
    .map((row) => {
      const n = Math.max(1, row.columns.length);
      const colWidth = Math.floor(inner / n);
      const columns = row.columns
        .map(
          (column) =>
            `<!--[if mso]><td width="${colWidth}" valign="top"><![endif]-->` +
            `<div style="display:inline-block;width:100%;max-width:${colWidth}px;vertical-align:top;">` +
            `<table ${presentation} width="100%"><tr><td style="padding:0 ${COLUMN_PADDING}px;text-align:left;font-family:${font};font-size:16px;line-height:1.6;color:${settings.textColor};">` +
            column.blocks.map((b) => `\n${blockHtml(b, { settings, font, columnWidth: colWidth - COLUMN_PADDING * 2 })}`).join('') +
            `\n</td></tr></table></div>` +
            `<!--[if mso]></td><![endif]-->`,
        )
        .join('\n');
      const bg = row.backgroundColor ?? settings.contentBackgroundColor;
      return (
        `<tr><td align="center" style="padding:12px ${ROW_PADDING}px;background-color:${bg};font-size:0;text-align:center;">` +
        `<!--[if mso]><table ${presentation} width="100%"><tr><![endif]-->${columns}<!--[if mso]></tr></table><![endif]-->` +
        `</td></tr>`
      );
    })
    .join('\n');

  // Xuống dòng giữa hàng / khối: sau "Chuyển sang HTML" người soạn còn đọc và sửa được.
  const html =
    `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<meta name="x-apple-disable-message-reformatting"><title></title></head>` +
    `\n<body style="margin:0;padding:0;background-color:${settings.backgroundColor};">\n` +
    `<table ${presentation} width="100%" style="background-color:${settings.backgroundColor};"><tr><td align="center" style="padding:24px 12px;">` +
    `<!--[if mso]><table ${presentation} width="${settings.width}"><tr><td><![endif]-->` +
    `<table ${presentation} width="100%" style="max-width:${settings.width}px;background-color:${settings.contentBackgroundColor};font-family:${font};color:${settings.textColor};">\n${rows}\n</table>` +
    `<!--[if mso]></td></tr></table><![endif]-->` +
    `</td></tr></table>\n</body></html>\n`;

  return { html, text: designText(design) };
}

// ---------------------------------------------------------------- bản chữ thường

function blockText(block: DesignBlock): string {
  switch (block.type) {
    case 'heading':
      return block.text.trim();
    case 'text':
      return block.text
        .replace(INLINE_RE, (_m, bold: string | undefined, label: string | undefined, url: string | undefined) =>
          bold !== undefined ? bold : `${label ?? ''} (${(url ?? '').trim()})`,
        )
        .trim();
    case 'button': {
      const url = block.url.trim();
      return url ? `${block.label.trim()}: ${url}` : block.label.trim();
    }
    case 'image': {
      const link = block.link.trim();
      if (!link || !block.src.trim()) return '';
      return block.alt.trim() ? `${block.alt.trim()}: ${link}` : link;
    }
    case 'divider':
      return '----------';
    case 'spacer':
      return '';
    case 'html':
      return htmlToText(block.html);
  }
}

/** HTML tự viết -> chữ: bỏ style / script / comment, xuống dòng ở thẻ khối, bỏ mọi thẻ, giải vài entity. */
function htmlToText(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(style|script|head)[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6]|table)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function designText(design: EmailDesign): string {
  return design.rows
    .flatMap((row) => row.columns.flatMap((column) => column.blocks.map(blockText)))
    .filter((part) => part !== '')
    .join('\n\n');
}
