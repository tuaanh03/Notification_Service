import { and, count, desc, eq, gte, inArray, lt, or, type SQL } from 'drizzle-orm';
import type { TransactionContext } from '../../../../shared/db/index.ts';
import { AuditId } from '../../../../shared/kernel/index.ts';
import type { AuditLogRepository, AuditSearch } from '../../application/ports/index.ts';
import { AuditEntry } from '../../domain/entities/audit-entry.ts';
import { auditLog } from '../db/schema.ts';

export class DrizzleAuditLogRepository implements AuditLogRepository {
  private readonly transactions: TransactionContext;

  constructor(deps: { transactions: TransactionContext }) {
    this.transactions = deps.transactions;
  }

  async append(entry: AuditEntry): Promise<void> {
    await this.transactions.executor().insert(auditLog).values({
      auditId: entry.id,
      actor: entry.actor,
      actorType: entry.actorType,
      action: entry.action,
      targetType: entry.targetType,
      targetId: entry.targetId,
      beforeData: entry.before,
      afterData: entry.after,
      source: entry.source,
      at: entry.at,
    });
  }

  async listByTarget(targetType: string, targetId: string, limit: number): Promise<AuditEntry[]> {
    const rows = await this.transactions
      .executor()
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.targetType, targetType), eq(auditLog.targetId, targetId)))
      .orderBy(desc(auditLog.at))
      .limit(limit);
    return rows.map(toEntity);
  }

  async search(filter: AuditSearch): Promise<{ items: AuditEntry[]; total: number }> {
    const where: SQL[] = [];
    if (filter.actions && filter.actions.length > 0) where.push(inArray(auditLog.action, [...filter.actions]));
    if (filter.actor) where.push(eq(auditLog.actor, filter.actor));
    if (filter.targetType) where.push(eq(auditLog.targetType, filter.targetType));
    if (filter.targetId) where.push(eq(auditLog.targetId, filter.targetId));
    if (filter.from) where.push(gte(auditLog.at, filter.from));
    if (filter.to) where.push(lt(auditLog.at, filter.to));
    const page = filter.before
      ? [...where, or(lt(auditLog.at, filter.before.at), and(eq(auditLog.at, filter.before.at), lt(auditLog.auditId, filter.before.id)))!]
      : where;
    const db = this.transactions.executor();
    const [rows, [totalRow]] = await Promise.all([
      db
        .select()
        .from(auditLog)
        .where(page.length > 0 ? and(...page) : undefined)
        .orderBy(desc(auditLog.at), desc(auditLog.auditId))
        .limit(filter.limit),
      db.select({ total: count() }).from(auditLog).where(where.length > 0 ? and(...where) : undefined),
    ]);
    return { items: rows.map(toEntity), total: totalRow?.total ?? 0 };
  }
}

function toEntity(row: typeof auditLog.$inferSelect): AuditEntry {
  return new AuditEntry({
    id: AuditId.parse(row.auditId),
    actor: row.actor,
    actorType: row.actorType,
    action: row.action,
    targetType: row.targetType,
    targetId: row.targetId,
    before: row.beforeData ?? null,
    after: row.afterData ?? null,
    source: row.source,
    at: row.at,
  });
}
