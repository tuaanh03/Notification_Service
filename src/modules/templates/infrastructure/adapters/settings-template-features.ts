import type { SystemSettingsQueries } from '../../../settings/application/index.ts';
import type { TemplateFeatures } from '../../application/ports/index.ts';

/** templates -> settings (query công khai, đệm 30 giây): cờ bộ soạn trực quan (ADR-0036). */
export class SettingsTemplateFeatures implements TemplateFeatures {
  private readonly queries: SystemSettingsQueries;

  constructor(deps: { systemSettings: SystemSettingsQueries }) {
    this.queries = deps.systemSettings;
  }

  async visualEditorEnabled(): Promise<boolean> {
    return (await this.queries.current())['templates.visual_editor_enabled'];
  }
}
