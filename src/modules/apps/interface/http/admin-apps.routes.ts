import { z } from 'zod';
import type { CommandContext } from '../../../../shared/application/index.ts';
import { access, adminAccess, adminCaller, parseInput, type HttpRoutes, type RouteTarget } from '../../../../shared/http/index.ts';
import {
  APP_ORIGINS,
  AppId,
  AppSecretId,
  CHANNELS,
  decide,
  NETWORK_RULE_KINDS,
  OrgId,
  type Permission,
} from '../../../../shared/kernel/index.ts';
import type {
  AddNetworkRule,
  AppQueries,
  ApproveApp,
  CreateApp,
  IssueAppSecret,
  RemoveNetworkRule,
  RevokeAppSecret,
  SetOpenTracking,
  SetPacing,
  SetHourlyCeiling,
  SetPacingCeiling,
  SetRecipientLimit,
  SetSendWindow,
  SimpleAppTransition,
  TransitionApp,
} from '../../application/index.ts';

// --- schema ở biên: định dạng input. Luật nghiệp vụ nằm ở domain, không lặp lại ở đây. ---
const SLUG = /^[a-z0-9][a-z0-9-]{1,62}$/;
const createBody = z
  .object({
    orgId: z.string().uuid(),
    slug: z.string().regex(SLUG, 'lowercase letters, digits and dashes, 2-63 chars'),
    name: z.string().trim().min(1).max(200),
    namespace: z.string().regex(SLUG, 'lowercase letters, digits and dashes, 2-63 chars'),
    origin: z.enum(APP_ORIGINS).optional(),
  })
  .strict();
const listQuery = z.object({ orgId: z.string().uuid() });
const appParams = z.object({ appId: z.string().uuid() });
const secretParams = appParams.extend({ secretId: z.string().uuid() });
/** Tên hành động trên URL -> event của state machine. `approve` có route riêng vì kèm quyền cấp. */
const TRANSITIONS: Record<string, SimpleAppTransition> = {
  submit: 'submit_for_review',
  reject: 'reject',
  suspend: 'suspend',
  resume: 'resume',
  revoke: 'revoke',
};
const transitionParams = appParams.extend({ action: z.enum(Object.keys(TRANSITIONS) as [string, ...string[]]) });
const reasonBody = z.object({ reason: z.string().trim().max(500).optional() }).strict();
const approveBody = z
  .object({
    grantedChannels: z.array(z.enum(CHANNELS)).min(1),
    rateLimitPerMinute: z.number().int().positive().default(60),
    maxRecipientsPerEvent: z.number().int().positive().default(1000),
  })
  .strict();
/** Gửi duyệt là việc của đội app; duyệt / từ chối / tạm ngưng / mở lại / thu hồi là của Super Admin. */
const transitionPermission = (request: { params: unknown }): Permission =>
  (request.params as { action?: string }).action === 'submit' ? 'app.manage' : 'app.review';
/** Org nằm ở query (`GET /apps?orgId=`) hoặc body (`POST /apps`), không ở path. */
const orgFrom =
  (where: 'query' | 'body') =>
  (request: { query: unknown; body: unknown }): RouteTarget => {
    const orgId = (request[where] as { orgId?: unknown } | undefined)?.orgId;
    return typeof orgId === 'string' ? { kind: 'org', orgId } : { kind: 'none' };
  };
/** Tên khoá tuỳ chọn (gọi cũ không gửi body vẫn chạy); console luôn gửi. */
const issueSecretBody = z.object({ name: z.string().trim().max(100).optional() }).strict();
const openTrackingBody = z.object({ enabled: z.boolean() }).strict();
const sendWindowBody = z
  .object({
    window: z
      .object({ days: z.array(z.number().int()).max(7), start: z.string().max(5), end: z.string().max(5) })
      .strict()
      .nullable(),
    mandatoryBypass: z.boolean(),
  })
  .strict();
