import { z } from 'zod';
import { access, parseInput, type HttpRoutes, type RouteTarget } from '../../../../shared/http/index.ts';
import type { AuditQueries } from '../../application/index.ts';

const query = z.object({
  targetType: z.string().min(1).max(64),
  targetId: z.string().min(1).max(64),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

/** Lịch sử của một APP: ai xem được app thì xem được. Mọi loại đối tượng khác: chỉ Super Admin (ADR-0022). */
const targetOf = (request: { query: unknown }): { appId: string } | null => {
  const q = request.query as { targetType?: unknown; targetId?: unknown };
  return q.targetType === 'App' && typeof q.targetId === 'string' ? { appId: q.targetId } : null;
};
const auditAccess = access(
  (request) => (targetOf(request) ? 'app.read' : 'platform.manage'),
  (request): RouteTarget => {
    const app = targetOf(request);
    return app ? { kind: 'app', appId: app.appId } : { kind: 'none' };
  },
);

/** `/admin/audit?targetType=App&targetId=<id>` — nguồn cho `<AuditTrail>` trên console. */
export function adminAuditRoutes(useCases: { queries: AuditQueries }): HttpRoutes {
  return (app) => {
    app.get('/audit', { config: auditAccess }, async (request) => {
      const { targetType, targetId, limit } = parseInput(query, request.query);
      return useCases.queries.listByTarget(targetType, targetId, limit);
    });
  };
}
