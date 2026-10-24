import { z } from 'zod';
import type { CommandContext } from '../../../../shared/application/index.ts';
import { appCaller, doc, EXTERNAL_ID, parseInput, type HttpRoutes } from '../../../../shared/http/index.ts';
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
    app.get(
      '/topics',
      {
        config: doc({
          tag: 'v1',
          summary: 'List the active topics of your app (the `topic` keys you can send to).',
          description: 'Topics are created by admins on the console; apps cannot create them.',
          responseDto: 'PublicTopicDto[]',
        }),
      },
      async (request) => useCases.queries.listActive(appCaller(request).appId),
    );

    app.get(
      '/users/:externalId/preferences',
      {
        config: doc({
          tag: 'v1',
          summary: "Read one user's notification preferences, to draw your app's settings screen.",
          description:
            '`optedIn` = what the user chose (`null` = not chosen yet, follows `defaultMode`). `effectiveOptIn` = whether the topic layer lets email through — use it for the switch state. `mandatory` topics cannot be turned off: show a locked switch.',
          params: userParams,
          responseDto: 'UserPreferencesDto',
          errors: [{ status: 404, code: 'NOT_FOUND' }],
        }),
      },
      async (request) => {
        const { externalId } = parseInput(userParams, request.params);
        return useCases.getUserPreferences.execute({ appId: appCaller(request).appId, externalId });
      },
    );

    app.put(
      '/users/:externalId/preferences',
      {
        config: doc({
          tag: 'v1',
          summary: "Save one user's choices: per topic on/off and/or all optional messages off.",
          description:
            'Both fields are optional. Everything is checked before anything is saved: one bad topic rejects the whole request. `optedOutOptional: true` turns off every non-mandatory topic at once. Returns the preferences after the change.',
          params: userParams,
          body: preferencesBody,
          example: { topics: { order_updates: false }, optedOutOptional: false },
          responseDto: 'UserPreferencesDto',
          errors: [
            { status: 404, code: 'NOT_FOUND' },
            { status: 422, code: 'TOPIC_NOT_FOUND' },
            { status: 422, code: 'TOPIC_MANDATORY' },
            { status: 422, code: 'EMAIL_NOT_SET' },
          ],
        }),
      },
      async (request) => {
        const caller = appCaller(request);
        const { externalId } = parseInput(userParams, request.params);
        const body = parseInput(preferencesBody, request.body ?? {});
        const ctx: CommandContext = { actor: { id: caller.appId, type: 'app' }, source: 'v1_api' };
        return useCases.setUserPreferences.execute({ appId: caller.appId, externalId, ...body }, ctx);
      },
    );
  };
}
