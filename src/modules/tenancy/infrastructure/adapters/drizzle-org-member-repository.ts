import { and, count, eq } from 'drizzle-orm';
import type { TransactionContext } from '../../../../shared/db/index.ts';
import { AccountId, AdminId, OrgId, type AdminId as AdminIdType, type OrgId as OrgIdType } from '../../../../shared/kernel/index.ts';
import type { OrgMemberRepository } from '../../application/ports/index.ts';
import { OrgMember } from '../../domain/entities/org-member.ts';
import { orgMembers } from '../db/schema.ts';

export class DrizzleOrgMemberRepository implements OrgMemberRepository {
  private readonly transactions: TransactionContext;

  constructor(deps: { transactions: TransactionContext }) {
    this.transactions = deps.transactions;
  }

  async find(orgId: OrgIdType, adminId: AdminIdType): Promise<OrgMember | null> {
    const [row] = await this.transactions
      .executor()
      .select()
      .from(orgMembers)
      .where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.adminId, adminId)));
    return row ? toEntity(row) : null;
  }

  async listByAdmin(adminId: AdminIdType): Promise<OrgMember[]> {
    const rows = await this.transactions.executor().select().from(orgMembers).where(eq(orgMembers.adminId, adminId));
    return rows.map(toEntity);
  }

  async countOwners(orgId: OrgIdType): Promise<number> {
    const [row] = await this.transactions
      .executor()
      .select({ total: count() })
      .from(orgMembers)
      .where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.role, 'owner')));
    return row?.total ?? 0;
  }

  async save(member: OrgMember): Promise<void> {
    await this.transactions
      .executor()
      .insert(orgMembers)
      .values({
        orgId: member.orgId,
        adminId: member.adminId,
        accountId: member.accountId,
        role: member.role,
        createdAt: member.createdAt,
        updatedAt: member.updatedAt,
      })
      .onDuplicateKeyUpdate({ set: { role: member.role, updatedAt: member.updatedAt } });
  }
}

function toEntity(row: typeof orgMembers.$inferSelect): OrgMember {
  return new OrgMember({
    orgId: OrgId.parse(row.orgId),
    adminId: AdminId.parse(row.adminId),
    accountId: AccountId.parse(row.accountId),
    role: row.role,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}
