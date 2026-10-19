import { DEFAULT_DESIGN_SETTINGS } from '../rules/email-design.ts';
import {
  EMAIL_DESIGN_VERSION,
  type DesignAlign,
  type DesignBlock,
  type EmailDesign,
  type HeadingBlock,
} from '../types/email-design.ts';
import type { VariableSpec } from '../types/template-variable.ts';

/**
 * Bộ dựng gọn cho thư viện mẫu (ADR-0035): mọi mẫu dùng chung một bảng màu trung tính và MỘT màu nhấn
 * cho nút, nên thư từ mẫu trông cùng một nhà. Không có khối ảnh / HTML tự viết.
 */
const ACCENT = DEFAULT_DESIGN_SETTINGS.linkColor;
const MUTED = '#64748b';
const LINE = '#e2e8f0';
/** Nền nhạt cho hàng số liệu. */
export const PANEL = '#f8fafc';

type NoId<T> = T extends unknown ? Omit<T, 'id'> : never;
export type PresetBlock = NoId<DesignBlock>;
/** Một hàng = 1–2 cột, mỗi cột là danh sách khối. */
export interface PresetRow {
  columns: PresetBlock[][];
  backgroundColor?: string | undefined;
}

export const heading = (text: string, level: HeadingBlock['level'] = 1, align: DesignAlign = 'left'): PresetBlock => ({
  type: 'heading',
  text,
  level,
  align,
});
export const text = (value: string, align: DesignAlign = 'left'): PresetBlock => ({ type: 'text', text: value, align });
/** Chữ phụ màu xám — ghi chú cuối thư, nhãn số liệu. */
export const note = (value: string, align: DesignAlign = 'left'): PresetBlock => ({ type: 'text', text: value, align, color: MUTED });
export const button = (label: string, url: string): PresetBlock => ({
  type: 'button',
  label,
  url,
  align: 'left',
  backgroundColor: ACCENT,
  textColor: '#ffffff',
  borderRadius: 6,
});
export const divider = (): PresetBlock => ({ type: 'divider', color: LINE, thickness: 1 });
export const spacer = (height = 8): PresetBlock => ({ type: 'spacer', height });

/** Hàng một cột. */
export const row = (...blocks: PresetBlock[]): PresetRow => ({ columns: [blocks] });

/** Ghép hàng thành thiết kế; id (`r1`, `r1c1`, `r1c1b1`…) sinh theo vị trí nên cố định giữa các lần chạy. */
export function presetDesign(...rows: PresetRow[]): EmailDesign {
  return {
    version: EMAIL_DESIGN_VERSION,
    settings: { ...DEFAULT_DESIGN_SETTINGS },
    rows: rows.map((r, ri) => ({
      id: `r${ri + 1}`,
      ...(r.backgroundColor === undefined ? {} : { backgroundColor: r.backgroundColor }),
      columns: r.columns.map((blocks, ci) => ({
        id: `r${ri + 1}c${ci + 1}`,
        blocks: blocks.map((b, bi) => ({ ...b, id: `r${ri + 1}c${ci + 1}b${bi + 1}` }) as DesignBlock),
      })),
    })),
  };
}

/** Biến `payload.<key>` bắt buộc: `[key, giá trị mẫu, mô tả]` — mẫu chỉ để xem trước trên console. */
export const variables = (...specs: readonly (readonly [key: string, sample: string, description: string])[]): VariableSpec[] =>
  specs.map(([key, sample, description]) => ({ name: `payload.${key}`, source: 'payload', required: true, sample, description }));
