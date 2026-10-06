import { and, count, eq, isNull } from 'drizzle-orm';
import type { TransactionContext } from '../../../../shared/db/index.ts';
import {
  AccountId,
  AdminId,
  type AccountId as AccountIdType,
  type AdminId as AdminIdType,
  type NormalizedEmail,
} from '../../../../shared/kernel/index.ts';
import type { AdminRepository } from '../../application/ports/index.ts';
import { Admin } from '../../domain/entities/admin.ts';
import { admins } from '../db/schema.ts';

type UpdateResult = [{ affectedRows: number }, unknown];

export class DrizzleAdminRepository implements AdminRepository {
  private readonly transactions: TransactionContext;

  constructor(deps: { transactions: TransactionContext }) {
    this.transactions = deps.transactions;
  }

  async findById(id: AdminIdType): Promise<Admin | null> {
    const [row] = await this.transactions.executor().select().from(admins).where(eq(admins.adminId, id));
    return row ? toEntity(row) : null;
  }

  async findByEmail(email: NormalizedEmail): Promise<Admin | null> {
    const [row] = await this.transactions.executor().select().from(admins).where(eq(admins.email, email));
    return row ? toEntity(row) : null;
  }

  async findByMicrosoftOid(oid: string): Promise<Admin | null> {
    const [row] = await this.transactions.executor().select().from(admins).where(eq(admins.microsoftOid, oid));
    return row ? toEntity(row) : null;
  }

  async insert(admin: Admin): Promise<void> {
    await this.transactions.executor().insert(admins).values({
      adminId: admin.id,
      accountId: admin.accountId,
      email: admin.email,
      role: admin.role,
      passwordHash: admin.passwordHash,
      microsoftOid: admin.microsoftOid,
      createdAt: admin.createdAt,
      updatedAt: admin.updatedAt,
    });
  }

  async updatePassword(admin: Admin): Promise<void> {
    await this.transactions
      .executor()
      .update(admins)
      .set({ passwordHash: admin.passwordHash, updatedAt: admin.updatedAt })
      .where(eq(admins.adminId, admin.id));
  }

  async linkMicrosoft(admin: Admin): Promise<boolean> {
    const [result] = (await this.transactions
      .executor()
      .update(admins)
      .set({ microsoftOid: admin.microsoftOid, updatedAt: admin.updatedAt })
      .where(and(eq(admins.adminId, admin.id), isNull(admins.microsoftOid)))) as unknown as UpdateResult;
    return result.affectedRows === 1;
  }

  async countByAccount(accountId: AccountIdType): Promise<number> {
    const [row] = await this.transactions
      .executor()
      .select({ total: count() })
      .from(admins)
      .where(eq(admins.accountId, accountId));
    return row?.total ?? 0;
  }
}

function toEntity(row: typeof admins.$inferSelect): Admin {
  return new Admin({
    id: AdminId.parse(row.adminId),
    accountId: AccountId.parse(row.accountId),
    email: row.email,
    role: row.role,
    passwordHash: row.passwordHash,
    microsoftOid: row.microsoftOid,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}
