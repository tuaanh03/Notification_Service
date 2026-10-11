import { z } from 'zod';
import type { CommandContext } from '../../../../shared/application/index.ts';
import { access, adminCaller, parseInput, type HttpRoutes } from '../../../../shared/http/index.ts';
import { AppId, INCOMING_HOOK_STATUSES, IncomingHookId, TemplateId, TopicId } from '../../../../shared/kernel/index.ts';
import type {
  CreateIncomingHook,
  DeleteIncomingHook,
  IncomingHookQueries,
  PreviewIncomingHook,
  RotateIncomingHookToken,
  UpdateIncomingHook,
} from '../../application/index.ts';
import type { IncomingHookConfig } from '../../domain/index.ts';

// Định dạng ở biên; luật (cú pháp đường dẫn, biến payload.*, độ dài…) ở domain `validateHookConfig`.
const mapping = z.discriminatedUnion('kind', [
  z
    .object({
      variable: z.string().max(100),
      kind: z.literal('path'),
      path: z.string().max(300),
      defaultValue: z.string().max(1000).nullable().optional(),
    })
    .strict(),
  z.object({ variable: z.string().max(100), kind: z.literal('fixed'), value: z.string().max(1000) }).strict(),
]);
const config = z
  .object({
    name: z.string().max(200),
    topicId: z.string().uuid(),
    templateId: z.string().uuid(),
    mappings: z.array(mapping).max(50),
    dedupePath: z.string().max(300).nullable().optional(),
    condition: z.object({ path: z.string().max(300), values: z.array(z.string().max(500)).max(50) }).strict().nullable().optional(),
  })
  .strict();
const updateBody = z.object({ config: config.optional(), status: z.enum(INCOMING_HOOK_STATUSES).optional() }).strict();
const previewBody = z
  .object({ config: config.extend({ name: z.string().max(200).optional() }), sample: z.unknown(), idempotencyKey: z.string().max(255).optional() })
  .strict();
const appParams = z.object({ appId: z.string().uuid() });
const hookParams = z.object({ appId: z.string().uuid(), hookId: z.string().uuid() });

type ConfigInput = z.infer<typeof config>;
const toConfig = (c: Omit<ConfigInput, 'name'> & { name?: string | undefined }): IncomingHookConfig => ({
  name: c.name ?? 'preview',
  topicId: TopicId.parse(c.topicId),
  templateId: TemplateId.parse(c.templateId),
  mappings: c.mappings.map((m) =>
    m.kind === 'path' ? { variable: m.variable, kind: 'path', path: m.path, defaultValue: m.defaultValue ?? null } : m,
  ),
  dedupePath: c.dedupePath ?? null,
  condition: c.condition ?? null,
});

/**
 * Quản lý incoming webhook của MỘT app (ADR-0030). Xem: `app.read`; thêm / sửa / đổi URL / xoá / xem
 * trước: `app.manage`. Response có token (`POST`, `rotate-token`) không cache.
 */
export function adminIncomingHooksRoutes(useCases: {
  queries: IncomingHookQueries;
  create: CreateIncomingHook;
  update: UpdateIncomingHook;
  rotateToken: RotateIncomingHookToken;
  remove: DeleteIncomingHook;
  preview: PreviewIncomingHook;
}): HttpRoutes {
  return (app) => {
    const ctx = (request: Parameters<typeof adminCaller>[0]): CommandContext => ({
      actor: { id: adminCaller(request).adminId, type: 'admin' },
      source: 'admin_api',
    });
    const ids = (params: unknown) => {
      const { appId, hookId } = parseInput(hookParams, params);
      return { appId: AppId.parse(appId), hookId: IncomingHookId.parse(hookId) };
    };
    const appIdOf = (params: unknown) => AppId.parse(parseInput(appParams, params).appId);

    app.get('/apps/:appId/incoming-webhooks', { config: access('app.read') }, async (request) =>
      useCases.queries.list(appIdOf(request.params)),
    );

    app.post('/apps/:appId/incoming-webhooks', { config: access('app.manage') }, async (request, reply) => {
      const body = parseInput(config, request.body);
      const issued = await useCases.create.execute({ appId: appIdOf(request.params), config: toConfig(body) }, ctx(request));
      return reply.status(201).header('cache-control', 'no-store').send(issued);
    });

    app.post('/apps/:appId/incoming-webhooks/preview', { config: access('app.manage') }, async (request) => {
      const body = parseInput(previewBody, request.body);
      return useCases.preview.execute({
        appId: appIdOf(request.params),
        config: toConfig(body.config),
        sample: body.sample,
        idempotencyKey: body.idempotencyKey ?? null,
      });
    });

    app.patch('/apps/:appId/incoming-webhooks/:hookId', { config: access('app.manage') }, async (request) => {
      const body = parseInput(updateBody, request.body);
      return useCases.update.execute(
        { ...ids(request.params), config: body.config ? toConfig(body.config) : undefined, status: body.status },
        ctx(request),
      );
    });

    app.post('/apps/:appId/incoming-webhooks/:hookId/rotate-token', { config: access('app.manage') }, async (request, reply) => {
      const issued = await useCases.rotateToken.execute(ids(request.params), ctx(request));
      return reply.header('cache-control', 'no-store').send(issued);
    });

    app.delete('/apps/:appId/incoming-webhooks/:hookId', { config: access('app.manage') }, async (request, reply) => {
      await useCases.remove.execute(ids(request.params), ctx(request));
      return reply.status(204).send();
    });

    app.get('/apps/:appId/incoming-webhooks/:hookId/calls', { config: access('app.read') }, async (request) => {
      const { appId, hookId } = ids(request.params);
      return useCases.queries.calls(appId, hookId);
    });
  };
}
