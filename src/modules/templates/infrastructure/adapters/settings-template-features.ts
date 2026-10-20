import type { SystemSettingsQueries } from '../../../settings/application/index.ts';
import type { TemplateFeatures } from '../../application/ports/index.ts';

/** templates -> settings (query công khai, đệm 30 giây): công tắc bộ kiểm HTML lúc xuất bản (ADR-0038). */
export class SettingsTemplateFeatures implements TemplateFeatures {
  private readonly queries: SystemSettingsQueries;

  constructor(deps: { systemSettings: SystemSettingsQueries }) {
    this.queries = deps.systemSettings;
  }

  async htmlCheckEnabled(): Promise<boolean> {
    return (await this.queries.current())['templates.html_check_enabled'];
  }
}
