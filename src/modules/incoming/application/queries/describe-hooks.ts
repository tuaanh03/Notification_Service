import type { AppId } from '../../../../shared/kernel/index.ts';
import type { IncomingHook } from '../../domain/entities/incoming-hook.ts';
import { findIntegration, integrationSetupBody } from '../../domain/rules/integrations.ts';
import { toIncomingHookDto, type HookWarningDto, type IncomingHookDto } from '../dto.ts';
import type { TemplateCatalog, TemplateInfo, TopicCatalog } from '../ports/index.ts';

/**
 * Hook -> DTO kèm cảnh báo. Topic của app lấy MỘT lần; template tra theo từng template KHÁC NHAU của các
 * hook (tối đa 10 hook mỗi app nên tối đa 10 lần tra).
 */
export async function describeHooks(
  deps: { templates: TemplateCatalog; topics: TopicCatalog },
  appId: AppId,
  hooks: readonly IncomingHook[],
): Promise<IncomingHookDto[]> {
  if (hooks.length === 0) return [];
  const topics = new Map((await deps.topics.topicsOf(appId)).map((t) => [t.topicId as string, t]));
  const templateIds = [...new Set(hooks.map((h) => h.templateId))];
  const templates = new Map<string, TemplateInfo | null>(
    await Promise.all(templateIds.map(async (id) => [id, await deps.templates.publishedVariables(appId, id)] as const)),
  );
  return hooks.map((hook) => {
    const topic = topics.get(hook.topicId) ?? null;
    const template = templates.get(hook.templateId) ?? null;
    return toIncomingHookDto(hook, {
      topic,
      template: template ? { name: template.name, status: template.status, version: template.version } : null,
      warnings: warningsOf(hook, topic, template),
      setupBody: setupBodyOf(hook, template),
    });
  });
}

function warningsOf(hook: IncomingHook, topic: { status: string } | null, template: TemplateInfo | null): HookWarningDto[] {
  const warnings: HookWarningDto[] = [];
  if (!topic) warnings.push({ code: 'TOPIC_NOT_FOUND' });
  else if (topic.status !== 'active') warnings.push({ code: 'TOPIC_NOT_ACTIVE' });
  if (!template) return [...warnings, { code: 'TEMPLATE_NOT_FOUND' }];
  if (template.status === 'archived') return [...warnings, { code: 'TEMPLATE_ARCHIVED' }];
  if (template.status === 'unpublished') return [...warnings, { code: 'TEMPLATE_NOT_PUBLISHED' }];
  const integration = hook.integration === null ? null : findIntegration(hook.integration);
  const mapped = new Set(hook.mappings.map((m) => m.variable));
  // Công cụ `custom`: body mẫu (`setupBody`) đã có MỌI biến của template -> không cảnh báo "chưa ánh xạ".
  if (integration?.payload !== 'custom') {
    for (const v of template.variables) {
      if (v.required && v.name.startsWith('payload.') && !mapped.has(v.name)) {
        warnings.push({ code: 'REQUIRED_VARIABLE_UNMAPPED', variable: v.name });
      }
    }
  }
  const declared = new Set(template.variables.map((v) => v.name));
  // Ánh xạ tự dựng theo danh mục mà template không khai (dựng lúc template chưa xuất bản) — vô hại, không cảnh báo.
  const fromCatalog = new Set(integration?.fields.map((f) => `payload.${f.variable}`) ?? []);
  for (const m of hook.mappings) {
    if (!declared.has(m.variable) && !fromCatalog.has(m.variable)) warnings.push({ code: 'MAPPING_NOT_IN_TEMPLATE', variable: m.variable });
  }
  return warnings;
}

/** Body mẫu dựng LẠI mỗi lần đọc — theo đúng bản template đang xuất bản, không lưu (ADR-0046 §5). */
function setupBodyOf(hook: IncomingHook, template: TemplateInfo | null): Record<string, string> | null {
  const integration = hook.integration === null ? null : findIntegration(hook.integration);
  if (!integration) return null;
  return integrationSetupBody(integration, template?.variables ?? []);
}
