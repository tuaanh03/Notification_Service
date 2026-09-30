import type { AppQueries } from '../../modules/apps/application/index.ts';
import {
  ArchiveTemplate,
  ComposeTemplateDraft,
  CreateTemplate,
  DraftFromVersion,
  PublishVersion,
  RenameTemplate,
  RenderTemplate,
  SaveDraft,
  TemplateQueries,
  type TemplateAiWriter,
} from '../../modules/templates/application/index.ts';
import {
  AppsAppLookup,
  DisabledTemplateWriter,
  DrizzleTemplateRepository,
  OpenAiCompatibleTemplateWriter,
  RedisAiComposeRateLimiter,
} from '../../modules/templates/infrastructure/adapters/index.ts';
import { FixedWindowRateLimiter } from '../../shared/rate-limit/index.ts';
import { adminTemplatesRoutes } from '../../modules/templates/interface/index.ts';
import type { Container } from '../container.ts';
import type { ModuleDefinition } from '../module-definition.ts';

/**
 * Ghép module templates: admin soạn / xuất bản (ADR-0020). Hỏi apps qua adapter. Trả thêm hai use case
 * công khai cho notifications: `renderTemplate` (đổ biến lúc nhận gửi) và `templateQueries` (nhãn theo lô).
 */
export function templatesModule(
  container: Container,
  dependencies: { appQueries: AppQueries; aiWriter?: TemplateAiWriter | undefined },
): { definition: ModuleDefinition; renderTemplate: RenderTemplate; templateQueries: TemplateQueries } {
  const { uow, outbox, clock, logger } = container.ports;
  const { transactions } = container.infra;
  const templates = new DrizzleTemplateRepository({ transactions });
  const deps = { uow, outbox, clock, templates };
  const queries = new TemplateQueries({ templates });
  const composeTemplateDraft = new ComposeTemplateDraft({
    templates,
    writer: dependencies.aiWriter ?? selectAiWriter(container),
    limiter: new RedisAiComposeRateLimiter({
      limiter: new FixedWindowRateLimiter({
        redis: container.infra.redis.client,
        clock,
        sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      }),
      maxPerMinute: AI_COMPOSE_MAX_PER_MINUTE,
    }),
    clock,
    logger,
  });

  const definition: ModuleDefinition = {
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
          composeTemplateDraft,
          queries,
        }),
      ],
    },
  };
  return { definition, renderTemplate: new RenderTemplate({ templates }), templateQueries: queries };
}

/** Giới hạn gọi AI của MỘT admin — cố định trong code, không qua env (chống tốn tiền, không phải tinh chỉnh). */
const AI_COMPOSE_MAX_PER_MINUTE = 10;
/** Chờ nhà cung cấp AI tối đa 60 giây; console chờ lời gọi này lâu hơn một chút. */
const AI_TIMEOUT_MS = 60_000;

/** `AI_API_KEY` trống = AI tắt. Env đã bảo đảm có khoá thì có URL + model (fail-fast lúc khởi động). */
function selectAiWriter(container: Container): TemplateAiWriter {
  const { AI_API_URL, AI_API_KEY, AI_MODEL } = container.env;
  if (!AI_API_KEY || !AI_API_URL || !AI_MODEL) return new DisabledTemplateWriter();
  return new OpenAiCompatibleTemplateWriter({
    config: { url: AI_API_URL, apiKey: AI_API_KEY, model: AI_MODEL, timeoutMs: AI_TIMEOUT_MS },
  });
}