// Khoảng 1–1000 kiểm ở entity (PACING_INVALID) — ở đây chỉ chặn kiểu.
const pacingBody = z.object({ perMinute: z.number().int().nullable(), mandatoryBypass: z.boolean() }).strict();
const pacingCeilingBody = z.object({ maxPerMinute: z.number().int().nullable() }).strict();
const hourlyCeilingBody = z.object({ maxPerHour: z.number().int().nullable(), mandatoryBypass: z.boolean() }).strict();
const recipientLimitBody = z.object({ perDay: z.number().int().nullable(), mandatoryBypass: z.boolean() }).strict();
const ruleBody = z.object({ kind: z.enum(NETWORK_RULE_KINDS), value: z.string().trim().min(1).max(255) }).strict();

export interface AdminAppsUseCases {
  createApp: CreateApp;
  transitionApp: TransitionApp;
  approveApp: ApproveApp;
  issueAppSecret: IssueAppSecret;
  revokeAppSecret: RevokeAppSecret;
  addNetworkRule: AddNetworkRule;
  removeNetworkRule: RemoveNetworkRule;
  setOpenTracking: SetOpenTracking;
  setSendWindow: SetSendWindow;
  setPacing: SetPacing;
  setPacingCeiling: SetPacingCeiling;
  setHourlyCeiling: SetHourlyCeiling;
  setRecipientLimit: SetRecipientLimit;
  queries: AppQueries;
}

/**
 * `/admin/apps/*` (UC-001). Route chỉ: parse input -> dựng CommandContext từ caller -> gọi use case
 * -> trả DTO. Lỗi nào cũng ném ra để error handler chung đổi thành problem+json.
 */
