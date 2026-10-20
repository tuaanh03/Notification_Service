import { z } from 'zod';
import type { CommandContext } from '../../../../shared/application/index.ts';
import { access, adminCaller, EXTERNAL_ID, LARGE_BODY_LIMIT_BYTES, parseInput, type HttpRoutes } from '../../../../shared/http/index.ts';
import { AppId, TEMPLATE_CATEGORIES, TemplateId, VARIABLE_SOURCES } from '../../../../shared/kernel/index.ts';
import type {
  ArchiveTemplate,
  ComposeTemplateDraft,
  ConvertDraftToHtml,
  CreateTemplate,
  CreateTemplateFromPreset,
  DraftFromVersion,
  DuplicateTemplate,
  PreviewDesign,
  PublishVersion,
  RenderTemplate,
  SaveDraft,
  TemplatePresetQueries,
  TemplateQueries,
  UpdateTemplate,
} from '../../application/index.ts';
import { TEMPLATE_NAME_MAX_LENGTH } from '../../domain/entities/template.ts';
import { assertEditorSupported, type DraftInput } from '../../domain/rules/email-design.ts';
import { PRESET_LOCALES } from '../../domain/types/template-preset.ts';
import { emailDesignSchema } from './email-design.schema.ts';
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
 * (ADR-0036). Kiểu `blocks` đã ngừng -> 422 `EDITOR_NOT_SUPPORTED` (`rejectBlocks`, ADR-0037).
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
const designPreviewBody = z.object({ design: emailDesignSchema }).strict();
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

/**
 * Kiểu kéo-thả đã ngừng (ADR-0037): báo mã rõ ràng `EDITOR_NOT_SUPPORTED` thay vì lỗi hình dạng chung của zod.
 * Chạy TRƯỚC `parseInput`.
 */
