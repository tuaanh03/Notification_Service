import { z } from 'zod';
import type { CommandContext } from '../../../../shared/application/index.ts';
import { access, adminCaller, parseInput, type HttpRoutes } from '../../../../shared/http/index.ts';
import { AccountId, AdminId, NotFoundError, OrgId } from '../../../../shared/kernel/index.ts';
import type { CreateAccount, CreateOrganization, CreateOwnOrganization, FindOrganization } from '../../application/index.ts';

const nameBody = z.object({ name: z.string().trim().min(1).max(200) }).strict();
const accountParams = z.object({ accountId: z.string().uuid() });
const orgParams = z.object({ orgId: z.string().uuid() });

/**
 * `/admin/accounts`, `/admin/organizations` — tối thiểu để dựng tenant. Route chỉ làm ba việc:
 * parse input -> gọi use case -> trả DTO. Không có `if` nghiệp vụ ở đây.
 */
export function adminTenancyRoutes(useCases: {
  createAccount: CreateAccount;
  createOrganization: CreateOrganization;
  createOwnOrganization: CreateOwnOrganization;
  findOrganization: FindOrganization;
}): HttpRoutes {
  return (app) => {
    const ctx = (request: Parameters<typeof adminCaller>[0]): CommandContext => ({
      actor: { id: adminCaller(request).adminId, type: 'admin' },
      source: 'admin_api',
    });

    app.post('/accounts', { config: access('platform.manage') }, async (request, reply) => {
      const body = parseInput(nameBody, request.body);
      return reply.status(201).send(await useCases.createAccount.execute(body, ctx(request)));
    });

    app.post('/accounts/:accountId/organizations', { config: access('platform.manage') }, async (request, reply) => {
      const { accountId } = parseInput(accountParams, request.params);
      const body = parseInput(nameBody, request.body);
      const org = await useCases.createOrganization.execute(
        { accountId: AccountId.parse(accountId), name: body.name },
        ctx(request),
      );
      return reply.status(201).send(org);
    });

    // Org tự phục vụ (ADR-0025): ai đăng nhập cũng tạo được, người tạo thành Owner.
    app.post('/organizations', { config: access('org.create') }, async (request, reply) => {
      const body = parseInput(nameBody, request.body);
      const org = await useCases.createOwnOrganization.execute(
        { adminId: AdminId.parse(adminCaller(request).adminId), name: body.name },
        ctx(request),
      );
      return reply.status(201).send(org);
    });

    app.get('/organizations/:orgId', { config: access('org.read') }, async (request) => {
      const { orgId } = parseInput(orgParams, request.params);
      const org = await useCases.findOrganization.execute(OrgId.parse(orgId));
      if (!org) throw new NotFoundError('organization', orgId);
      return org;
    });
  };
}
