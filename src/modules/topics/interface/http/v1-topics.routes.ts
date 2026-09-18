import { z } from 'zod';
import type { CommandContext } from '../../../../shared/application/index.ts';
import { appCaller, EXTERNAL_ID, parseInput, type HttpRoutes } from '../../../../shared/http/index.ts';
import type { GetUserPreferences, SetUserPreferences, TopicQueries } from '../../application/index.ts';
import { TOPIC_KEY } from './admin-topics.routes.ts';

const userParams = z.object({ externalId: EXTERNAL_ID });
const preferencesBody = z
  .object({
    optedOutOptional: z.boolean().optional(),
    topics: z.record(TOPIC_KEY, z.boolean()).optional(),
  })
  .strict();

/**
 * `/v1/topics` (chỉ đọc — app service không tạo topic) và `/v1/users/:externalId/preferences`.
 * Path nằm dưới `/users` nhưng thuộc module topics: bề mặt HTTP không phải ranh giới module.
 */
export function v1TopicsRoutes(useCases: {
  queries: TopicQueries;
  getUserPreferences: GetUserPreferences;
  setUserPreferences: SetUserPreferences;
}): HttpRoutes {
  return (app) => {
    app.get('/topics', async (request) => useCases.queries.listActive(appCaller(request).appId));

    app.get('/users/:externalId/preferences', async (request) => {
      const { externalId } = parseInput(userParams, request.params);
      return useCases.getUserPreferences.execute({ appId: appCaller(request).appId, externalId });
    });

    app.put('/users/:externalId/preferences', async (request) => {
      const caller = appCaller(request);
      const { externalId } = parseInput(userParams, request.params);
      const body = parseInput(preferencesBody, request.body ?? {});
      const ctx: CommandContext = { actor: { id: caller.appId, type: 'app' }, source: 'v1_api' };
      return useCases.setUserPreferences.execute({ appId: caller.appId, externalId, ...body }, ctx);
    });
  };
}
