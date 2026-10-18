/**
 * Thiết kế kéo-thả của một template version (ADR-0034) — lưu ở `template_versions.design`.
 * Backend sinh `html` / `text` từ đây (`renderDesign`); cột `html` / `text` mới là nguồn gửi.
 *
 * `version` tăng khi đổi cấu trúc — hàm đọc phải nhận được mọi bản cũ còn trong DB.
 * Hình dạng (khối lạ, màu sai, số ngoài khoảng) kiểm bằng zod ở route; giới hạn kiểm ở `checkDesign`.
 */
export const EMAIL_DESIGN_VERSION = 1;

export const DESIGN_FONTS = ['sans', 'serif', 'mono'] as const;
export type DesignFont = (typeof DESIGN_FONTS)[number];

export const DESIGN_ALIGNS = ['left', 'center', 'right'] as const;
export type DesignAlign = (typeof DESIGN_ALIGNS)[number];

export const DESIGN_BLOCK_TYPES = ['heading', 'text', 'button', 'image', 'divider', 'spacer', 'html'] as const;
export type DesignBlockType = (typeof DESIGN_BLOCK_TYPES)[number];

/** Màu luôn `#rrggbb` — không có ô CSS tự do nên không nhét được thuộc tính lạ vào `style`. */
export type HexColor = string;

export interface DesignSettings {
  /** Rộng vùng thư, px (480–600). */
  width: number;
  backgroundColor: HexColor;
  contentBackgroundColor: HexColor;
  textColor: HexColor;
  linkColor: HexColor;
  fontFamily: DesignFont;
}

interface BlockBase {
  /** Khoá kéo-thả do console sinh; backend chỉ kiểm hình dạng. */
  id: string;
}

export interface HeadingBlock extends BlockBase {
  type: 'heading';
  text: string;
  level: 1 | 2 | 3;
  align: DesignAlign;
  color?: HexColor | undefined;
}

/** Chữ thường; trong chữ có `**đậm**` và `[chữ](link)`, xuống dòng thành `<br>`. */
export interface TextBlock extends BlockBase {
  type: 'text';
  text: string;
  align: DesignAlign;
  color?: HexColor | undefined;
}

export interface ButtonBlock extends BlockBase {
  type: 'button';
  label: string;
  url: string;
  align: DesignAlign;
  backgroundColor: HexColor;
  textColor: HexColor;
  /** px, 0–24. */
  borderRadius: number;
}

export interface ImageBlock extends BlockBase {
  type: 'image';
  /** Chỉ `https://` hoặc rỗng (chưa có ảnh) — kiểm lúc lưu (`IMAGE_URL_NOT_ALLOWED`). */
  src: string;
  alt: string;
  /** % rộng của cột, 10–100. */
  width: number;
  /** Link khi bấm ảnh; rỗng = không có. */
  link: string;
  align: DesignAlign;
}

export interface DividerBlock extends BlockBase {
  type: 'divider';
  color: HexColor;
  /** px, 1–8. */
  thickness: number;
}

export interface SpacerBlock extends BlockBase {
  type: 'spacer';
  /** px, 4–120. */
  height: number;
}

/** HTML tự viết — KHÔNG escape; luật nội dung vẫn bắt lúc xuất bản trên HTML đã sinh. */
export interface HtmlBlock extends BlockBase {
  type: 'html';
  html: string;
}

export type DesignBlock = HeadingBlock | TextBlock | ButtonBlock | ImageBlock | DividerBlock | SpacerBlock | HtmlBlock;

export interface DesignColumn {
  id: string;
  blocks: DesignBlock[];
}

export interface DesignRow {
  id: string;
  /** Không có = theo `contentBackgroundColor`. */
  backgroundColor?: HexColor | undefined;
  /** 1–3 cột, rộng bằng nhau; màn hẹp thì tự xếp chồng. */
  columns: DesignColumn[];
}

export interface EmailDesign {
  version: typeof EMAIL_DESIGN_VERSION;
  settings: DesignSettings;
  rows: DesignRow[];
}
