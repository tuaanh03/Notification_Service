import { z } from 'zod';
import { access, adminContext, doc, parseInput, requireSession, type HttpRoutes } from '../../../../shared/http/index.ts';
import { AdminId, PAT_SCOPES, PersonalAccessTokenId } from '../../../../shared/kernel/index.ts';
import type { CreatePersonalAccessToken, RevokePersonalAccessToken } from '../../application/commands/index.ts';
import type { ListAllPersonalAccessTokens, ListPersonalAccessTokens } from '../../application/queries/index.ts';

const createBody = z
  .object({
    name: z.string().trim().min(1).max(100),
    scope: z.enum(PAT_SCOPES),
    // Trần thật là cài đặt hệ thống `pat.max_lifetime_days` — kiểm ở command; 3650 chỉ chặn số vô lý ở biên.
    expiresInDays: z.number().int().min(1).max(3650),
  })
  .strict();
const tokenParams = z.object({ tokenId: z.string().uuid() });
const listQuery = z.object({ status: z.enum(['active', 'all']).default('active') });

/**
 * Personal access token (ADR-0044). Mọi route CHỈ nhận phiên đăng nhập (`requireSession`) — PAT không quản lý được PAT.
 * `/me/tokens*`: của chính mình (`self.read` — ai đăng nhập cũng có). `/personal-access-tokens*`: Super Admin.
 */
export function personalAccessTokenRoutes(useCases: {
  create: CreatePersonalAccessToken;
  revoke: RevokePersonalAccessToken;
  listOwn: ListPersonalAccessTokens;
  listAll: ListAllPersonalAccessTokens;
}): HttpRoutes {
  return (app) => {
    const tag = 'personal-access-tokens';
    const notFound = [{ status: 404, code: 'NOT_FOUND' }];

    app.get(
      '/me/tokens',
      {
        config: {
          ...access('self.read'),
          ...doc({
            tag,
            summary: 'List your personal access tokens (incl. revoked / expired in the last 30 days).',
            responseDto: 'PersonalAccessTokenDto[]',
            sessionOnly: true,
          }),
        },
      },
      async (request, reply) => {
        const caller = requireSession(request);
        return reply.header('cache-control', 'no-store').send(await useCases.listOwn.execute(AdminId.parse(caller.adminId)));
      },
    );

    app.post(
      '/me/tokens',
      {
        config: {
          ...access('self.read'),
          ...doc({
            tag,
            summary: 'Create a personal access token. The secret is returned once.',
            body: createBody,
            example: { name: 'CI deploy', scope: 'write', expiresInDays: 90 },
            status: 201,
            responseDto: 'IssuedPersonalAccessTokenDto',
            errors: [
              { status: 422, code: 'PAT_LIMIT_REACHED' },
              { status: 422, code: 'PAT_LIFETIME_TOO_LONG' },
            ],
            sessionOnly: true,
          }),
        },
      },
      async (request, reply) => {
        const caller = requireSession(request);
        const body = parseInput(createBody, request.body);
        const issued = await useCases.create.execute({ adminId: AdminId.parse(caller.adminId), ...body }, adminContext(request));
        // Token gốc chỉ sống trong response này.
        return reply.status(201).header('cache-control', 'no-store').send(issued);
      },
    );

    app.delete(
      '/me/tokens/:tokenId',
      {
        config: {
          ...access('self.read'),
          ...doc({ tag, summary: 'Revoke one of your tokens. Revoking twice is a no-op.', params: tokenParams, status: 204, errors: notFound, sessionOnly: true }),
        },
      },
      async (request, reply) => {
        const caller = requireSession(request);
        const { tokenId } = parseInput(tokenParams, request.params);
        await useCases.revoke.execute({ tokenId: PersonalAccessTokenId.parse(tokenId), ownerId: AdminId.parse(caller.adminId) }, adminContext(request));
        return reply.status(204).send();
      },
    );

    app.get(
      '/personal-access-tokens',
      {
        config: {
          ...access('platform.manage'),
          ...doc({ tag, summary: 'Super Admin: tokens of everyone, with their owner.', query: listQuery, responseDto: 'AdminPersonalAccessTokenDto[]', sessionOnly: true }),
        },
      },
      async (request, reply) => {
        requireSession(request);
        const query = parseInput(listQuery, request.query);
        return reply.header('cache-control', 'no-store').send(await useCases.listAll.execute(query));
      },
    );

    app.delete(
      '/personal-access-tokens/:tokenId',
      {
        config: {
          ...access('platform.manage'),
          ...doc({ tag, summary: "Super Admin: revoke anyone's token (e.g. a leaked one).", params: tokenParams, status: 204, errors: notFound, sessionOnly: true }),
        },
      },
      async (request, reply) => {
        requireSession(request);
        const { tokenId } = parseInput(tokenParams, request.params);
        await useCases.revoke.execute({ tokenId: PersonalAccessTokenId.parse(tokenId), ownerId: null }, adminContext(request));
        return reply.status(204).send();
      },
    );
  };
}
