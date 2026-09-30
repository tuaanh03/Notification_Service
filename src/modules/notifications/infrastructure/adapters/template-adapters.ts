import type { RenderTemplate, TemplateQueries } from '../../../templates/application/index.ts';
import type { AppId, TemplateId, TemplateVersionId } from '../../../../shared/kernel/index.ts';
import type {
  RenderedEmailTemplate,
  TemplateLabel,
  TemplateLabels,
  TemplateRenderer,
} from '../../application/ports/index.ts';

/** notifications -> templates (use case công khai `RenderTemplate`). */
export class TemplatesRenderer implements TemplateRenderer {
  private readonly renderTemplate: RenderTemplate;

  constructor(deps: { renderTemplate: RenderTemplate }) {
    this.renderTemplate = deps.renderTemplate;
  }

  render(input: {
    appId: AppId;
    templateId: TemplateId;
    payload: Readonly<Record<string, unknown>>;
    externalId: string;
  }): Promise<RenderedEmailTemplate> {
    return this.renderTemplate.execute(input);
  }
}

/** notifications -> templates (query công khai, theo lô). */
export class TemplatesLabels implements TemplateLabels {
  private readonly queries: TemplateQueries;

  constructor(deps: { templateQueries: TemplateQueries }) {
    this.queries = deps.templateQueries;
  }

  async labelsOf(versionIds: readonly TemplateVersionId[]): Promise<Map<TemplateVersionId, TemplateLabel>> {
    const labels = await this.queries.labelsOf(versionIds);
    return new Map(labels.map((l) => [l.templateVersionId, { templateId: l.templateId, name: l.name, version: l.version }]));
  }
}
