import type { TemplateFeatures } from '../ports/index.ts';

/**
 * Kiểu soạn nào đang mở cho người tạo template (ADR-0036) — console đọc để hiện / ẩn thẻ "Trực quan".
 * Cờ tắt chỉ ẩn lối TẠO MỚI; template trực quan đã có vẫn mở / sửa / xuất bản được.
 */
export class TemplateEditorOptions {
  private readonly deps: { features: TemplateFeatures };

  constructor(deps: TemplateEditorOptions['deps']) {
    this.deps = deps;
  }

  async execute(): Promise<{ visualEditor: boolean }> {
    return { visualEditor: await this.deps.features.visualEditorEnabled() };
  }
}
