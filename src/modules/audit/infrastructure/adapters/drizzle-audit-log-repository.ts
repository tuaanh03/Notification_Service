import { and, desc, eq } from 'drizzle-orm';
import type { TransactionContext } from '../../../../shared/db/index.ts';
import { AuditId } from '../../../../shared/kernel/index.ts';
import type { AuditLogRepository } from '../../application/ports/index.ts';
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
    return rows.map(
      (row) =>
        new AuditEntry({
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
        }),
    );
  }
}
