import type { DesignBlock, DesignFont, DesignSettings, EmailDesign } from '../types/email-design.ts';
import { escapeKeepingVariables, inlineHtml } from './email-design.ts';

/**
 * Thiết kế kéo-thả (`EmailDesign`, ADR-0034) -> MJML cho bộ soạn trực quan (ADR-0036, UX-4 — ADR-0037).
 * Dùng cho thư viện mẫu: mẫu vẫn viết bằng `EmailDesign`, console nạp MJML này vào GrapesJS + grapesjs-mjml rồi
 * biên dịch ra HTML ở trình duyệt — backend KHÔNG có trình biên dịch MJML, chỉ kiểm HTML gửi lên như mọi lần lưu.
 *
 *   hàng -> `mj-section` (nền hàng, không có thì nền thư) · cột -> `mj-column` (rộng bằng nhau) ·
 *   heading / text -> `mj-text` · button -> `mj-button` · image -> `mj-image` · divider -> `mj-divider` ·
 *   spacer -> `mj-spacer` · html -> `mj-raw`.
 *
 * Màu / cỡ / căn lề / font đặt THẲNG trên từng khối (khung soạn của grapesjs-mjml không dựng `<mj-head>`, nên
 * thuộc tính ở head không hiện trên khung — như "Cài đặt thư" của console). Chữ người soạn được escape như
 * `renderDesign`; biến `{{ … }}` giữ nguyên, trong thuộc tính thì `"` của biến đổi thành `'` (MJML không thoát
 * `"` trong thuộc tính). Thiết kế không có hàng nào -> MJML một thư trống (vẫn hợp lệ).
 */

/** Font hệ thống — trùng `EMAIL_FONTS` của console (`components/templates/visual/email-settings.ts`), không font ngoài. */
export const MJML_FONT_STACKS: Readonly<Record<DesignFont, string>> = {
  sans: "Arial, 'Helvetica Neue', Helvetica, sans-serif",
  serif: "Georgia, 'Times New Roman', Times, serif",
  mono: "'Courier New', Courier, monospace",
};
const HEADING_SIZES = { 1: 28, 2: 22, 3: 18 } as const;
/** Lề như `renderDesign`: hàng 12px trên dưới, 16px hai bên; mỗi khối thêm 8px — chữ cách mép thư 24px. */
const SECTION_PADDING = '12px 16px';
const BLOCK_PADDING = '8px 8px';

/** Chữ trong thuộc tính: escape + giữ biến (nháy kép của biến thành nháy đơn). */
const attr = (value: string) => escapeKeepingVariables(value, true);

/** Một thẻ MJML; thuộc tính `undefined` thì bỏ. Thẻ luôn có thẻ đóng (bộ đọc của GrapesJS không hiểu `<… />`). */
function tag(name: string, attributes: Record<string, string | undefined>, content = ''): string {
  const attrs = Object.entries(attributes)
    .filter((entry): entry is [string, string] => entry[1] !== undefined)
    .map(([key, value]) => ` ${key}="${value}"`)
    .join('');
  return `<${name}${attrs}>${content}</${name}>`;
}

function blockMjml(block: DesignBlock, settings: DesignSettings, font: string, columnWidth: number): string {
  switch (block.type) {
    case 'heading':
      return tag(
        'mj-text',
        {
          align: block.align,
          color: block.color ?? settings.textColor,
          'font-family': font,
          'font-size': `${HEADING_SIZES[block.level]}px`,
          'font-weight': '700',
          'line-height': '1.25',
          padding: BLOCK_PADDING,
        },
        escapeKeepingVariables(block.text).replace(/\r?\n/g, '<br>'),
      );
    case 'text':
      return tag(
        'mj-text',
        {
          align: block.align,
          color: block.color ?? settings.textColor,
          'font-family': font,
          'font-size': '16px',
          'line-height': '1.6',
          padding: BLOCK_PADDING,
        },
        inlineHtml(block.text, settings.linkColor),
      );
    case 'button':
      return tag(
        'mj-button',
        {
          href: attr(block.url.trim()),
          align: block.align,
          'background-color': block.backgroundColor,
          color: block.textColor,
          'font-family': font,
          'font-size': '16px',
          'font-weight': '600',
          'line-height': '1.2',
          'border-radius': `${block.borderRadius}px`,
          'inner-padding': '12px 24px',
          padding: BLOCK_PADDING,
        },
        escapeKeepingVariables(block.label),
      );
    case 'image': {
      const src = block.src.trim();
      if (!src) return '';
      const link = block.link.trim();
      return tag('mj-image', {
        src: attr(src),
        alt: attr(block.alt),
        width: `${Math.max(1, Math.round((columnWidth * block.width) / 100))}px`,
        href: link ? attr(link) : undefined,
        align: block.align,
        padding: BLOCK_PADDING,
      });
    }
    case 'divider':
      return tag('mj-divider', {
        'border-width': `${block.thickness}px`,
        'border-style': 'solid',
        'border-color': block.color,
        padding: BLOCK_PADDING,
      });
    case 'spacer':
      return tag('mj-spacer', { height: `${block.height}px` });
    case 'html':
      return tag('mj-raw', {}, block.html);
  }
}

export function designToMjml(design: EmailDesign): string {
  const { settings } = design;
  const font = MJML_FONT_STACKS[settings.fontFamily];
  // Rộng chữ của một cột (px) — để đổi rộng ảnh từ % sang px như `renderDesign`.
  const inner = settings.width - 16 * 2;
  const sections = design.rows.map((row) => {
    const columnWidth = Math.floor(inner / Math.max(1, row.columns.length)) - 8 * 2;
    const columns = row.columns.map((column) =>
      tag('mj-column', {}, column.blocks.map((b) => blockMjml(b, settings, font, columnWidth)).join('')),
    );
    return tag(
      'mj-section',
      { 'background-color': row.backgroundColor ?? settings.contentBackgroundColor, padding: SECTION_PADDING },
      columns.join(''),
    );
  });
  // Xuống dòng giữa các hàng: MJML đọc được bằng mắt khi cần soát (cột `design.mjml`).
  return (
    `<mjml><mj-head><mj-attributes>${tag('mj-all', { 'font-family': font })}</mj-attributes></mj-head>\n` +
    `<mj-body width="${settings.width}px" background-color="${settings.backgroundColor}">\n` +
    sections.map((s) => `${s}\n`).join('') +
    `</mj-body></mjml>\n`
  );
}
