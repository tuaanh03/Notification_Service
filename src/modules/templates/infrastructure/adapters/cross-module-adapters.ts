import type { AppQueries } from '../../../apps/application/index.ts';
import type { CountHooksByTemplate } from '../../../incoming/application/index.ts';
import type { CountTemplateUsage } from '../../../notifications/application/index.ts';
import { NotFoundError, type AppId, type TemplateId, type TemplateVersionId } from '../../../../shared/kernel/index.ts';
import type { AppLookup, TemplateReferences, TemplateUsageLookup } from '../../application/ports/index.ts';

/** templates -> apps (query công khai). */
export class AppsAppLookup implements AppLookup {
  private readonly queries: AppQueries;

  constructor(deps: { appQueries: AppQueries }) {
    this.queries = deps.appQueries;
  }

  async exists(appId: AppId): Promise<boolean> {
    try {
      await this.queries.get(appId);
      return true;
    } catch (err) {
      if (err instanceof NotFoundError) return false;
      throw err;
    }
  }
}

/** templates -> notifications + incoming (query công khai): template còn được dùng ở đâu — lệnh dọn (ADR-0037). */
export class ModulesTemplateUsageLookup implements TemplateUsageLookup {
  private readonly deps: { countTemplateUsage: CountTemplateUsage; countHooksByTemplate: CountHooksByTemplate };

  constructor(deps: ModulesTemplateUsageLookup['deps']) {
    this.deps = deps;
  }

  async referencesOf(templateId: TemplateId, versionIds: readonly TemplateVersionId[]): Promise<TemplateReferences> {
    const sent = await this.deps.countTemplateUsage.execute(versionIds);
    const incomingHooks = await this.deps.countHooksByTemplate.execute(templateId);
    return { ...sent, incomingHooks };
  }
}
