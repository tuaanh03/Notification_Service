import { z } from 'zod';
import { access, doc, parseInput, type HttpRoutes, type RouteTarget } from '../../../../shared/http/index.ts';
import { parseAuditCursor, type AuditQueries } from '../../application/index.ts';

const query = z.object({
  targetType: z.string().min(1).max(64),
  targetId: z.string().min(1).max(64),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

const eventsQuery = z.object({
  /** Nhiều loại sự kiện, cách nhau bằng dấu phẩy (`LoginLocked,AdminLocked`). */
  action: z
    .string()
    .max(2000)
    .optional()
    .transform((v) => (v ? v.split(',').map((a) => a.trim()).filter(Boolean).slice(0, 30) : undefined)),
  actor: z.string().trim().min(1).max(64).optional(),
  targetType: z.string().trim().min(1).max(64).optional(),
  targetId: z.string().trim().min(1).max(64).optional(),
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
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

/**
 * `/admin/audit?targetType=App&targetId=<id>` — nguồn cho `<AuditTrail>` trên console.
 * `/admin/audit/events` — nhật ký chung, lọc + phân trang (chỉ Super Admin).
 */
export function adminAuditRoutes(useCases: { queries: AuditQueries }): HttpRoutes {
  return (app) => {
    app.get(
      '/audit',
      {
        config: {
          ...auditAccess,
          ...doc({
            tag: 'audit',
            summary: 'List the audit history of one object, newest first.',
            description: '`targetType=App` needs read access to that app; any other target type is Super Admin only.',
            query,
            responseDto: 'Array<AuditEntryDto & { actorEmail: string | null; actorName: string | null }>',
            errors: [{ status: 404, code: 'NOT_FOUND' }],
          }),
        },
      },
      async (request) => {
        const { targetType, targetId, limit } = parseInput(query, request.query);
        return useCases.queries.listByTarget(targetType, targetId, limit);
      },
    );

    // Nhật ký chung của cả hệ thống — chỉ Super Admin (màn Quản trị EWS -> Nhật ký hoạt động).
    app.get(
      '/audit/events',
      {
        config: {
          ...access('platform.manage'),
          ...doc({
            tag: 'audit',
            summary: 'Super Admin: search the system-wide audit log, newest first.',
            description:
              '`action` takes several event types separated by commas (at most 30). For the next page, pass the `nextCursor` of the previous response as `cursor`; `total` counts every match.',
            query: eventsQuery,
            responseDto: 'AuditEventPageDto',
          }),
        },
      },
      async (request, reply) => {
        const q = parseInput(eventsQuery, request.query);
        const page = await useCases.queries.search({
          actions: q.action,
          actor: q.actor,
          targetType: q.targetType,
          targetId: q.targetId,
          from: q.from ? new Date(q.from) : undefined,
          to: q.to ? new Date(q.to) : undefined,
          before: parseAuditCursor(q.cursor),
          limit: q.limit,
        });
        return reply.header('cache-control', 'no-store').send(page);
      },
    );
  };
}
