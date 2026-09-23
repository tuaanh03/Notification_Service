import { eq } from 'drizzle-orm';
import type { TransactionContext } from '../../../../shared/db/index.ts';
import {
  AdminId,
  AdminSessionId,
  type AdminId as AdminIdType,
  type AdminSessionId as AdminSessionIdType,
} from '../../../../shared/kernel/index.ts';
import type { AdminSessionRepository } from '../../application/ports/index.ts';
import { AdminSession } from '../../domain/entities/admin-session.ts';
import { adminSessions } from '../db/schema.ts';

export class DrizzleAdminSessionRepository implements AdminSessionRepository {
  private readonly transactions: TransactionContext;

  constructor(deps: { transactions: TransactionContext }) {
    this.transactions = deps.transactions;
  }

  async insert(session: AdminSession): Promise<void> {
    await this.transactions.executor().insert(adminSessions).values({
      sessionId: session.id,
      adminId: session.adminId,
      tokenHash: session.tokenHash,
      expiresAt: session.expiresAt,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
    });
  }

  async findByTokenHash(tokenHash: string): Promise<AdminSession | null> {
    const [row] = await this.transactions
      .executor()
      .select()
      .from(adminSessions)
      .where(eq(adminSessions.tokenHash, tokenHash));
    return row
      ? new AdminSession({
          id: AdminSessionId.parse(row.sessionId),
          adminId: AdminId.parse(row.adminId),
          tokenHash: row.tokenHash,
          expiresAt: row.expiresAt,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
        })
      : null;
  }

  async deleteById(id: AdminSessionIdType): Promise<void> {
    await this.transactions.executor().delete(adminSessions).where(eq(adminSessions.sessionId, id));
  }

  async deleteByAdmin(adminId: AdminIdType): Promise<void> {
    await this.transactions.executor().delete(adminSessions).where(eq(adminSessions.adminId, adminId));
  }
}
