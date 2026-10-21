import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { lockParentRow, type TransactionContext } from '../../../../shared/db/index.ts';
import { AccountId, OrgId, type OrgId as OrgIdType } from '../../../../shared/kernel/index.ts';
import type { OrganizationRepository } from '../../application/ports/index.ts';
import { Organization } from '../../domain/entities/organization.ts';
import { organizations } from '../db/schema.ts';

export class DrizzleOrganizationRepository implements OrganizationRepository {
  private readonly transactions: TransactionContext;

  constructor(deps: { transactions: TransactionContext }) {
    this.transactions = deps.transactions;
  }

  async findById(id: OrgIdType): Promise<Organization | null> {
    const [row] = await this.transactions
      .executor()
      .select()
      .from(organizations)
      .where(and(eq(organizations.orgId, id), isNull(organizations.deletedAt)));
    return row ? toEntity(row) : null;
  }

  async list(ids?: readonly OrgIdType[]): Promise<Organization[]> {
    if (ids !== undefined && ids.length === 0) return [];
    const live = isNull(organizations.deletedAt);
    const rows = await this.transactions
      .executor()
      .select()
      .from(organizations)
      .where(ids === undefined ? live : and(live, inArray(organizations.orgId, [...ids])))
      .orderBy(asc(organizations.name));
    return rows.map(toEntity);
  }

  async insert(org: Organization): Promise<void> {
    await this.transactions.executor().insert(organizations).values({
      orgId: org.id,
      accountId: org.accountId,
      name: org.name,
      createdAt: org.createdAt,
      updatedAt: org.updatedAt,
    });
  }

  async rename(org: Organization): Promise<void> {
    await this.transactions.executor().update(organizations).set({ name: org.name, updatedAt: org.updatedAt }).where(eq(organizations.orgId, org.id));
  }

  async markDeleted(id: OrgIdType, at: Date): Promise<void> {
    await this.transactions.executor().update(organizations).set({ deletedAt: at, updatedAt: at }).where(eq(organizations.orgId, id));
  }

  lockForUpdate(id: OrgIdType): Promise<boolean> {
    return lockParentRow(this.transactions.require('OrganizationRepository.lockForUpdate'), organizations, organizations.orgId, id);
  }
}

function toEntity(row: typeof organizations.$inferSelect): Organization {
  return new Organization({
    id: OrgId.parse(row.orgId),
    accountId: AccountId.parse(row.accountId),
    name: row.name,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}
