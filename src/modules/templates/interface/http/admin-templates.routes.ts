import { z } from 'zod';
import type { CommandContext } from '../../../../shared/application/index.ts';
import { adminCaller, LARGE_BODY_LIMIT_BYTES, parseInput, type HttpRoutes } from '../../../../shared/http/index.ts';
import { AppId, TemplateId, VARIABLE_SOURCES } from '../../../../shared/kernel/index.ts';
import type {
  ArchiveTemplate,
  CreateTemplate,
  DraftFromVersion,
  PublishVersion,
  RenameTemplate,
  SaveDraft,
  TemplateQueries,
} from '../../application/index.ts';
import { TEMPLATE_NAME_MAX_LENGTH } from '../../domain/entities/template.ts';
import type { TemplateContent } from '../../domain/entities/template-version.ts';

const appParams = z.object({ appId: z.string().uuid() });
const templateParams = appParams.extend({ templateId: z.string().uuid() });
const versionParams = templateParams.extend({ version: z.coerce.number().int().min(1) });

const NAME = z.string().trim().min(1).max(TEMPLATE_NAME_MAX_LENGTH);

/** Hình dạng một biến. Luật nội dung (nguồn, tên hợp lệ, dùng đúng chỗ) kiểm ở domain lúc xuất bản. */
const variable = z
  .object({
    name: z.string().min(1).max(128),
    source: z.enum(VARIABLE_SOURCES),
    required: z.boolean(),
    sample: z.string().max(1000).optional(),
    description: z.string().max(500).optional(),
  })
  .strict();

/** Giới hạn theo cột: subject VARCHAR(500); html/text MEDIUMTEXT nhưng body cả request ≤ 512 KB. */
const content = {
  subject: z.string().max(500),
  html: z.string(),
  text: z.string().default(''),
  variables: z.array(variable).max(100).default([]),
};
const draftBody = z.object(content).strict();
const createBody = z
  .object({
    name: NAME,
    subject: content.subject.optional(),
    html: content.html.optional(),
    text: content.text.optional(),
    variables: z.array(variable).max(100).optional(),
  })
  .strict();
const renameBody = z.object({ name: NAME }).strict();

const toContent = (body: z.infer<typeof draftBody>): TemplateContent => ({
  subject: body.subject,
  html: body.html,
  text: body.text,
  schema: body.variables,
});

/**
 * `/admin/apps/:appId/templates` — admin soạn và xuất bản template. App service KHÔNG có đường ghi
 * template; nó chỉ gửi thư bằng `templateId` của bản đã xuất bản (ADR-0020).
 */
export function adminTemplatesRoutes(useCases: {
  createTemplate: CreateTemplate;
  renameTemplate: RenameTemplate;
  saveDraft: SaveDraft;
  draftFromVersion: DraftFromVersion;
  publishVersion: PublishVersion;
  archiveTemplate: ArchiveTemplate;
  queries: TemplateQueries;
}): HttpRoutes {
  return (app) => {
    const ctx = (request: Parameters<typeof adminCaller>[0]): CommandContext => ({
      actor: { id: adminCaller(request).adminId, type: 'admin' },
      source: 'admin_api',
    });
    const ids = (params: { appId: string; templateId: string }) => ({
      appId: AppId.parse(params.appId),
      templateId: TemplateId.parse(params.templateId),
    });

    app.post('/apps/:appId/templates', { bodyLimit: LARGE_BODY_LIMIT_BYTES }, async (request, reply) => {
      const { appId } = parseInput(appParams, request.params);
      const { name, variables, ...rest } = parseInput(createBody, request.body);
      const created = await useCases.createTemplate.execute(
        { appId: AppId.parse(appId), name, content: { ...rest, schema: variables } },
        ctx(request),
      );
      return reply.status(201).send(created);
    });

    app.get('/apps/:appId/templates', async (request) => {
      const { appId } = parseInput(appParams, request.params);
      return useCases.queries.list(AppId.parse(appId));
    });

    app.get('/apps/:appId/templates/:templateId', async (request) => {
      const { appId, templateId } = ids(parseInput(templateParams, request.params));
      return useCases.queries.get(appId, templateId);
    });

    app.patch('/apps/:appId/templates/:templateId', async (request) => {
      const params = ids(parseInput(templateParams, request.params));
      const { name } = parseInput(renameBody, request.body);
      return useCases.renameTemplate.execute({ ...params, name }, ctx(request));
    });

    app.put('/apps/:appId/templates/:templateId/draft', { bodyLimit: LARGE_BODY_LIMIT_BYTES }, async (request) => {
      const params = ids(parseInput(templateParams, request.params));
      const body = parseInput(draftBody, request.body);
      return useCases.saveDraft.execute({ ...params, content: toContent(body) }, ctx(request));
    });

    app.post('/apps/:appId/templates/:templateId/draft/from/:version', async (request, reply) => {
      const { version, ...rest } = parseInput(versionParams, request.params);
      const created = await useCases.draftFromVersion.execute({ ...ids(rest), version }, ctx(request));
      return reply.status(201).send(created);
    });

    app.post('/apps/:appId/templates/:templateId/publish', async (request) => {
      const params = ids(parseInput(templateParams, request.params));
      return useCases.publishVersion.execute(params, ctx(request));
    });

    app.post('/apps/:appId/templates/:templateId/archive', async (request) => {
      const params = ids(parseInput(templateParams, request.params));
      return useCases.archiveTemplate.execute(params, ctx(request));
    });
  };
}
