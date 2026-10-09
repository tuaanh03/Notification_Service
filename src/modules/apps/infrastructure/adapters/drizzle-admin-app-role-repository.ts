import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { TransactionContext } from '../../../../shared/db/index.ts';
import type { AdminId, AppId, AppRole, OrgId } from '../../../../shared/kernel/index.ts';
import type { AdminAppRoleRepository } from '../../application/ports/index.ts';
import type { AdminAppRole } from '../../domain/entities/admin-app-role.ts';
import { adminAppRoles, apps } from '../db/schema.ts';

type UpdateResult = [{ affectedRows: number }, unknown];

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

  async listByOrg(orgId: OrgId): Promise<{ adminId: string; appId: string; role: AppRole }[]> {
    return this.transactions
      .executor()
      .select({ adminId: adminAppRoles.adminId, appId: adminAppRoles.appId, role: adminAppRoles.role })
      .from(adminAppRoles)
      .innerJoin(apps, eq(apps.appId, adminAppRoles.appId))
      .where(and(eq(apps.orgId, orgId), isNull(adminAppRoles.revokedAt)));
  }

  async revoke(adminId: AdminId, appId: AppId, at: Date): Promise<boolean> {
    const [result] = (await this.transactions
      .executor()
      .update(adminAppRoles)
      .set({ revokedAt: at })
      .where(
        and(eq(adminAppRoles.adminId, adminId), eq(adminAppRoles.appId, appId), isNull(adminAppRoles.revokedAt)),
      )) as unknown as UpdateResult;
    return result.affectedRows === 1;
  }

  async revokeAllInOrg(adminId: AdminId, orgId: OrgId, at: Date): Promise<string[]> {
    const db = this.transactions.executor();
    const rows = await db
      .select({ appId: adminAppRoles.appId })
      .from(adminAppRoles)
      .innerJoin(apps, eq(apps.appId, adminAppRoles.appId))
      .where(and(eq(adminAppRoles.adminId, adminId), eq(apps.orgId, orgId), isNull(adminAppRoles.revokedAt)));
    const appIds = rows.map((r) => r.appId);
    if (appIds.length === 0) return [];
    await db
      .update(adminAppRoles)
      .set({ revokedAt: at })
      .where(and(eq(adminAppRoles.adminId, adminId), inArray(adminAppRoles.appId, appIds), isNull(adminAppRoles.revokedAt)));
    return appIds;
  }
}
