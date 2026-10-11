import { ValidationError, type AppId, type Issue } from '../../../../shared/kernel/index.ts';
import { validateHookConfig, type IncomingHookConfig } from '../../domain/entities/incoming-hook.ts';
import { conditionMet, extractPayload } from '../../domain/rules/index.ts';
import type { HookPreviewDto } from '../dto.ts';
import type { HookCrypto, IncomingSettings, TemplateCatalog, TopicCatalog } from '../ports/index.ts';
import { dedupeKeyOf } from './dedupe-key.ts';
import { assertTargetsBelongToApp } from './shared.ts';

/**
 * "Xem trước" trên console (ADR-0030 §7): chạy cấu hình (chưa cần lưu) trên một JSON mẫu — điều kiện,
 * khoá chống trùng, từng biến rút ra, thư sau khi đổ biến. KHÔNG ghi gì, KHÔNG gửi gì, không tính giới hạn.
 */
export class PreviewIncomingHook {
  private readonly deps: { crypto: HookCrypto; templates: TemplateCatalog; topics: TopicCatalog; settings: IncomingSettings };

  constructor(deps: PreviewIncomingHook['deps']) {
    this.deps = deps;
  }

  async execute(input: { appId: AppId; config: IncomingHookConfig; sample: unknown; idempotencyKey: string | null }): Promise<HookPreviewDto> {
    const { crypto, templates, settings } = this.deps;
    const config = validateHookConfig(input.config);
    await assertTargetsBelongToApp(this.deps, input.appId, config);
    const template = await templates.publishedVariables(input.appId, config.templateId);
    const variables = template?.variables ?? [];
    const extraction = extractPayload(input.sample, config.mappings, variables);
    const { dedupeWindowMinutes } = await settings.current();
    const dedupe = dedupeKeyOf(crypto, {
      hookId: 'preview',
      body: input.sample,
      header: input.idempotencyKey,
      dedupePath: config.dedupePath,
      at: new Date(0),
      windowMinutes: dedupeWindowMinutes,
    });

    let rendered: HookPreviewDto['rendered'] = null;
    let renderIssues: Issue[] = [];
    if (template?.status === 'published' && extraction.issues.length === 0) {
      try {
        rendered = await templates.render(input.appId, config.templateId, extraction.payload);
      } catch (err) {
        if (!(err instanceof ValidationError)) throw err;
        renderIssues = [...err.issues];
      }
    }
    return {
      conditionMet: conditionMet(input.sample, config.condition),
      dedupe: { source: dedupe.source, value: dedupe.value, windowMinutes: dedupeWindowMinutes },
      variables: extraction.variables,
      unusedMappings: extraction.unusedMappings,
      issues: extraction.issues,
      template: { name: template?.name ?? null, status: template?.status ?? null, version: template?.version ?? null },
      rendered,
      renderIssues,
    };
  }
}
