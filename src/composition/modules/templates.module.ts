import type { AppQueries } from '../../modules/apps/application/index.ts';
import {
  ArchiveTemplate,
  CreateTemplate,
  DraftFromVersion,
  PublishVersion,
  RenameTemplate,
  SaveDraft,
  TemplateQueries,
} from '../../modules/templates/application/index.ts';
import { AppsAppLookup, DrizzleTemplateRepository } from '../../modules/templates/infrastructure/adapters/index.ts';
import { adminTemplatesRoutes } from '../../modules/templates/interface/index.ts';
import type { Container } from '../container.ts';
import type { ModuleDefinition } from '../module-definition.ts';

/** Ghép module templates: admin soạn / xuất bản (ADR-0020). Hỏi apps qua adapter. */
export function templatesModule(container: Container, dependencies: { appQueries: AppQueries }): ModuleDefinition {
  const { uow, outbox, clock } = container.ports;
  const { transactions } = container.infra;
  const templates = new DrizzleTemplateRepository({ transactions });
  const deps = { uow, outbox, clock, templates };

  return {
    name: 'templates',
    http: {
      admin: [
        adminTemplatesRoutes({
          createTemplate: new CreateTemplate({ ...deps, apps: new AppsAppLookup(dependencies) }),
          renameTemplate: new RenameTemplate(deps),
          saveDraft: new SaveDraft(deps),
          draftFromVersion: new DraftFromVersion(deps),
          publishVersion: new PublishVersion(deps),
          archiveTemplate: new ArchiveTemplate(deps),
          queries: new TemplateQueries({ templates }),
        }),
      ],
    },
  };
}
