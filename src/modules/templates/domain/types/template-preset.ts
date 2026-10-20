import type { TemplateCategory } from '../../../../shared/kernel/index.ts';
import type { EmailDesign } from './email-design.ts';
import type { VariableSpec } from './template-variable.ts';

/** Ngôn ngữ của thư trong thư viện mẫu (ADR-0035) — mỗi mẫu có đủ cả hai. */
export const PRESET_LOCALES = ['vi', 'en'] as const;
export type PresetLocale = (typeof PRESET_LOCALES)[number];

/** Nội dung một mẫu ở một ngôn ngữ — chép nguyên vào nháp v1 khi "Dùng mẫu". */
export interface TemplatePresetContent {
  /** Tên gợi ý cho template mới; người soạn sửa được. */
  name: string;
  /** Một câu cho thẻ mẫu trên console. */
  description: string;
  subject: string;
  /** Thiết kế `EmailDesign` (ra MJML bằng `designToMjml` — ADR-0037), không có ảnh (chưa có chỗ lưu ảnh). */
  design: EmailDesign;
  schema: readonly VariableSpec[];
}

/**
 * Mẫu dựng sẵn — viết trong code, chỉ đọc. `id` cố định (kebab-case), `version` tăng khi sửa nội dung;
 * template đã tạo từ mẫu KHÔNG đổi theo.
 */
export interface TemplatePreset {
  id: string;
  version: number;
  category: TemplateCategory;
  locales: Readonly<Record<PresetLocale, TemplatePresetContent>>;
}
