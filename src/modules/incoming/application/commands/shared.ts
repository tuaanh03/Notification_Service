import { NotFoundError, ValidationError, type AppId, type IncomingHookId } from '../../../../shared/kernel/index.ts';
import type { IncomingHook, IncomingHookConfig } from '../../domain/entities/incoming-hook.ts';
import type { IncomingHookRepository, TemplateCatalog, TopicCatalog } from '../ports/index.ts';

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
