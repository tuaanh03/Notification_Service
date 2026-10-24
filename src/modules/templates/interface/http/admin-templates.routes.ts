import { z } from 'zod';
import type { CommandContext } from '../../../../shared/application/index.ts';
import { access, adminCaller, adminContext, doc, EXTERNAL_ID, type HttpRoutes, LARGE_BODY_LIMIT_BYTES, parseInput } from '../../../../shared/http/index.ts';
import { AppId, TEMPLATE_CATEGORIES, TemplateId, VARIABLE_SOURCES } from '../../../../shared/kernel/index.ts';
import type {
  ArchiveTemplate,
  ComposeTemplateDraft,
  CreateTemplate,
  CreateTemplateFromPreset,
  DraftFromVersion,
  DuplicateTemplate,
  PublishVersion,
  RenderTemplate,
  SaveDraft,
  TemplatePresetQueries,
  TemplateQueries,
  UpdateTemplate,
} from '../../application/index.ts';
import { TEMPLATE_NAME_MAX_LENGTH } from '../../domain/entities/template.ts';
import type { DraftInput } from '../../domain/rules/email-design.ts';
import { PRESET_LOCALES } from '../../domain/types/template-preset.ts';
import { visualDesignSchema } from './visual-design.schema.ts';

const appParams = z.object({ appId: z.string().uuid() });
const templateParams = appParams.extend({ templateId: z.string().uuid() });
const versionParams = templateParams.extend({ version: z.coerce.number().int().min(1) });

const NAME = z.string().trim().min(1).max(TEMPLATE_NAME_MAX_LENGTH);
const CATEGORY = z.enum(TEMPLATE_CATEGORIES);

/** `?category=alert&q=canh bao` — cả hai tuỳ chọn; `q` rỗng = không lọc theo tên. */
const listQuery = z.object({ category: CATEGORY.optional(), q: z.string().trim().max(TEMPLATE_NAME_MAX_LENGTH).optional() });

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
/**
 * Nháp kiểu `html` (bỏ trống `editor` = như client cũ) hoặc `visual`. Kiểu `visual` nhận `html` do trình duyệt
 * sinh (backend kiểm, từ chối nếu không an toàn) nhưng KHÔNG nhận `text`: backend sinh từ HTML đã kiểm
 * (ADR-0036).
 */
const draftBody = z.union([
  z.object({ editor: z.literal('html').optional(), ...content }).strict(),
  z.object({ editor: z.literal('visual'), subject: content.subject, html: content.html, design: visualDesignSchema, variables: content.variables }).strict(),
]);
const createShared = {
  name: NAME,
  category: CATEGORY.optional(),
  subject: content.subject.optional(),
  variables: z.array(variable).max(100).optional(),
};
const createBody = z.union([
  z.object({ ...createShared, editor: z.literal('html').optional(), html: content.html.optional(), text: content.text.optional() }).strict(),
  // Trực quan: bỏ trống cả hai = thư trống (console dựng thư mẫu ban đầu); có thì phải đi cùng nhau.
  z
    .object({ ...createShared, editor: z.literal('visual'), html: content.html.optional(), design: visualDesignSchema.optional() })
    .strict()
    .refine((body) => (body.html === undefined) === (body.design === undefined), {
      message: 'html and design must be sent together',
      path: ['design'],
    }),
]);
const updateBody = z
  .object({ name: NAME.optional(), category: CATEGORY.optional() })
  .strict()
  .refine((body) => body.name !== undefined || body.category !== undefined, {
    message: 'name or category is required',
  });
/** Tên bắt buộc — console gửi tên đúng ngôn ngữ người soạn (vd "… (bản sao)" / "… (copy)"). */
const duplicateBody = z.object({ name: NAME }).strict();
/** Thư viện mẫu (ADR-0035): bỏ trống `locale` = tiếng Việt. */
const presetListQuery = z.object({ category: CATEGORY.optional(), locale: z.enum(PRESET_LOCALES).default('vi') });
/**
 * Tên bắt buộc như nhân bản — console gợi ý sẵn tên mẫu theo ngôn ngữ thư. `html` + `design` là MJML của mẫu
 * đã nạp vào GrapesJS và biên dịch ở trình duyệt (ADR-0037) — kiểm như lưu nháp trực quan.
 */
