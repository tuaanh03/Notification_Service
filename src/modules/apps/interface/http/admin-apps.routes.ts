import { z } from 'zod';
import type { CommandContext } from '../../../../shared/application/index.ts';
import { access, adminAccess, adminCaller, adminContext, doc, type HttpRoutes, parseInput, type RouteTarget } from '../../../../shared/http/index.ts';
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
  SetApiRateLimit,
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
const apiRateLimitBody = z.object({ perMinute: z.number().int() }).strict();
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
  setApiRateLimit: SetApiRateLimit;
  setRecipientLimit: SetRecipientLimit;
  queries: AppQueries;
}

/**
 * `/admin/apps/*` (UC-001). Route chỉ: parse input -> dựng CommandContext từ caller -> gọi use case
 * -> trả DTO. Lỗi nào cũng ném ra để error handler chung đổi thành problem+json.
 */
export function adminAppsRoutes(useCases: AdminAppsUseCases): HttpRoutes {
  return (app) => {
    // Nguồn audit theo cách xác thực: phiên -> `admin_api`, PAT -> `admin_pat` (ADR-0044).
    const ctx = (request: Parameters<typeof adminCaller>[0]): CommandContext => adminContext(request);
    const tag = 'apps';
    // Đổi trạng thái: sai đường theo APP_TRANSITIONS -> 409; hai người bấm cùng lúc -> người sau 409.
    const transitionErrors = [
      { status: 409, code: 'INVALID_TRANSITION' },
      { status: 409, code: 'CONCURRENT_TRANSITION' },
    ];

    app.post(
      '/apps',
      {
        config: {
          ...access('app.create', orgFrom('body')),
          ...doc({
            tag,
            summary: 'Register a new app in an organization.',
            description:
              'Self-serve: the app is created `active` with the `email` channel granted, no approval step. Issue its first API key next with `POST /admin/apps/{appId}/secrets`.',
            body: createBody,
            example: {
              orgId: '0b6f8c1e-3c2a-4d8e-9f10-2a3b4c5d6e7f',
              slug: 'hr-portal',
              name: 'HR Portal',
              namespace: 'hr-portal',
              origin: 'internal',
            },
            status: 201,
            responseDto: 'AppDto',
            errors: [
              { status: 404, code: 'NOT_FOUND' },
              { status: 409, code: 'APP_SLUG_TAKEN' },
              { status: 409, code: 'APP_NAMESPACE_TAKEN' },
            ],
          }),
        },
      },
      async (request, reply) => {
        const body = parseInput(createBody, request.body);
        const created = await useCases.createApp.execute({ ...body, orgId: OrgId.parse(body.orgId) }, ctx(request));
        return reply.status(201).send(created);
      },
    );

    // Owner / Org Admin thấy mọi app của org; Member chỉ thấy app mình được cấp vai.
    app.get(
      '/apps',
      {
        config: {
          ...access('org.read', orgFrom('query')),
          ...doc({
            tag,
            summary: 'List the apps of an organization that you can see.',
            description: 'Owners and Org Admins see every app of the organization; Members only see apps they hold a role on.',
            query: listQuery,
            responseDto: 'AppDto[]',
            errors: [{ status: 404, code: 'NOT_FOUND' }],
          }),
        },
      },
      async (request) => {
        const { orgId } = parseInput(listQuery, request.query);
        const visible = adminAccess(request);
        const apps = await useCases.queries.listByOrg(OrgId.parse(orgId));
        return apps.filter((a) => decide(visible, 'app.read', { orgId, appId: a.id }) === 'allow');
      },
    );

    app.get(
      '/apps/:appId',
      { config: { ...access('app.read'), ...doc({ tag, summary: 'Get one app.', params: appParams, responseDto: 'AppDto' }) } },
      async (request) => {
        const { appId } = parseInput(appParams, request.params);
        return useCases.queries.get(AppId.parse(appId));
      },
    );

    app.post(
      '/apps/:appId/approve',
      {
        config: {
          ...access('app.review'),
          ...doc({
            tag,
            summary: 'Approve a legacy app waiting in `pending_approval`, with the channels and limits it is granted.',
            description: 'Only for apps registered before self-serve registration; new apps are created `active`.',
            params: appParams,
            body: approveBody,
            example: { grantedChannels: ['email'], rateLimitPerMinute: 60, maxRecipientsPerEvent: 1000 },
            responseDto: 'AppDto',
            errors: transitionErrors,
          }),
        },
      },
      async (request) => {
        const { appId } = parseInput(appParams, request.params);
        const grant = parseInput(approveBody, request.body);
        return useCases.approveApp.execute({ appId: AppId.parse(appId), grant }, ctx(request));
      },
    );

    app.post(
      '/apps/:appId/:action',
      {
        config: {
          ...access(transitionPermission),
          ...doc({
            tag,
            summary: 'Change the app status: submit, reject, suspend, resume or revoke.',
            description:
              '`submit` needs `app.manage`; the others are Super Admin actions (`app.review`). `revoke` is final: there is no way back. The optional `reason` is recorded in the audit log.',
            params: transitionParams,
            body: reasonBody,
            example: { reason: 'Sending spam to external recipients' },
            responseDto: 'AppDto',
            errors: transitionErrors,
          }),
        },
      },
      async (request) => {
        const { appId, action } = parseInput(transitionParams, request.params);
        const { reason } = parseInput(reasonBody, request.body ?? {});
        return useCases.transitionApp.execute(
          { appId: AppId.parse(appId), transition: TRANSITIONS[action]!, reason },
          ctx(request),
        );
      },
    );

    app.get(
      '/apps/:appId/secrets',
      {
        config: {
          ...access('app.read'),
          ...doc({ tag, summary: 'List the API keys of an app (hint only, never the key itself).', params: appParams, responseDto: 'AppSecretDto[]' }),
        },
      },
      async (request) => {
        const { appId } = parseInput(appParams, request.params);
        return useCases.queries.listSecrets(AppId.parse(appId));
      },
    );

    // Response DUY NHẤT chứa plaintext API key (UC-001 BR-4) — không cache.
    app.post(
      '/apps/:appId/secrets',
      {
        config: {
          ...access('app.manage'),
          ...doc({
            tag,
            summary: 'Issue a new API key for an app. The key is returned once.',
            description:
              'The plaintext `apiKey` exists only in this response (`Cache-Control: no-store`); store it now. Issuing a key does not revoke existing keys. The number of active keys is capped by the system setting `apps.max_active_api_keys`.',
            params: appParams,
            body: issueSecretBody,
            example: { name: 'production' },
            status: 201,
            responseDto: 'IssuedAppSecretDto',
            errors: [
              { status: 422, code: 'ACTIVE_SECRET_LIMIT' },
              { status: 422, code: 'APP_REVOKED' },
            ],
          }),
        },
      },
      async (request, reply) => {
        const { appId } = parseInput(appParams, request.params);
        const { name } = parseInput(issueSecretBody, request.body ?? {});
        const issued = await useCases.issueAppSecret.execute({ appId: AppId.parse(appId), name }, ctx(request));
        return reply.status(201).header('cache-control', 'no-store').send(issued);
      },
    );

    app.delete(
      '/apps/:appId/secrets/:secretId',
      {
        config: {
          ...access('app.manage'),
          ...doc({
            tag,
            summary: 'Revoke an API key. Calls with it fail immediately.',
            description: 'Idempotent: revoking an already revoked key returns it unchanged.',
            params: secretParams,
            responseDto: 'AppSecretDto',
          }),
        },
      },
      async (request) => {
        const { appId, secretId } = parseInput(secretParams, request.params);
        return useCases.revokeAppSecret.execute(
          { appId: AppId.parse(appId), secretId: AppSecretId.parse(secretId) },
          ctx(request),
        );
      },
    );

    // Đếm "đã mở" (ADR-0031) — cùng quyền với cấp khoá API: việc của người quản lý app.
    app.put(
      '/apps/:appId/open-tracking',
      {
        config: {
          ...access('app.manage'),
          ...doc({
            tag,
            summary: 'Turn open tracking (tracking pixel) on or off for an app.',
            description: 'Applies to emails sent after the change. Open counts are an estimate.',
            params: appParams,
            body: openTrackingBody,
            example: { enabled: true },
            responseDto: 'AppDto',
          }),
        },
      },
      async (request) => {
        const { appId } = parseInput(appParams, request.params);
        const { enabled } = parseInput(openTrackingBody, request.body);
        return useCases.setOpenTracking.execute({ appId: AppId.parse(appId), enabled }, ctx(request));
      },
    );

    // Khung giờ gửi (ADR-0032) — việc của người quản lý app, như đếm "đã mở".
    app.put(
      '/apps/:appId/send-window',
      {
        config: {
          ...access('app.manage'),
          ...doc({
            tag,
            summary: 'Set the hours an app may send email, or `window: null` to send any time.',
            description:
              'Times are Vietnam time (UTC+7), `HH:MM` (end may be `24:00`); days are 1 (Monday) to 7 (Sunday). Emails accepted outside the window wait until it opens; emails already accepted keep their time. `mandatoryBypass`: mandatory topics ignore the window.',
            params: appParams,
            body: sendWindowBody,
            example: { window: { days: [1, 2, 3, 4, 5], start: '08:00', end: '18:00' }, mandatoryBypass: true },
            responseDto: 'AppDto',
            errors: [
              { status: 422, code: 'SEND_WINDOW_DAYS_REQUIRED' },
              { status: 422, code: 'SEND_WINDOW_DAY_INVALID' },
              { status: 422, code: 'SEND_WINDOW_TIME_INVALID' },
              { status: 422, code: 'SEND_WINDOW_EMPTY' },
            ],
          }),
        },
      },
      async (request) => {
        const { appId } = parseInput(appParams, request.params);
        const body = parseInput(sendWindowBody, request.body);
        return useCases.setSendWindow.execute({ appId: AppId.parse(appId), ...body }, ctx(request));
      },
    );

    // Dàn đều (ADR-0032 GĐ 2): Admin App chỉnh trong trần; trần chỉ Super Admin.
    app.put(
      '/apps/:appId/pacing',
      {
        config: {
          ...access('app.manage'),
          ...doc({
            tag,
            summary: 'Spread sending of an app to at most N emails per minute, or `perMinute: null` for no pacing.',
            description: '`perMinute` is 1–1000 and may not exceed the ceiling a Super Admin set for the app. Applies to emails accepted after the change.',
            params: appParams,
            body: pacingBody,
            example: { perMinute: 120, mandatoryBypass: true },
            responseDto: 'AppDto',
            errors: [
              { status: 422, code: 'PACING_INVALID' },
              { status: 422, code: 'PACING_ABOVE_CEILING' },
            ],
          }),
        },
      },
      async (request) => {
        const { appId } = parseInput(appParams, request.params);
        const body = parseInput(pacingBody, request.body);
        return useCases.setPacing.execute({ appId: AppId.parse(appId), ...body }, ctx(request));
      },
    );

    app.put(
      '/apps/:appId/pacing-ceiling',
      {
        config: {
          ...access('platform.manage'),
          ...doc({
            tag,
            summary: 'Super Admin: cap the sending speed of an app (emails per minute), or `null` for no cap.',
            description: '1–1000. Applies to every email of the app, mandatory ones included.',
            params: appParams,
            body: pacingCeilingBody,
            example: { maxPerMinute: 300 },
            responseDto: 'AppDto',
            errors: [{ status: 422, code: 'PACING_INVALID' }],
          }),
        },
      },
      async (request) => {
        const { appId } = parseInput(appParams, request.params);
        const body = parseInput(pacingCeilingBody, request.body);
        return useCases.setPacingCeiling.execute({ appId: AppId.parse(appId), ...body }, ctx(request));
      },
    );

    // Giới hạn gửi GĐ 3 (ADR-0032): trần mỗi giờ — chỉ Super Admin; giới hạn mỗi người / ngày — người quản lý app.
    app.put(
      '/apps/:appId/hourly-ceiling',
      {
        config: {
          ...access('platform.manage'),
          ...doc({
            tag,
            summary: 'Super Admin: cap the emails an app may send per hour, or `null` for no cap.',
            description: '1–100000. Over the cap, `POST /v1/notifications` returns 429 `APP_HOURLY_LIMIT`. `mandatoryBypass`: mandatory topics may exceed the cap.',
            params: appParams,
            body: hourlyCeilingBody,
            example: { maxPerHour: 5000, mandatoryBypass: false },
            responseDto: 'AppDto',
            errors: [{ status: 422, code: 'HOURLY_LIMIT_INVALID' }],
          }),
        },
      },
      async (request) => {
        const { appId } = parseInput(appParams, request.params);
        const body = parseInput(hourlyCeilingBody, request.body);
        return useCases.setHourlyCeiling.execute({ appId: AppId.parse(appId), ...body }, ctx(request));
      },
    );

    // ADR-0041: số lần gọi API gửi mỗi phút — chỉ Super Admin.
    app.put(
      '/apps/:appId/api-rate-limit',
      {
        config: {
          ...access('platform.manage'),
          ...doc({
            tag,
            summary: 'Set how many `/v1` send calls an app may make per minute (Super Admin only).',
            description: 'Over the limit `/v1` returns `429 APP_RATE_LIMITED`. Always has a value; there is no "unlimited".',
            params: appParams,
            body: apiRateLimitBody,
            example: { perMinute: 600 },
            responseDto: 'AppDto',
            errors: [{ status: 422, code: 'API_RATE_LIMIT_INVALID' }],
          }),
        },
      },
      async (request) => {
        const { appId } = parseInput(appParams, request.params);
        const body = parseInput(apiRateLimitBody, request.body);
        return useCases.setApiRateLimit.execute({ appId: AppId.parse(appId), ...body }, ctx(request));
      },
    );

    app.put(
      '/apps/:appId/recipient-limit',
      {
        config: {
          ...access('app.manage'),
          ...doc({
            tag,
            summary: 'Limit how many emails one recipient gets from an app per day, or `perDay: null` for no limit.',
            description:
              '1–1000. Emails over the limit are skipped (`no_recipient`, reason `recipient_limit`), not moved to the next day. `mandatoryBypass`: mandatory topics are not counted.',
            params: appParams,
            body: recipientLimitBody,
            example: { perDay: 20, mandatoryBypass: true },
            responseDto: 'AppDto',
            errors: [{ status: 422, code: 'RECIPIENT_LIMIT_INVALID' }],
          }),
        },
      },
      async (request) => {
        const { appId } = parseInput(appParams, request.params);
        const body = parseInput(recipientLimitBody, request.body);
        return useCases.setRecipientLimit.execute({ appId: AppId.parse(appId), ...body }, ctx(request));
      },
    );

    app.get(
      '/apps/:appId/network-rules',
      {
        config: {
          ...access('platform.manage'),
          ...doc({
            tag,
            summary: 'Super Admin: list the IP allowlist of an app. Empty = any IP may call.',
            params: appParams,
            responseDto: 'NetworkRuleDto[]',
          }),
        },
      },
      async (request) => {
        const { appId } = parseInput(appParams, request.params);
        return useCases.queries.listNetworkRules(AppId.parse(appId));
      },
    );

    app.post(
      '/apps/:appId/network-rules',
      {
        config: {
          ...access('platform.manage'),
          ...doc({
            tag,
            summary: 'Super Admin: add one IP to the allowlist of an app.',
            description:
              'Applies to `/v1` and `/hooks`. The first rule turns the app from "any IP" into "only these IPs" (others get 403 `IP_NOT_ALLOWED`). Exact match on a single IP: ranges (CIDR) are not supported and the value is not format-checked, so a CIDR blocks every caller.',
            params: appParams,
            body: ruleBody,
            example: { kind: 'ip', value: '10.20.30.40' },
            status: 201,
            responseDto: 'NetworkRuleDto',
            errors: [{ status: 409, code: 'NETWORK_RULE_EXISTS' }],
          }),
        },
      },
      async (request, reply) => {
        const { appId } = parseInput(appParams, request.params);
        const rule = parseInput(ruleBody, request.body);
        return reply.status(201).send(await useCases.addNetworkRule.execute({ appId: AppId.parse(appId), ...rule }, ctx(request)));
      },
    );

    app.delete(
      '/apps/:appId/network-rules',
      {
        config: {
          ...access('platform.manage'),
          ...doc({
            tag,
            summary: 'Super Admin: remove one IP from the allowlist of an app (rule given in the query).',
            description: 'Removing the last IP opens the app to any IP again.',
            params: appParams,
            query: ruleBody,
            status: 204,
          }),
        },
      },
      async (request, reply) => {
        const { appId } = parseInput(appParams, request.params);
        const rule = parseInput(ruleBody, request.query);
        await useCases.removeNetworkRule.execute({ appId: AppId.parse(appId), ...rule }, ctx(request));
        return reply.status(204).send();
      },
    );
  };
}
