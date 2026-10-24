import { NotFoundError, UpstreamError, ValidationError, type AppId, type IncomingHookId } from '../../../../shared/kernel/index.ts';
import type { IncomingHook, IncomingHookConfig } from '../../domain/entities/incoming-hook.ts';
import {
  effectiveTrigger,
  integrationCondition,
  integrationMappings,
  requireIntegration,
  type AlertTrigger,
} from '../../domain/rules/integrations.ts';
import type { PublishCondition, VariableMapping } from '../../domain/types/hook-config.ts';
import type { HookCrypto, IncomingHookRepository, TemplateCatalog, TopicCatalog } from '../ports/index.ts';

/** Thiếu `WEBHOOK_SIGNING_KEY`: không tính được token -> không tạo / đổi / lấy URL được (cùng mã với outgoing). */
export function requireConfigured(crypto: HookCrypto): void {
  if (!crypto.configured) throw new UpstreamError('WEBHOOK_NOT_CONFIGURED', 'webhooks are not configured on this server', 503);
}

/** Hook của app khác -> 404, như không tồn tại. */
export async function requireHook(hooks: IncomingHookRepository, appId: AppId, id: IncomingHookId): Promise<IncomingHook> {
  const hook = await hooks.findById(id);
  if (!hook || hook.appId !== appId) throw new NotFoundError('incoming webhook', id);
  return hook;
}

/** Topic và template phải thuộc CHÍNH app này. Chưa xuất bản vẫn lưu được — console cảnh báo. */
export async function assertTargetsBelongToApp(
  deps: { topics: TopicCatalog; templates: TemplateCatalog },
  appId: AppId,
  config: Pick<IncomingHookConfig, 'topicId' | 'templateId'>,
): Promise<void> {
  const topics = await deps.topics.topicsOf(appId);
  if (!topics.some((t) => t.topicId === config.topicId)) {
    throw ValidationError.of('TOPIC_NOT_FOUND', `topic ${config.topicId} does not exist in this app`, 'topicId');
  }
  if (!(await deps.templates.publishedVariables(appId, config.templateId))) {
    throw ValidationError.of('TEMPLATE_NOT_FOUND', `template ${config.templateId} does not exist in this app`, 'templateId');
  }
}

export function hookUrl(publicBaseUrl: string | null, token: string): { path: string; url: string | null } {
  const path = `/hooks/${token}`;
  return { path, url: publicBaseUrl === null ? null : `${publicBaseUrl}${path}` };
}

/**
 * Cấu hình như route nhận (ADR-0046): `mappings` / `condition` để trống (`undefined`) = không gửi;
 * `integration` là chuỗi chưa kiểm (lạ -> 422 INTEGRATION_UNKNOWN).
 */
export interface IncomingHookInput {
  name: string;
  topicId: IncomingHookConfig['topicId'];
  templateId: IncomingHookConfig['templateId'];
  mappings?: readonly VariableMapping[] | undefined;
  dedupePath: string | null;
  condition?: PublishCondition | null | undefined;
  integration?: string | null | undefined;
  trigger?: AlertTrigger | null | undefined;
}

/**
 * Có `integration` mà không gửi `mappings` -> tự dựng = danh mục ∩ biến của bản template ĐANG XUẤT BẢN; không gửi
 * `condition` -> dựng từ `trigger`. Gửi tường minh thì dùng đúng cái đã gửi (ca đặc biệt qua API). Lưu lại hook
 * (kể cả đổi template) là dựng lại theo template hiện tại. Template chưa có bản xuất bản (vừa tạo từ mẫu) -> lấy
 * cả danh mục: biến template không khai bị bỏ qua lúc nhận, nên xuất bản xong là chạy, không phải lưu lại hook.
 */
export async function resolveHookConfig(templates: TemplateCatalog, appId: AppId, input: IncomingHookInput): Promise<IncomingHookConfig> {
  const base = { name: input.name, topicId: input.topicId, templateId: input.templateId, dedupePath: input.dedupePath };
  if (input.integration === null || input.integration === undefined) {
    return { ...base, mappings: input.mappings ?? [], condition: input.condition ?? null, integration: null, trigger: null };
  }
  const integration = requireIntegration(input.integration);
  const trigger = effectiveTrigger(integration, input.trigger ?? null);
  let mappings = input.mappings;
  if (mappings === undefined) {
    const template = await templates.publishedVariables(appId, input.templateId);
    const variables =
      template?.status === 'published'
        ? template.variables
        : integration.fields.map((f) => ({ name: `payload.${f.variable}`, required: false }));
    mappings = integrationMappings(integration, variables);
  }
  const condition = input.condition !== undefined ? input.condition : integrationCondition(integration, trigger);
  return { ...base, mappings, condition, integration: integration.id, trigger };
}