export function adminAppsRoutes(useCases: AdminAppsUseCases): HttpRoutes {
  return (app) => {
    const ctx = (request: Parameters<typeof adminCaller>[0]): CommandContext => ({
      actor: { id: adminCaller(request).adminId, type: 'admin' },
      source: 'admin_api',
    });

    app.post('/apps', { config: access('app.create', orgFrom('body')) }, async (request, reply) => {
      const body = parseInput(createBody, request.body);
      const created = await useCases.createApp.execute({ ...body, orgId: OrgId.parse(body.orgId) }, ctx(request));
      return reply.status(201).send(created);
    });

    // Owner / Org Admin thấy mọi app của org; Member chỉ thấy app mình được cấp vai.
    app.get('/apps', { config: access('org.read', orgFrom('query')) }, async (request) => {
      const { orgId } = parseInput(listQuery, request.query);
      const visible = adminAccess(request);
      const apps = await useCases.queries.listByOrg(OrgId.parse(orgId));
      return apps.filter((a) => decide(visible, 'app.read', { orgId, appId: a.id }) === 'allow');
    });

    app.get('/apps/:appId', { config: access('app.read') }, async (request) => {
      const { appId } = parseInput(appParams, request.params);
      return useCases.queries.get(AppId.parse(appId));
    });

    app.post('/apps/:appId/approve', { config: access('app.review') }, async (request) => {
      const { appId } = parseInput(appParams, request.params);
      const grant = parseInput(approveBody, request.body);
      return useCases.approveApp.execute({ appId: AppId.parse(appId), grant }, ctx(request));
    });

    app.post('/apps/:appId/:action', { config: access(transitionPermission) }, async (request) => {
      const { appId, action } = parseInput(transitionParams, request.params);
      const { reason } = parseInput(reasonBody, request.body ?? {});
      return useCases.transitionApp.execute(
        { appId: AppId.parse(appId), transition: TRANSITIONS[action]!, reason },
        ctx(request),
      );
    });

    app.get('/apps/:appId/secrets', { config: access('app.read') }, async (request) => {
      const { appId } = parseInput(appParams, request.params);
      return useCases.queries.listSecrets(AppId.parse(appId));
    });

    // Response DUY NHẤT chứa plaintext API key (UC-001 BR-4) — không cache.
    app.post('/apps/:appId/secrets', { config: access('app.manage') }, async (request, reply) => {
      const { appId } = parseInput(appParams, request.params);
      const { name } = parseInput(issueSecretBody, request.body ?? {});
      const issued = await useCases.issueAppSecret.execute({ appId: AppId.parse(appId), name }, ctx(request));
      return reply.status(201).header('cache-control', 'no-store').send(issued);
    });

    app.delete('/apps/:appId/secrets/:secretId', { config: access('app.manage') }, async (request) => {
      const { appId, secretId } = parseInput(secretParams, request.params);
      return useCases.revokeAppSecret.execute(
        { appId: AppId.parse(appId), secretId: AppSecretId.parse(secretId) },
        ctx(request),
      );
    });

    // Đếm "đã mở" (ADR-0031) — cùng quyền với cấp khoá API: việc của người quản lý app.
    app.put('/apps/:appId/open-tracking', { config: access('app.manage') }, async (request) => {
      const { appId } = parseInput(appParams, request.params);
      const { enabled } = parseInput(openTrackingBody, request.body);
      return useCases.setOpenTracking.execute({ appId: AppId.parse(appId), enabled }, ctx(request));
    });

    // Khung giờ gửi (ADR-0032) — việc của người quản lý app, như đếm "đã mở".
    app.put('/apps/:appId/send-window', { config: access('app.manage') }, async (request) => {
      const { appId } = parseInput(appParams, request.params);
      const body = parseInput(sendWindowBody, request.body);
      return useCases.setSendWindow.execute({ appId: AppId.parse(appId), ...body }, ctx(request));
    });

    // Dàn đều (ADR-0032 GĐ 2): Admin App chỉnh trong trần; trần chỉ Super Admin.
    app.put('/apps/:appId/pacing', { config: access('app.manage') }, async (request) => {
      const { appId } = parseInput(appParams, request.params);
      const body = parseInput(pacingBody, request.body);
      return useCases.setPacing.execute({ appId: AppId.parse(appId), ...body }, ctx(request));
    });

    app.put('/apps/:appId/pacing-ceiling', { config: access('platform.manage') }, async (request) => {
      const { appId } = parseInput(appParams, request.params);
      const body = parseInput(pacingCeilingBody, request.body);
      return useCases.setPacingCeiling.execute({ appId: AppId.parse(appId), ...body }, ctx(request));
    });

    // Giới hạn gửi GĐ 3 (ADR-0032): trần mỗi giờ — chỉ Super Admin; giới hạn mỗi người / ngày — người quản lý app.
    app.put('/apps/:appId/hourly-ceiling', { config: access('platform.manage') }, async (request) => {
      const { appId } = parseInput(appParams, request.params);
      const body = parseInput(hourlyCeilingBody, request.body);
      return useCases.setHourlyCeiling.execute({ appId: AppId.parse(appId), ...body }, ctx(request));
    });

    app.put('/apps/:appId/recipient-limit', { config: access('app.manage') }, async (request) => {
      const { appId } = parseInput(appParams, request.params);
      const body = parseInput(recipientLimitBody, request.body);
      return useCases.setRecipientLimit.execute({ appId: AppId.parse(appId), ...body }, ctx(request));
    });

    app.get('/apps/:appId/network-rules', { config: access('platform.manage') }, async (request) => {
      const { appId } = parseInput(appParams, request.params);
      return useCases.queries.listNetworkRules(AppId.parse(appId));
    });

    app.post('/apps/:appId/network-rules', { config: access('platform.manage') }, async (request, reply) => {
      const { appId } = parseInput(appParams, request.params);
      const rule = parseInput(ruleBody, request.body);
      return reply.status(201).send(await useCases.addNetworkRule.execute({ appId: AppId.parse(appId), ...rule }, ctx(request)));
    });

    app.delete('/apps/:appId/network-rules', { config: access('platform.manage') }, async (request, reply) => {
      const { appId } = parseInput(appParams, request.params);
      const rule = parseInput(ruleBody, request.query);
      await useCases.removeNetworkRule.execute({ appId: AppId.parse(appId), ...rule }, ctx(request));
      return reply.status(204).send();
    });
  };
}
