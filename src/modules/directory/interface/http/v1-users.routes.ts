import { z } from 'zod';
import type { CommandContext } from '../../../../shared/application/index.ts';
import { appCaller, EXTERNAL_ID, parseInput, type HttpRoutes } from '../../../../shared/http/index.ts';
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
    app.put('/users/:externalId', async (request, reply) => {
      const caller = appCaller(request);
      const { externalId } = parseInput(params, request.params);
      const { email } = parseInput(upsertBody, request.body ?? {});
      const { created, ...user } = await useCases.upsertUser.execute(
        { appId: caller.appId, orgId: caller.orgId, externalId, email },
        ctx(caller.appId),
      );
      return reply.status(created ? 201 : 200).send(user);
    });

    app.get('/users/:externalId', async (request) => {
      const caller = appCaller(request);
      const { externalId } = parseInput(params, request.params);
      return useCases.findUser.get({ appId: caller.appId, externalId });
    });

    app.delete('/users/:externalId/email', async (request) => {
      const caller = appCaller(request);
      const { externalId } = parseInput(params, request.params);
      return useCases.unsubscribeUserEmail.execute({ appId: caller.appId, externalId }, ctx(caller.appId));
    });
  };
}
