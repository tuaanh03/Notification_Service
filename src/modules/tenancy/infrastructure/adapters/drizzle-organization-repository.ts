import { asc, eq, inArray } from 'drizzle-orm';
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
      .where(eq(organizations.orgId, id));
    return row ? toEntity(row) : null;
  }

  async list(ids?: readonly OrgIdType[]): Promise<Organization[]> {
    if (ids !== undefined && ids.length === 0) return [];
    const query = this.transactions.executor().select().from(organizations);
    const rows = await (ids === undefined ? query : query.where(inArray(organizations.orgId, [...ids]))).orderBy(
      asc(organizations.name),
    );
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
