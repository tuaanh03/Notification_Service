import type { TemplateCategory } from '../../../../shared/kernel/index.ts';
import { TEMPLATE_PRESETS } from '../../domain/presets/index.ts';
import { designToMjml } from '../../domain/rules/design-to-mjml.ts';
import { renderDesign } from '../../domain/rules/email-design.ts';
import type { PresetLocale } from '../../domain/types/template-preset.ts';
import type { TemplatePresetDto } from '../dto.ts';

/**
 * Thư viện mẫu dựng sẵn (ADR-0035): đọc từ code, không chạm DB, không thuộc app nào. Sinh lúc gọi — mẫu ít và
 * nhỏ, không cần đệm: `mjml` (`designToMjml`) là thứ console nạp vào bộ soạn trực quan khi "Dùng mẫu" (ADR-0037),
 * `html` (`renderDesign`) chỉ để làm ảnh thu nhỏ.
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
        mjml: designToMjml(content.design),
        html: renderDesign(content.design).html,
      };
    });
  }
}
