import { z } from 'zod';
import { parseInput, type HttpRoutes } from '../../../../shared/http/index.ts';
import type { AuditQueries } from '../../application/index.ts';

const query = z.object({
  targetType: z.string().min(1).max(64),
  targetId: z.string().min(1).max(64),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

/** `/admin/audit?targetType=App&targetId=<id>` — nguồn cho `<AuditTrail>` trên console. */
export function adminAuditRoutes(useCases: { queries: AuditQueries }): HttpRoutes {
  return (app) => {
    app.get('/audit', async (request) => {
      const { targetType, targetId, limit } = parseInput(query, request.query);
      return useCases.queries.listByTarget(targetType, targetId, limit);
    });
  };
}
