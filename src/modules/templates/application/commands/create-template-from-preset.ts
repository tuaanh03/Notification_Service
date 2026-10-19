import type { CommandContext } from '../../../../shared/application/index.ts';
import { NotFoundError, type AppId } from '../../../../shared/kernel/index.ts';
import { findPreset } from '../../domain/presets/index.ts';
import type { PresetLocale } from '../../domain/types/template-preset.ts';
import type { TemplateDetailDto } from '../dto.ts';
import type { CreateTemplate } from './create-template.ts';

/**
 * "Dùng mẫu" (ADR-0035): chép một mẫu dựng sẵn thành template MỚI của app — đi đúng `CreateTemplate`
 * (nhóm của mẫu, kiểu `blocks`, nháp v1 = thiết kế + tiêu đề + biến của mẫu). Chép một lần: mẫu đổi về
 * sau thì template này không đổi theo. Tên do người gọi đặt, như nhân bản (ADR-0033).
 */
export class CreateTemplateFromPreset {
  private readonly deps: { createTemplate: CreateTemplate };

  constructor(deps: CreateTemplateFromPreset['deps']) {
    this.deps = deps;
  }

  async execute(
    input: { appId: AppId; presetId: string; locale: PresetLocale; name: string },
    ctx: CommandContext,
  ): Promise<TemplateDetailDto> {
    const preset = findPreset(input.presetId);
    if (!preset) throw new NotFoundError('template preset', input.presetId);
    const content = preset.locales[input.locale];
    return this.deps.createTemplate.execute(
      {
        appId: input.appId,
        name: input.name,
        category: preset.category,
        editor: 'blocks',
        design: content.design,
        content: { subject: content.subject, schema: content.schema },
        createdFromPreset: { presetId: preset.id, presetVersion: preset.version, locale: input.locale },
      },
      ctx,
    );
  }
}
