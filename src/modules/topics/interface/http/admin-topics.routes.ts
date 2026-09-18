import { z } from 'zod';
import type { CommandContext } from '../../../../shared/application/index.ts';
import { adminCaller, parseInput, type HttpRoutes } from '../../../../shared/http/index.ts';
import { AppId, TOPIC_DEFAULT_MODES } from '../../../../shared/kernel/index.ts';
import type { CreateTopic, TopicQueries, TransitionTopic } from '../../application/index.ts';

/** Key dùng trong API gửi (`topic: "order_updates"`): chữ thường, số, `_ . -`, bắt đầu bằng chữ. */
export const TOPIC_KEY = z.string().regex(/^[a-z][a-z0-9_.-]{1,127}$/, 'lowercase letters, digits and _ . -, 2-128 chars');

const appParams = z.object({ appId: z.string().uuid() });
const actionParams = appParams.extend({ key: TOPIC_KEY, action: z.enum(['activate', 'suspend']) });
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
  };
}
