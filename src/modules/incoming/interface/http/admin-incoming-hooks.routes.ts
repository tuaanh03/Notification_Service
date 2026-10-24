import { z } from 'zod';
import type { CommandContext } from '../../../../shared/application/index.ts';
import { access, adminContext, doc, parseInput, type HttpRoutes } from '../../../../shared/http/index.ts';
import { AppId, INCOMING_HOOK_STATUSES, IncomingHookId, TemplateId, TopicId } from '../../../../shared/kernel/index.ts';
import type {
  CreateIncomingHook,
  DeleteIncomingHook,
  IncomingHookInput,
  IncomingHookQueries,
  IncomingIntegrationQueries,
  PreviewIncomingHook,
  RevealIncomingHookUrl,
  RotateIncomingHookToken,
  UpdateIncomingHook,
} from '../../application/index.ts';
import { ALERT_TRIGGERS } from '../../domain/index.ts';

// Định dạng ở biên; luật (cú pháp đường dẫn, biến payload.*, độ dài…) ở domain `validateHookConfig`.
const mapping = z.discriminatedUnion('kind', [
  z
    .object({
      variable: z.string().max(100),
      kind: z.literal('path'),
      path: z.string().max(300),
      defaultValue: z.string().max(1000).nullable().optional(),
    })
    .strict()
    .meta({ title: 'PathMapping', description: 'Read the variable from a JSON path of the incoming body.' }),
  z
    .object({ variable: z.string().max(100), kind: z.literal('fixed'), value: z.string().max(1000) })
    .strict()
    .meta({ title: 'FixedMapping', description: 'Always use this fixed value for the variable.' }),
]);
const config = z
  .object({
    name: z.string().max(200),
    topicId: z.string().uuid(),
    templateId: z.string().uuid(),
    // Bỏ trống + có `integration` -> backend tự dựng ánh xạ / điều kiện (ADR-0046); không công cụ -> [] / không điều kiện.
    mappings: z.array(mapping).max(50).optional(),
    dedupePath: z.string().max(300).nullable().optional(),
    condition: z.object({ path: z.string().max(300), values: z.array(z.string().max(500)).max(50) }).strict().nullable().optional(),
    // Chuỗi thường, không enum: công cụ lạ là 422 INTEGRATION_UNKNOWN (domain), không phải lỗi định dạng.
    integration: z.string().max(32).nullable().optional(),
    trigger: z.enum(ALERT_TRIGGERS).nullable().optional(),
  })
  .strict();
const updateBody = z.object({ config: config.optional(), status: z.enum(INCOMING_HOOK_STATUSES).optional() }).strict();
const previewBody = z
  .object({ config: config.extend({ name: z.string().max(200).optional() }), sample: z.unknown(), idempotencyKey: z.string().max(255).optional() })
  .strict();
const appParams = z.object({ appId: z.string().uuid() });
const hookParams = z.object({ appId: z.string().uuid(), hookId: z.string().uuid() });

type ConfigInput = z.infer<typeof config>;
const toConfig = (c: Omit<ConfigInput, 'name'> & { name?: string | undefined }): IncomingHookInput => ({
  name: c.name ?? 'preview',
  topicId: TopicId.parse(c.topicId),
  templateId: TemplateId.parse(c.templateId),
  // `undefined` = không gửi — khác `[]` / `null` gửi tường minh (ADR-0046 §4).
  mappings: c.mappings?.map((m) =>
    m.kind === 'path' ? { variable: m.variable, kind: 'path', path: m.path, defaultValue: m.defaultValue ?? null } : m,
  ),
  dedupePath: c.dedupePath ?? null,
  condition: c.condition,
  integration: c.integration ?? null,
  trigger: c.trigger ?? null,
});

/**
 * Quản lý incoming webhook của MỘT app (ADR-0030) + danh mục công cụ (ADR-0046). Xem: `app.read`; thêm / sửa / đổi URL / lấy URL / xoá /
 * xem trước: `app.manage`. Response có token (`POST`, `rotate-token`, `url`) không cache.
 */
