import { and, eq, isNull } from 'drizzle-orm';
import type { TransactionContext } from '../../../../shared/db/index.ts';
import type { AdminId, AppRole } from '../../../../shared/kernel/index.ts';
import type { AdminAppRoleRepository } from '../../application/ports/index.ts';
import type { AdminAppRole } from '../../domain/entities/admin-app-role.ts';
import { adminAppRoles } from '../db/schema.ts';

export class DrizzleAdminAppRoleRepository implements AdminAppRoleRepository {
  private readonly transactions: TransactionContext;

  constructor(deps: { transactions: TransactionContext }) {
    this.transactions = deps.transactions;
  }

  async listByAdmin(adminId: AdminId): Promise<{ appId: string; role: AppRole }[]> {
    return this.transactions
      .executor()
      .select({ appId: adminAppRoles.appId, role: adminAppRoles.role })
      .from(adminAppRoles)
      .where(and(eq(adminAppRoles.adminId, adminId), isNull(adminAppRoles.revokedAt)));
  }

  async save(role: AdminAppRole): Promise<void> {
    await this.transactions
      .executor()
      .insert(adminAppRoles)
      .values({ adminId: role.adminId, appId: role.appId, accountId: role.accountId, role: role.role, grantedAt: role.grantedAt })
      .onDuplicateKeyUpdate({ set: { role: role.role, grantedAt: role.grantedAt, revokedAt: null } });
  }
}
