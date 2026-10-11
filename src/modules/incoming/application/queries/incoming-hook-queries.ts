import type { AppId, IncomingHookId } from '../../../../shared/kernel/index.ts';
import { requireHook } from '../commands/shared.ts';
import { toIncomingCallDto, type IncomingCallDto, type IncomingHookListDto } from '../dto.ts';
import type { IncomingCallRepository, IncomingHookRepository, IncomingSettings, TemplateCatalog, TopicCatalog } from '../ports/index.ts';
import { describeHooks } from './describe-hooks.ts';

export const RECENT_CALLS_LIMIT = 50;

export class IncomingHookQueries {
  private readonly deps: {
    hooks: IncomingHookRepository;
    calls: IncomingCallRepository;
    templates: TemplateCatalog;
    topics: TopicCatalog;
    settings: IncomingSettings;
  };

  constructor(deps: IncomingHookQueries['deps']) {
    this.deps = deps;
  }

  async list(appId: AppId): Promise<IncomingHookListDto> {
    const [hooks, settings] = await Promise.all([this.deps.hooks.listByApp(appId), this.deps.settings.current()]);
    return { publicBaseUrl: settings.publicBaseUrl, hooks: await describeHooks(this.deps, appId, hooks) };
  }

  async calls(appId: AppId, hookId: IncomingHookId): Promise<IncomingCallDto[]> {
    const hook = await requireHook(this.deps.hooks, appId, hookId);
    return (await this.deps.calls.listRecent(hook.id, RECENT_CALLS_LIMIT)).map(toIncomingCallDto);
  }
}
