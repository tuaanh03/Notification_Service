import type { TemplateCategory } from '../../../../shared/kernel/index.ts';
import { TEMPLATE_PRESETS } from '../../domain/presets/index.ts';
import { renderDesign } from '../../domain/rules/email-design.ts';
import type { PresetLocale } from '../../domain/types/template-preset.ts';
import type { TemplatePresetDto } from '../dto.ts';

/**
 * Thư viện mẫu dựng sẵn (ADR-0035): đọc từ code, không chạm DB, không thuộc app nào. HTML sinh lúc gọi
 * bằng đúng `renderDesign` — mẫu ít và nhỏ, không cần đệm.
 */
export class TemplatePresetQueries {
  list(filter: { locale: PresetLocale; category?: TemplateCategory | undefined }): TemplatePresetDto[] {
    return TEMPLATE_PRESETS.filter((p) => filter.category === undefined || p.category === filter.category).map((p) => {
      const content = p.locales[filter.locale];
      return {
        id: p.id,
        version: p.version,
        category: p.category,
        locale: filter.locale,
        name: content.name,
        description: content.description,
        subject: content.subject,
        variables: [...content.schema],
        design: content.design,
        html: renderDesign(content.design).html,
      };
    });
  }
}
