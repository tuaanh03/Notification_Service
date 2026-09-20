import { z } from 'zod';
import type { CommandContext } from '../../../../shared/application/index.ts';
import { adminCaller, EXTERNAL_ID, parseInput, type HttpRoutes } from '../../../../shared/http/index.ts';
import { AppId, TOPIC_DEFAULT_MODES } from '../../../../shared/kernel/index.ts';
import type { CreateTopic, GetUserPreferences, TopicQueries, TransitionTopic } from '../../application/index.ts';

/** Key dùng trong API gửi (`topic: "order_updates"`): chữ thường, số, `_ . -`, bắt đầu bằng chữ. */
export const TOPIC_KEY = z.string().regex(/^[a-z][a-z0-9_.-]{1,127}$/, 'lowercase letters, digits and _ . -, 2-128 chars');

const appParams = z.object({ appId: z.string().uuid() });
const actionParams = appParams.extend({ key: TOPIC_KEY, action: z.enum(['activate', 'suspend']) });
const userParams = appParams.extend({ externalId: EXTERNAL_ID });
const createBody = z
  .object({
    key: TOPIC_KEY,
    name: z.string().trim().min(1).max(200),
    mandatory: z.boolean().default(false),
    defaultMode: z.enum(TOPIC_DEFAULT_MODES).default('opt_out'),
  })
  .strict();

/** `/admin/apps/:appId/topics` — CHỈ admin tạo topic và đặt `mandatory` (ADR-0016 D6). */
export function adminTopicsRoutes(useCases: {
  createTopic: CreateTopic;
  transitionTopic: TransitionTopic;
  queries: TopicQueries;
  getUserPreferences: GetUserPreferences;
}): HttpRoutes {
  return (app) => {
    const ctx = (request: Parameters<typeof adminCaller>[0]): CommandContext => ({
      actor: { id: adminCaller(request).adminId, type: 'admin' },
      source: 'admin_api',
    });

    app.post('/apps/:appId/topics', async (request, reply) => {
      const { appId } = parseInput(appParams, request.params);
      const body = parseInput(createBody, request.body);
      return reply.status(201).send(await useCases.createTopic.execute({ appId: AppId.parse(appId), ...body }, ctx(request)));
    });

    app.get('/apps/:appId/topics', async (request) => {
      const { appId } = parseInput(appParams, request.params);
      return useCases.queries.listForAdmin(AppId.parse(appId));
    });

    app.post('/apps/:appId/topics/:key/:action', async (request) => {
      const { appId, key, action } = parseInput(actionParams, request.params);
      return useCases.transitionTopic.execute({ appId: AppId.parse(appId), key, transition: action }, ctx(request));
    });

    /*
     * Bề mặt ĐỌC cho vận hành (plan §5, ĐX-0004): cài đặt nhận tin của một người.
     *
     * Path nằm dưới `/users` nhưng thuộc module topics — cùng lý do với `/v1/users/:id/preferences`:
     * bề mặt HTTP không phải ranh giới module. Và đây là CÙNG use case mà `/v1` dùng, nên
     * `effectiveOptIn` hiện trên màn quản trị luôn khớp thứ worker tính lúc gửi (ADR-0010).
     *
     * KHÔNG có bản PUT ở đây: admin không sửa consent hộ người dùng.
     */
    app.get('/apps/:appId/users/:externalId/preferences', async (request) => {
      const { appId, externalId } = parseInput(userParams, request.params);
      return useCases.getUserPreferences.execute({ appId: AppId.parse(appId), externalId });
    });
  };
}