const fromPresetBody = z
  .object({ presetId: z.string().min(1).max(64), locale: z.enum(PRESET_LOCALES), name: NAME, html: content.html, design: visualDesignSchema })
  .strict();
/** Xem trước trên màn Soạn thông báo: payload như lúc gửi; `externalId` = người nhận đầu tiên (nếu đã chọn). */
const renderBody = z.object({ payload: z.record(z.string(), z.unknown()).default({}), externalId: EXTERNAL_ID.optional() }).strict();

/** "Nhờ AI soạn": trạng thái ĐANG SOẠN trên màn (có thể chưa lưu). Không có giá trị mẫu — không gửi ra ngoài. */
const aiComposeBody = z
  .object({
    instruction: z.string().trim().min(1).max(2000),
    mode: z.enum(['new', 'revise']),
    variables: z
      .array(z.object({ name: z.string().min(1).max(128), required: z.boolean(), description: z.string().max(500).optional() }).strict())
      .max(100)
      .default([]),
    current: z.object({ subject: z.string().max(500), html: z.string(), text: z.string().default('') }).strict().optional(),
  })
  .strict()
  .refine((body) => body.mode === 'new' || body.current !== undefined, {
    message: 'current is required when mode is revise',
    path: ['current'],
  });

function toDraft(body: z.infer<typeof draftBody>): DraftInput {
  if (body.editor === 'visual') return { editor: 'visual', subject: body.subject, html: body.html, design: body.design, schema: body.variables };
  return { editor: 'html', subject: body.subject, html: body.html, text: body.text, schema: body.variables };
}

function toCreateContent(body: z.infer<typeof createBody>) {
  if (body.editor === 'visual') return { design: body.design, content: { subject: body.subject, html: body.html, schema: body.variables } };
  return { content: { subject: body.subject, html: body.html, text: body.text, schema: body.variables } };
}

/**
 * `/admin/apps/:appId/templates` — admin soạn và xuất bản template. App service KHÔNG có đường ghi
 * template; nó chỉ gửi thư bằng `templateId` của bản đã xuất bản (ADR-0020).
 */
