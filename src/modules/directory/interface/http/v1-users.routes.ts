import { z } from 'zod';
import type { CommandContext } from '../../../../shared/application/index.ts';
import { appCaller, doc, EXTERNAL_ID, parseInput, type HttpRoutes } from '../../../../shared/http/index.ts';
import type { FindUserByExternalId, UnsubscribeUserEmail, UpsertUser } from '../../application/index.ts';

const params = z.object({ externalId: EXTERNAL_ID });
// Email đúng định dạng do domain kiểm (normalizeEmail -> EMAIL_INVALID); ở đây chỉ giới hạn độ dài.
const upsertBody = z.object({ email: z.string().max(320).optional() }).strict();

/**
 * `/v1/users/:externalId` — app service đồng bộ user của nó. Mọi thao tác nằm trong phạm vi app đang
 * gọi (`appCaller`): external_id của app khác không bao giờ thấy được.
 */
export function v1UsersRoutes(useCases: {
  upsertUser: UpsertUser;
  findUser: FindUserByExternalId;
  unsubscribeUserEmail: UnsubscribeUserEmail;
}): HttpRoutes {
  return (app) => {
    const ctx = (appId: string): CommandContext => ({ actor: { id: appId, type: 'app' }, source: 'v1_api' });

    // PUT idempotent: tạo mới -> 201, đã có -> 200 (RFC 9110 §9.3.4).
    app.put(
      '/users/:externalId',
      {
        config: doc({
          tag: 'v1',
          summary: 'Declare a user of your app (create or update), optionally with their email.',
          description:
            'Idempotent: 201 when the user is created (or restored after being deleted on the console), 200 when it already existed. Omit `email` to keep the current one. One address belongs to one user per app (409 `EMAIL_TAKEN`). An address the user unsubscribed from stays unsubscribed when the address changes; sending the same old address again re-subscribes.',
          params,
          body: upsertBody,
          example: { email: 'an.nguyen@company.com' },
          responseDto: 'UserDto',
          errors: [
            { status: 409, code: 'EMAIL_TAKEN' },
            { status: 422, code: 'EMAIL_INVALID' },
          ],
        }),
      },
      async (request, reply) => {
        const caller = appCaller(request);
        const { externalId } = parseInput(params, request.params);
        const { email } = parseInput(upsertBody, request.body ?? {});
        const { created, ...user } = await useCases.upsertUser.execute(
          { appId: caller.appId, orgId: caller.orgId, externalId, email },
          ctx(caller.appId),
        );
        return reply.status(created ? 201 : 200).send(user);
      },
    );

    app.get(
      '/users/:externalId',
      {
        config: doc({ tag: 'v1', summary: 'Get one user of your app with their email status.', params, responseDto: 'UserDto', errors: [{ status: 404, code: 'NOT_FOUND' }] }),
      },
      async (request) => {
        const caller = appCaller(request);
        const { externalId } = parseInput(params, request.params);
        return useCases.findUser.get({ appId: caller.appId, externalId });
      },
    );

    app.delete(
      '/users/:externalId/email',
      {
        config: doc({
          tag: 'v1',
          summary: 'Stop all email to a user (e.g. they left the company).',
          description:
            'The address becomes `unsubscribed` and blocks every email, mandatory ones included. Calling again changes nothing. To re-enable, `PUT /v1/users/{externalId}` with the same address. 404 also when the user has no email.',
          params,
          responseDto: 'UserDto',
          errors: [{ status: 404, code: 'NOT_FOUND' }],
        }),
      },
      async (request) => {
        const caller = appCaller(request);
        const { externalId } = parseInput(params, request.params);
        return useCases.unsubscribeUserEmail.execute({ appId: caller.appId, externalId }, ctx(caller.appId));
      },
    );
  };
}
