import { and, asc, count, desc, eq, inArray, isNotNull, isNull, like, or, sql, type SQL } from 'drizzle-orm';
import { isDuplicateKeyError, type TransactionContext } from '../../../../shared/db/index.ts';
import {
  AccountId,
  AdminId,
  type AccountId as AccountIdType,
  type AdminId as AdminIdType,
  type NormalizedEmail,
} from '../../../../shared/kernel/index.ts';
import type { AdminPage, AdminRepository } from '../../application/ports/index.ts';
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

  async findManyByIds(ids: readonly AdminIdType[]): Promise<Admin[]> {
    if (ids.length === 0) return [];
    const rows = await this.transactions.executor().select().from(admins).where(inArray(admins.adminId, [...ids]));
    return rows.map(toEntity);
  }

  async findManyByEmails(emails: readonly NormalizedEmail[]): Promise<Admin[]> {
    if (emails.length === 0) return [];
    const rows = await this.transactions.executor().select().from(admins).where(inArray(admins.email, [...emails]));
    return rows.map(toEntity);
  }

  async listLocked(): Promise<Admin[]> {
    const rows = await this.transactions.executor().select().from(admins).where(isNotNull(admins.lockedAt)).orderBy(desc(admins.lockedAt));
    return rows.map(toEntity);
  }

  async updateLock(admin: Admin): Promise<void> {
    await this.transactions
      .executor()
      .update(admins)
      .set({ lockedAt: admin.lockedAt, updatedAt: admin.updatedAt })
      .where(eq(admins.adminId, admin.id));
  }

  async listByAccount(accountId: AccountIdType): Promise<Admin[]> {
    const rows = await this.transactions.executor().select().from(admins).where(eq(admins.accountId, accountId));
    return rows.map(toEntity);
  }

  async listPage(page: { limit: number; offset: number; search?: string | undefined; listed?: boolean | undefined }): Promise<AdminPage> {
    const search = page.search?.trim();
    const filters: SQL[] = [];
    // `like` như màn người nhận: đủ cho danh bạ một công ty, không dựng full-text.
    if (search) filters.push(or(like(admins.email, `%${search}%`), like(admins.displayName, `%${search}%`))!);
    if (page.listed !== undefined) filters.push(eq(admins.memberListed, page.listed));
    const where = filters.length > 0 ? and(...filters) : undefined;
    const db = this.transactions.executor();
    const [rows, [totalRow]] = await Promise.all([
      db
        .select()
        .from(admins)
        .where(where)
        .orderBy(asc(sql`coalesce(${admins.displayName}, ${admins.email})`), asc(admins.email))
        .limit(page.limit)
        .offset(page.offset),
      db.select({ total: count() }).from(admins).where(where),
    ]);
    return { items: rows.map(toEntity), total: totalRow?.total ?? 0 };
  }

  async updateMemberListed(ids: readonly AdminIdType[], listed: boolean, at: Date): Promise<void> {
    if (ids.length === 0) return;
    await this.transactions
      .executor()
      .update(admins)
      .set({ memberListed: listed, updatedAt: at })
      .where(inArray(admins.adminId, [...ids]));
  }

  async insert(admin: Admin): Promise<void> {
    await this.transactions.executor().insert(admins).values({
      adminId: admin.id,
      accountId: admin.accountId,
      email: admin.email,
      role: admin.role,
      passwordHash: admin.passwordHash,
      microsoftOid: admin.microsoftOid,
      displayName: admin.displayName,
      memberListed: admin.memberListed,
      lockedAt: admin.lockedAt,
      createdAt: admin.createdAt,
      updatedAt: admin.updatedAt,
    });
  }

  async insertIfAbsent(admin: Admin): Promise<boolean> {
    try {
      await this.insert(admin);
      return true;
    } catch (err) {
      // MySQL chỉ huỷ CÂU lệnh trùng khoá, transaction đang mở vẫn dùng tiếp được.
      if (isDuplicateKeyError(err)) return false;
      throw err;
    }
  }

  async updateDisplayName(admin: Admin): Promise<void> {
    await this.transactions
      .executor()
      .update(admins)
      .set({ displayName: admin.displayName, updatedAt: admin.updatedAt })
      .where(eq(admins.adminId, admin.id));
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
    displayName: row.displayName,
    memberListed: row.memberListed,
    lockedAt: row.lockedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}
