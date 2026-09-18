import { eq } from 'drizzle-orm';
import type { TransactionContext } from '../../../../shared/db/index.ts';
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
    return row
      ? new Organization({
          id: OrgId.parse(row.orgId),
          accountId: AccountId.parse(row.accountId),
          name: row.name,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
        })
      : null;
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
}