export function adminIncomingHooksRoutes(useCases: {
  queries: IncomingHookQueries;
  integrations: IncomingIntegrationQueries;
  create: CreateIncomingHook;
  update: UpdateIncomingHook;
  rotateToken: RotateIncomingHookToken;
  revealUrl: RevealIncomingHookUrl;
  remove: DeleteIncomingHook;
  preview: PreviewIncomingHook;
}): HttpRoutes {
  return (app) => {
    const tag = 'incoming-webhooks';
    const ctx = (request: Parameters<typeof adminContext>[0]): CommandContext => adminContext(request);
    const ids = (params: unknown) => {
      const { appId, hookId } = parseInput(hookParams, params);
      return { appId: AppId.parse(appId), hookId: IncomingHookId.parse(hookId) };
    };
    const appIdOf = (params: unknown) => AppId.parse(parseInput(appParams, params).appId);
    const notFound = { status: 404, code: 'NOT_FOUND' } as const;
    const notConfigured = { status: 503, code: 'WEBHOOK_NOT_CONFIGURED' } as const;
    // Lỗi của cấu hình hook — chung cho tạo / sửa / xem trước.
    const configErrors = [
      { status: 422, code: 'INCOMING_HOOK_NAME_INVALID' },
      { status: 422, code: 'INCOMING_MAPPING_INVALID' },
      { status: 422, code: 'INCOMING_CONDITION_INVALID' },
      { status: 422, code: 'WEBHOOK_PATH_INVALID' },
      { status: 422, code: 'INTEGRATION_UNKNOWN' },
      { status: 422, code: 'TOPIC_NOT_FOUND' },
      { status: 422, code: 'TEMPLATE_NOT_FOUND' },
    ];

    // Danh mục công cụ giám sát (ADR-0046) — không thuộc app / org nào, ai đăng nhập cũng xem được.
    app.get(
      '/incoming-integrations',
      {
        config: {
          ...access('catalog.read'),
          ...doc({
            tag,
            summary: 'List the monitoring tools an incoming webhook can plug into (Datadog, Grafana, Alertmanager, Gatus, Uptime Kuma).',
            responseDto: '{ integrations: IncomingIntegrationDto[] }',
          }),
        },
      },
      async () => useCases.integrations.list(),
    );

    app.get(
      '/apps/:appId/incoming-webhooks',
      {
        config: {
          ...access('app.read'),
          ...doc({ tag, summary: 'List the incoming webhooks of an app, with warnings. No tokens.', params: appParams, responseDto: 'IncomingHookListDto' }),
        },
      },
      async (request) => useCases.queries.list(appIdOf(request.params)),
    );

    app.post(
      '/apps/:appId/incoming-webhooks',
      {
        config: {
          ...access('app.manage'),
          ...doc({
            tag,
            summary: 'Create an incoming webhook. The URL (token) is in this response; fetch it again later via /url.',
            description:
              'With `integration` and no `mappings`, EWS builds the mappings from the tool catalog and the published template, and the publish condition from `trigger`.',
            params: appParams,
            body: config,
            example: {
              name: 'Grafana — incident',
              topicId: '0b9f3c2e-6a1d-4f5e-9c7b-2d8e1a4f6b30',
              templateId: '7c4e2a91-3b5d-4e8f-a1c6-9d0b2f7e5a14',
              integration: 'grafana',
              trigger: 'firing',
            },
            status: 201,
            responseDto: 'IssuedHookUrlDto',
            errors: [...configErrors, { status: 422, code: 'INCOMING_HOOK_LIMIT_REACHED' }, notConfigured],
          }),
        },
      },
      async (request, reply) => {
        const body = parseInput(config, request.body);
        const issued = await useCases.create.execute({ appId: appIdOf(request.params), config: toConfig(body) }, ctx(request));
        return reply.status(201).header('cache-control', 'no-store').send(issued);
      },
    );

    app.post(
      '/apps/:appId/incoming-webhooks/preview',
      {
        config: {
          ...access('app.manage'),
          ...doc({
            tag,
            summary: 'Dry-run a hook configuration on a sample JSON body. Writes nothing, sends nothing.',
            params: appParams,
            body: previewBody,
            responseDto: 'HookPreviewDto',
            errors: configErrors,
          }),
        },
      },
      async (request) => {
        const body = parseInput(previewBody, request.body);
        return useCases.preview.execute({
          appId: appIdOf(request.params),
          config: toConfig(body.config),
          sample: body.sample,
          idempotencyKey: body.idempotencyKey ?? null,
        });
      },
    );

    app.patch(
      '/apps/:appId/incoming-webhooks/:hookId',
      {
        config: {
          ...access('app.manage'),
          ...doc({
            tag,
            summary: 'Change the configuration and / or enable / disable a hook. The URL does not change.',
            params: hookParams,
            body: updateBody,
            responseDto: 'IncomingHookDto',
            errors: [notFound, ...configErrors],
          }),
        },
      },
      async (request) => {
        const body = parseInput(updateBody, request.body);
        return useCases.update.execute(
          { ...ids(request.params), config: body.config ? toConfig(body.config) : undefined, status: body.status },
          ctx(request),
        );
      },
    );

    app.post(
      '/apps/:appId/incoming-webhooks/:hookId/rotate-token',
      {
        config: {
          ...access('app.manage'),
          ...doc({
            tag,
            summary: 'Rotate the hook URL. The old URL stops working immediately.',
            params: hookParams,
            responseDto: 'IssuedHookUrlDto',
            errors: [notFound, notConfigured],
          }),
        },
      },
      async (request, reply) => {
        const issued = await useCases.rotateToken.execute(ids(request.params), ctx(request));
        return reply.header('cache-control', 'no-store').send(issued);
      },
    );

    // URL đầy đủ, lấy bất cứ lúc nào — chỉ người quản lý app; mỗi lần lấy ghi audit. Không cache.
    app.get(
      '/apps/:appId/incoming-webhooks/:hookId/url',
      {
        config: {
          ...access('app.manage'),
          ...doc({
            tag,
            summary: 'Reveal the hook URL. Every call is written to the audit log.',
            params: hookParams,
            responseDto: '{ path: string; url: string | null }',
            errors: [notFound, { status: 409, code: 'INCOMING_URL_NEEDS_ROTATION' }, notConfigured],
          }),
        },
      },
      async (request, reply) => {
        const url = await useCases.revealUrl.execute(ids(request.params), ctx(request));
        return reply.header('cache-control', 'no-store').send(url);
      },
    );

    app.delete(
      '/apps/:appId/incoming-webhooks/:hookId',
      {
        config: {
          ...access('app.manage'),
          ...doc({ tag, summary: 'Delete a hook and its call log. The URL stops working immediately.', params: hookParams, status: 204, errors: [notFound] }),
        },
      },
      async (request, reply) => {
        await useCases.remove.execute(ids(request.params), ctx(request));
        return reply.status(204).send();
      },
    );

    app.get(
      '/apps/:appId/incoming-webhooks/:hookId/calls',
      {
        config: {
          ...access('app.read'),
          ...doc({ tag, summary: 'List the latest calls to a hook (last 30 days, newest first).', params: hookParams, responseDto: 'IncomingCallDto[]', errors: [notFound] }),
        },
      },
      async (request) => {
        const { appId, hookId } = ids(request.params);
        return useCases.queries.calls(appId, hookId);
      },
    );
  };
}