function rejectBlocks(body: unknown): void {
  if (typeof body === 'object' && body !== null && (body as { editor?: unknown }).editor === 'blocks') assertEditorSupported('blocks');
}

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
  convertDraftToHtml: ConvertDraftToHtml;
  previewDesign: PreviewDesign;
  publishVersion: PublishVersion;
  archiveTemplate: ArchiveTemplate;
  composeTemplateDraft: ComposeTemplateDraft;
  renderTemplate: RenderTemplate;
  queries: TemplateQueries;
  presets: TemplatePresetQueries;
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

    app.post('/apps/:appId/templates', { bodyLimit: LARGE_BODY_LIMIT_BYTES, config: access('app.manage') }, async (request, reply) => {
      const { appId } = parseInput(appParams, request.params);
      rejectBlocks(request.body);
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
    });

    // Thư viện mẫu không thuộc app / org nào — ai đăng nhập console cũng xem được (ADR-0035).
    app.get('/template-presets', { config: access('catalog.read') }, async (request) => {
      const { category, locale } = parseInput(presetListQuery, request.query);
      return useCases.presets.list({ category, locale });
    });

    // "Dùng mẫu": template MỚI của app, nháp v1 kiểu visual (HTML biên dịch ở trình duyệt) — quyền như lệnh tạo.
    app.post('/apps/:appId/templates/from-preset', { bodyLimit: LARGE_BODY_LIMIT_BYTES, config: access('app.manage') }, async (request, reply) => {
      const { appId } = parseInput(appParams, request.params);
      const body = parseInput(fromPresetBody, request.body);
      const created = await useCases.createTemplateFromPreset.execute({ appId: AppId.parse(appId), ...body }, ctx(request));
      return reply.status(201).send(created);
    });

    app.get('/apps/:appId/templates', { config: access('app.read') }, async (request) => {
      const { appId } = parseInput(appParams, request.params);
      const { category, q } = parseInput(listQuery, request.query);
      return useCases.queries.list(AppId.parse(appId), { category, search: q });
    });

    // Đổ biến vào bản ĐANG XUẤT BẢN — đúng hàm lúc gửi dùng, nên xem trước thế nào thì thư đi thế ấy.
    // Không ghi gì. Lỗi template (MISSING_VARIABLE, TEMPLATE_NOT_PUBLISHED…) là 422 như lúc gửi.
    app.post('/apps/:appId/templates/:templateId/render', { config: access('app.read') }, async (request) => {
      const params = ids(parseInput(templateParams, request.params));
      const { payload, externalId } = parseInput(renderBody, request.body ?? {});
      return useCases.renderTemplate.execute({ ...params, payload, externalId: externalId ?? 'preview' });
    });

    // Xem trước thiết kế kéo-thả đang soạn (ADR-0034): cùng hàm sinh + cùng giới hạn với lưu nháp, không ghi gì.
    app.post('/apps/:appId/templates/design-preview', { bodyLimit: LARGE_BODY_LIMIT_BYTES, config: access('app.read') }, async (request) => {
      parseInput(appParams, request.params);
      const { design } = parseInput(designPreviewBody, request.body);
      return useCases.previewDesign.execute(design);
    });

    app.get('/apps/:appId/templates/:templateId', { config: access('app.read') }, async (request) => {
      const { appId, templateId } = ids(parseInput(templateParams, request.params));
      return useCases.queries.get(appId, templateId);
    });

    app.patch('/apps/:appId/templates/:templateId', { config: access('app.manage') }, async (request) => {
      const params = ids(parseInput(templateParams, request.params));
      const { name, category } = parseInput(updateBody, request.body);
      return useCases.updateTemplate.execute({ ...params, name, category }, ctx(request));
    });

    // Bản sao là template MỚI (id mới) của cùng app — quyền như lệnh tạo.
    app.post('/apps/:appId/templates/:templateId/duplicate', { config: access('app.manage') }, async (request, reply) => {
      const params = ids(parseInput(templateParams, request.params));
      const { name } = parseInput(duplicateBody, request.body);
      const created = await useCases.duplicateTemplate.execute({ ...params, name }, ctx(request));
      return reply.status(201).send(created);
    });

    app.put('/apps/:appId/templates/:templateId/draft', { bodyLimit: LARGE_BODY_LIMIT_BYTES, config: access('app.manage') }, async (request) => {
      const params = ids(parseInput(templateParams, request.params));
      rejectBlocks(request.body);
      const body = parseInput(draftBody, request.body);
      return useCases.saveDraft.execute({ ...params, draft: toDraft(body) }, ctx(request));
    });

    app.post('/apps/:appId/templates/:templateId/draft/from/:version', { config: access('app.manage') }, async (request, reply) => {
      const { version, ...rest } = parseInput(versionParams, request.params);
      const created = await useCases.draftFromVersion.execute({ ...ids(rest), version }, ctx(request));
      return reply.status(201).send(created);
    });

    // Một chiều: nháp kéo-thả -> HTML, giữ HTML đã sinh. Bản đã xuất bản không đổi.
    app.post('/apps/:appId/templates/:templateId/draft/convert-to-html', { config: access('app.manage') }, async (request) => {
      const params = ids(parseInput(templateParams, request.params));
      return useCases.convertDraftToHtml.execute(params, ctx(request));
    });

    app.post('/apps/:appId/templates/:templateId/publish', { config: access('app.manage') }, async (request) => {
      const params = ids(parseInput(templateParams, request.params));
      return useCases.publishVersion.execute(params, ctx(request));
    });

    // Trả ĐỀ XUẤT của AI, không ghi gì (ADR-0020 §7). Có thể mất vài chục giây — chờ nhà cung cấp.
    app.post('/apps/:appId/templates/:templateId/ai-compose', { bodyLimit: LARGE_BODY_LIMIT_BYTES, config: access('app.manage') }, async (request) => {
      const params = ids(parseInput(templateParams, request.params));
      const body = parseInput(aiComposeBody, request.body);
      return useCases.composeTemplateDraft.execute({ ...params, ...body }, ctx(request));
    });

    app.post('/apps/:appId/templates/:templateId/archive', { config: access('app.manage') }, async (request) => {
      const params = ids(parseInput(templateParams, request.params));
      return useCases.archiveTemplate.execute(params, ctx(request));
    });
  };
}
