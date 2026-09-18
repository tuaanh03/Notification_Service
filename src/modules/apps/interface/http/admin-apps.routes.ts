import { z } from 'zod';
import type { CommandContext } from '../../../../shared/application/index.ts';
import { adminCaller, parseInput, type HttpRoutes } from '../../../../shared/http/index.ts';
import {
  APP_ORIGINS,
  AppId,
  AppSecretId,
  CHANNELS,
  NETWORK_RULE_KINDS,
  OrgId,
} from '../../../../shared/kernel/index.ts';
import type {
  AddNetworkRule,
  AppQueries,
  ApproveApp,
  CreateApp,
  IssueAppSecret,
  RemoveNetworkRule,
  RevokeAppSecret,
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
const ruleBody = z.object({ kind: z.enum(NETWORK_RULE_KINDS), value: z.string().trim().min(1).max(255) }).strict();

export interface AdminAppsUseCases {
  createApp: CreateApp;
  transitionApp: TransitionApp;
  approveApp: ApproveApp;
  issueAppSecret: IssueAppSecret;
  revokeAppSecret: RevokeAppSecret;
  addNetworkRule: AddNetworkRule;
  removeNetworkRule: RemoveNetworkRule;
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

    app.post('/apps', async (request, reply) => {
      const body = parseInput(createBody, request.body);
      const created = await useCases.createApp.execute({ ...body, orgId: OrgId.parse(body.orgId) }, ctx(request));
      return reply.status(201).send(created);
    });

    app.get('/apps', async (request) => {
      const { orgId } = parseInput(listQuery, request.query);
      return useCases.queries.listByOrg(OrgId.parse(orgId));
    });

    app.get('/apps/:appId', async (request) => {
      const { appId } = parseInput(appParams, request.params);
      return useCases.queries.get(AppId.parse(appId));
    });

    app.post('/apps/:appId/approve', async (request) => {
      const { appId } = parseInput(appParams, request.params);
      const grant = parseInput(approveBody, request.body);
      return useCases.approveApp.execute({ appId: AppId.parse(appId), grant }, ctx(request));
    });

    app.post('/apps/:appId/:action', async (request) => {
      const { appId, action } = parseInput(transitionParams, request.params);
      const { reason } = parseInput(reasonBody, request.body ?? {});
      return useCases.transitionApp.execute(
        { appId: AppId.parse(appId), transition: TRANSITIONS[action]!, reason },
        ctx(request),
      );
    });

    app.get('/apps/:appId/secrets', async (request) => {
      const { appId } = parseInput(appParams, request.params);
      return useCases.queries.listSecrets(AppId.parse(appId));
    });

    // Response DUY NHẤT chứa plaintext API key (UC-001 BR-4) — không cache.
    app.post('/apps/:appId/secrets', async (request, reply) => {
      const { appId } = parseInput(appParams, request.params);
      const issued = await useCases.issueAppSecret.execute({ appId: AppId.parse(appId) }, ctx(request));
      return reply.status(201).header('cache-control', 'no-store').send(issued);
    });

    app.delete('/apps/:appId/secrets/:secretId', async (request) => {
      const { appId, secretId } = parseInput(secretParams, request.params);
      return useCases.revokeAppSecret.execute(
        { appId: AppId.parse(appId), secretId: AppSecretId.parse(secretId) },
        ctx(request),
      );
    });

    app.get('/apps/:appId/network-rules', async (request) => {
      const { appId } = parseInput(appParams, request.params);
      return useCases.queries.listNetworkRules(AppId.parse(appId));
    });

    app.post('/apps/:appId/network-rules', async (request, reply) => {
      const { appId } = parseInput(appParams, request.params);
      const rule = parseInput(ruleBody, request.body);
      return reply.status(201).send(await useCases.addNetworkRule.execute({ appId: AppId.parse(appId), ...rule }, ctx(request)));
    });

    app.delete('/apps/:appId/network-rules', async (request, reply) => {
      const { appId } = parseInput(appParams, request.params);
      const rule = parseInput(ruleBody, request.query);
      await useCases.removeNetworkRule.execute({ appId: AppId.parse(appId), ...rule }, ctx(request));
      return reply.status(204).send();
    });
  };
}
