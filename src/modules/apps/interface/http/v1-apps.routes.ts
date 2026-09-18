import { appCaller, type HttpRoutes } from '../../../../shared/http/index.ts';
import type { AppQueries } from '../../application/index.ts';

/**
 * `/v1/me` — app service kiểm tra key của mình còn dùng được không, và được cấp những gì.
 * Tới đây request ĐÃ qua xác thực API key + allowlist (hook của bề mặt `/v1`).
 */
export function v1AppsRoutes(useCases: { queries: AppQueries }): HttpRoutes {
  return (app) => {
    app.get('/me', async (request) => {
      const caller = appCaller(request);
      const current = await useCases.queries.get(caller.appId);
      return {
        appId: current.id,
        orgId: current.orgId,
        slug: current.slug,
        name: current.name,
        status: current.status,
        grantedChannels: current.grantedChannels,
        rateLimitPerMinute: current.rateLimitPerMinute,
        maxRecipientsPerEvent: current.maxRecipientsPerEvent,
      };
    });
  };
}