export function adminTemplatesRoutes(useCases: {
  createTemplate: CreateTemplate;
  createTemplateFromPreset: CreateTemplateFromPreset;
  updateTemplate: UpdateTemplate;
  duplicateTemplate: DuplicateTemplate;
  saveDraft: SaveDraft;
  draftFromVersion: DraftFromVersion;
  publishVersion: PublishVersion;
  archiveTemplate: ArchiveTemplate;
  composeTemplateDraft: ComposeTemplateDraft;
  renderTemplate: RenderTemplate;
  queries: TemplateQueries;
  presets: TemplatePresetQueries;
}): HttpRoutes {
  return (app) => {
    // Nguồn audit theo cách xác thực: phiên -> `admin_api`, PAT -> `admin_pat` (ADR-0044).
    const ctx = (request: Parameters<typeof adminCaller>[0]): CommandContext => adminContext(request);
    const ids = (params: { appId: string; templateId: string }) => ({
      appId: AppId.parse(params.appId),
      templateId: TemplateId.parse(params.templateId),
    });

    const tag = 'templates';
    const archived = { status: 409, code: 'TEMPLATE_ARCHIVED' } as const;
    const nameTaken = { status: 409, code: 'TEMPLATE_NAME_TAKEN' } as const;
    // Bộ kiểm HTML an toàn + cỡ dự án của kiểu `visual` (ADR-0036 / 0038) — cùng mã khi xuất bản kiểu `html`.
    const htmlIssues = [
      'HTML_TAG_NOT_ALLOWED',
      'HTML_ATTRIBUTE_NOT_ALLOWED',
      'HTML_URL_NOT_ALLOWED',
      'HTML_STYLE_NOT_ALLOWED',
      'IMAGE_URL_NOT_ALLOWED',
      'HTML_MALFORMED',
      'HTML_TOO_LARGE',
    ].map((code) => ({ status: 422, code }));
    const visualIssues = [...htmlIssues, { status: 422, code: 'DESIGN_TOO_LARGE' }];
    // Ví dụ một template kiểu `html` hai biến — dùng cho body mẫu của tạo + lưu nháp.
    const exampleVariables = [
      { name: 'vm_name', source: 'payload', required: true, description: 'VM name' },
      { name: 'cpu', source: 'payload', required: true, description: 'CPU load (%)' },
    ];

    app.post(
      '/apps/:appId/templates',
      {
        bodyLimit: LARGE_BODY_LIMIT_BYTES,
        config: {
          ...access('app.manage'),
          ...doc({
            tag,
            summary: 'Create a template with draft v1 (editor `html` by default, or `visual`).',
            description:
              'The draft is not checked against the publish rules until you publish. `visual`: send `html` and `design` together, or neither for an empty email; the HTML is checked for safety now. Names are unique per app (case- and accent-insensitive).',
            params: appParams,
            body: createBody,
            example: {
              name: 'VM alert',
              category: 'alert',
              subject: 'VM {{ payload.vm_name }} is overloaded',
              html: '<p>CPU at {{ payload.cpu }}%.</p>',
              variables: exampleVariables,
            },
            status: 201,
            responseDto: 'TemplateDetailDto',
            errors: [nameTaken, ...visualIssues],
          }),
        },
      },
      async (request, reply) => {
        const { appId } = parseInput(appParams, request.params);
        const body = parseInput(createBody, request.body);
        const created = await useCases.createTemplate.execute(
          {
            appId: AppId.parse(appId),
            name: body.name,
            category: body.category,
            editor: body.editor,
            ...toCreateContent(body),
          },
          ctx(request),
        );
        return reply.status(201).send(created);
      },
    );

    // Thư viện mẫu không thuộc app / org nào — ai đăng nhập console cũng xem được (ADR-0035).
    app.get(
      '/template-presets',
      {
        config: {
          ...access('catalog.read'),
          ...doc({ tag, summary: 'List the built-in template presets in one locale (not tied to any app).', query: presetListQuery, responseDto: 'TemplatePresetDto[]' }),
        },
      },
      async (request) => {
        const { category, locale } = parseInput(presetListQuery, request.query);
        return useCases.presets.list({ category, locale });
      },
    );

    // "Dùng mẫu": template MỚI của app, nháp v1 kiểu visual (HTML biên dịch ở trình duyệt) — quyền như lệnh tạo.
    app.post(
      '/apps/:appId/templates/from-preset',
      {
        bodyLimit: LARGE_BODY_LIMIT_BYTES,
        config: {
          ...access('app.manage'),
          ...doc({
            tag,
            summary: 'Create a new visual template from a preset.',
            description: '`html` + `design` are the preset MJML compiled by the console (GrapesJS + grapesjs-mjml); the HTML is checked like a visual draft save. The new template does not follow later preset changes.',
            params: appParams,
            body: fromPresetBody,
            status: 201,
            responseDto: 'TemplateDetailDto',
            errors: [{ status: 404, code: 'NOT_FOUND' }, nameTaken, ...visualIssues],
          }),
        },
      },
      async (request, reply) => {
        const { appId } = parseInput(appParams, request.params);
        const body = parseInput(fromPresetBody, request.body);
        const created = await useCases.createTemplateFromPreset.execute({ appId: AppId.parse(appId), ...body }, ctx(request));
        return reply.status(201).send(created);
      },
    );

    app.get(
      '/apps/:appId/templates',
      {
        config: {
          ...access('app.read'),
          ...doc({
            tag,
            summary: 'List templates of an app, optionally filtered by category and name.',
            description: '`q` matches part of the name, case- and accent-insensitive ("canh bao" finds "Cảnh báo").',
            params: appParams,
            query: listQuery,
            responseDto: 'TemplateSummaryDto[]',
          }),
        },
      },
      async (request) => {
        const { appId } = parseInput(appParams, request.params);
        const { category, q } = parseInput(listQuery, request.query);
        return useCases.queries.list(AppId.parse(appId), { category, search: q });
      },
    );

    // Đổ biến vào bản ĐANG XUẤT BẢN — đúng hàm lúc gửi dùng, nên xem trước thế nào thì thư đi thế ấy.
    // Không ghi gì. Lỗi template (MISSING_VARIABLE, TEMPLATE_NOT_PUBLISHED…) là 422 như lúc gửi.
    app.post(
      '/apps/:appId/templates/:templateId/render',
      {
        config: {
          ...access('app.read'),
          ...doc({
            tag,
            summary: 'Render the published version with a payload, exactly as a send would. Writes nothing.',
            description: 'Template errors are 422, the same as when sending. `externalId` fills `{{ user.external_id }}` (default `preview`).',
            params: templateParams,
            body: renderBody,
            example: { payload: { vm_name: 'ai-gateway', cpu: 92 }, externalId: 'NV-0123' },
            responseDto: 'RenderedTemplateDto',
            errors: ['TEMPLATE_NOT_FOUND', 'TEMPLATE_NOT_PUBLISHED', 'TEMPLATE_ARCHIVED', 'MISSING_VARIABLE', 'INVALID_PAYLOAD_VALUE', 'LINK_SCHEME_NOT_ALLOWED'].map((code) => ({ status: 422, code })),
          }),
        },
      },
      async (request) => {
        const params = ids(parseInput(templateParams, request.params));
        const { payload, externalId } = parseInput(renderBody, request.body ?? {});
        return useCases.renderTemplate.execute({ ...params, payload, externalId: externalId ?? 'preview' });
      },
    );

    app.get(
      '/apps/:appId/templates/:templateId',
      {
        config: {
          ...access('app.read'),
          ...doc({ tag, summary: 'Get a template with all its versions (newest first).', params: templateParams, responseDto: 'TemplateDetailDto' }),
        },
      },
      async (request) => {
        const { appId, templateId } = ids(parseInput(templateParams, request.params));
        return useCases.queries.get(appId, templateId);
      },
    );

    app.patch(
      '/apps/:appId/templates/:templateId',
      {
        config: {
          ...access('app.manage'),
          ...doc({
            tag,
            summary: 'Rename a template or change its category. Content is not touched.',
            params: templateParams,
            body: updateBody,
            responseDto: 'TemplateDetailDto',
            errors: [archived, nameTaken],
          }),
        },
      },
      async (request) => {
        const params = ids(parseInput(templateParams, request.params));
        const { name, category } = parseInput(updateBody, request.body);
        return useCases.updateTemplate.execute({ ...params, name, category }, ctx(request));
      },
    );

    // Bản sao là template MỚI (id mới) của cùng app — quyền như lệnh tạo.
    app.post(
      '/apps/:appId/templates/:templateId/duplicate',
      {
        config: {
          ...access('app.manage'),
          ...doc({
            tag,
            summary: 'Duplicate a template into a new one (new id, draft v1 only). Archived templates can be duplicated.',
            params: templateParams,
            body: duplicateBody,
            status: 201,
            responseDto: 'TemplateDetailDto',
            errors: [nameTaken],
          }),
        },
      },
      async (request, reply) => {
        const params = ids(parseInput(templateParams, request.params));
        const { name } = parseInput(duplicateBody, request.body);
        const created = await useCases.duplicateTemplate.execute({ ...params, name }, ctx(request));
        return reply.status(201).send(created);
      },
    );

    app.put(
      '/apps/:appId/templates/:templateId/draft',
      {
        bodyLimit: LARGE_BODY_LIMIT_BYTES,
        config: {
          ...access('app.manage'),
          ...doc({
            tag,
            summary: 'Save the draft (creates one if there is none). Does not publish.',
            description:
              'One draft per template. The editor type is fixed per version: saving a `visual` body onto an `html` draft is `EDITOR_MISMATCH`. `visual` sends `html` + `design`, never `text` (generated by EWS); its HTML is checked for safety now. Publish rules are checked only on publish.',
            params: templateParams,
            body: draftBody,
            example: {
              editor: 'html',
              subject: 'VM {{ payload.vm_name }} is overloaded',
              html: '<p>CPU at {{ payload.cpu }}%.</p>',
              text: 'CPU at {{ payload.cpu }}%.',
              variables: exampleVariables,
            },
            responseDto: 'TemplateDetailDto',
            errors: [archived, { status: 409, code: 'EDITOR_MISMATCH' }, ...visualIssues],
          }),
        },
      },
      async (request) => {
        const params = ids(parseInput(templateParams, request.params));
        const body = parseInput(draftBody, request.body);
        return useCases.saveDraft.execute({ ...params, draft: toDraft(body) }, ctx(request));
      },
    );

    app.post(
      '/apps/:appId/templates/:templateId/draft/from/:version',
      {
        config: {
          ...access('app.manage'),
          ...doc({
            tag,
            summary: 'Create a draft copied from an existing version (the way to roll back: then publish it).',
            params: versionParams,
            status: 201,
            responseDto: 'TemplateDetailDto',
            errors: [archived, { status: 409, code: 'DRAFT_EXISTS' }],
          }),
        },
      },
      async (request, reply) => {
        const { version, ...rest } = parseInput(versionParams, request.params);
        const created = await useCases.draftFromVersion.execute({ ...ids(rest), version }, ctx(request));
        return reply.status(201).send(created);
      },
    );

    app.post(
      '/apps/:appId/templates/:templateId/publish',
      {
        config: {
          ...access('app.manage'),
          ...doc({
            tag,
            summary: 'Publish the draft stored on the server. It replaces the published version for every later send.',
            description:
              'Publishes what was last SAVED — save the draft first. 422 lists every violation in `issues[]` (code + path). Adding a required variable means every app send without it fails with `MISSING_VARIABLE`. `html` templates also go through the HTML safety check when `templates.html_check_enabled` is on.',
            params: templateParams,
            responseDto: 'TemplateDetailDto',
            errors: [
              archived,
              { status: 409, code: 'NO_DRAFT' },
              ...[
                'SUBJECT_REQUIRED',
                'HTML_REQUIRED',
                'VARIABLE_NOT_IN_SCHEMA',
                'VARIABLE_MISSING_SOURCE',
                'OPTIONAL_VARIABLE_WITHOUT_DEFAULT',
                'INVALID_VARIABLE_NAME',
                'DUPLICATE_VARIABLE',
                'USER_VARIABLE_NOT_SUPPORTED',
                'LINK_SCHEME_NOT_ALLOWED',
                'VERSION_SUPERSEDED',
              ].map((code) => ({ status: 422, code })),
              ...htmlIssues,
            ],
          }),
        },
      },
      async (request) => {
        const params = ids(parseInput(templateParams, request.params));
        return useCases.publishVersion.execute(params, ctx(request));
      },
    );

    // Trả ĐỀ XUẤT của AI, không ghi gì (ADR-0020 §7). Có thể mất vài chục giây — chờ nhà cung cấp.
    app.post(
      '/apps/:appId/templates/:templateId/ai-compose',
      {
        bodyLimit: LARGE_BODY_LIMIT_BYTES,
        config: {
          ...access('app.manage'),
          ...doc({
            tag,
            summary: 'Ask AI for a subject + HTML suggestion. Writes nothing; can take up to ~60 s.',
            description:
              '`mode: revise` needs `current` (what is being edited, may be unsaved). Sample values are never sent to the AI. The answer carries its own publish-rule `issues` and `suggestedVariables` the AI used but you did not declare.',
            params: templateParams,
            body: aiComposeBody,
            responseDto: 'AiComposeResultDto',
            errors: [
              archived,
              { status: 429, code: 'AI_RATE_LIMITED' },
              { status: 502, code: 'AI_PROVIDER_ERROR' },
              { status: 503, code: 'AI_NOT_CONFIGURED' },
            ],
          }),
        },
      },
      async (request) => {
        const params = ids(parseInput(templateParams, request.params));
        const body = parseInput(aiComposeBody, request.body);
        return useCases.composeTemplateDraft.execute({ ...params, ...body }, ctx(request));
      },
    );

    app.post(
      '/apps/:appId/templates/:templateId/archive',
      {
        config: {
          ...access('app.manage'),
          ...doc({
            tag,
            summary: 'Archive a template. No way back: sends using it fail with `TEMPLATE_ARCHIVED`.',
            description: 'Archiving twice is a no-op. An archived template can still be read and duplicated.',
            params: templateParams,
            responseDto: 'TemplateDetailDto',
          }),
        },
      },
      async (request) => {
        const params = ids(parseInput(templateParams, request.params));
        return useCases.archiveTemplate.execute(params, ctx(request));
      },
    );
  };
}
