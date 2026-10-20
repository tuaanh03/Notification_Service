import type { TemplateId } from '../../../../shared/kernel/index.ts';
import type { IncomingHookRepository } from '../ports/index.ts';

/** Số incoming hook (mọi app) trỏ tới một template — query công khai cho lệnh dọn template của admin-cli (ADR-0037). */
export class CountHooksByTemplate {
  private readonly deps: { hooks: IncomingHookRepository };

  constructor(deps: CountHooksByTemplate['deps']) {
    this.deps = deps;
  }

  execute(templateId: TemplateId): Promise<number> {
    return this.deps.hooks.countByTemplate(templateId);
  }
}
