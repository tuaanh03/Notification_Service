import type { CommandContext } from '../../../../shared/application/index.ts';
import { NotFoundError, type AppId } from '../../../../shared/kernel/index.ts';
import { findPreset } from '../../domain/presets/index.ts';
import type { PresetLocale } from '../../domain/types/template-preset.ts';
import type { VisualDesign } from '../../domain/types/visual-design.ts';
import type { TemplateDetailDto } from '../dto.ts';
import type { CreateTemplate } from './create-template.ts';

/**
 * "Dùng mẫu" (ADR-0035, đổi ở ADR-0037): chép một mẫu dựng sẵn thành template MỚI của app, kiểu `visual` — đi
 * đúng `CreateTemplate` (nhóm của mẫu, nháp v1 = tiêu đề + biến của mẫu ở ngôn ngữ đã chọn).
 *
 * Backend không có trình biên dịch MJML: console nạp MJML của mẫu (`designToMjml`, trả trong thư viện) vào
 * GrapesJS + grapesjs-mjml rồi gửi lên `html` + `design` (dự án + MJML) như một lần lưu nháp trực quan; HTML
 * qua đúng `checkEmailHtml` (422 nếu không an toàn), `text` backend sinh. Tiêu đề / biến / nhóm lấy từ mẫu ở
 * backend, không nhận từ client. Chép một lần: mẫu đổi về sau thì template này không đổi theo. Tên do người
 * gọi đặt, như nhân bản (ADR-0033).
 */
export class CreateTemplateFromPreset {
  private readonly deps: { createTemplate: CreateTemplate };

  constructor(deps: CreateTemplateFromPreset['deps']) {
    this.deps = deps;
  }

  async execute(
    input: { appId: AppId; presetId: string; locale: PresetLocale; name: string; html: string; design: VisualDesign },
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
        editor: 'visual',
        design: input.design,
        content: { subject: content.subject, html: input.html, schema: content.schema },
        createdFromPreset: { presetId: preset.id, presetVersion: preset.version, locale: input.locale },
      },
      ctx,
    );
  }
}
