import { and, asc, eq } from 'drizzle-orm';
import { duplicateKeyName, lockParentRow, type TransactionContext } from '../../../../shared/db/index.ts';
import {
  ConcurrentTransitionError,
  ConflictError,
  type AppId,
  type AppStatus,
  type OrgId,
} from '../../../../shared/kernel/index.ts';
import type { AppRepository } from '../../application/ports/index.ts';
import type { App } from '../../domain/entities/app.ts';
import { apps } from '../db/schema.ts';
import { fromApp, toApp } from './mappers.ts';

type UpdateResult = [{ affectedRows: number }, unknown];

const DUPLICATE_MESSAGES: Record<string, [code: string, message: string]> = {
  uq_apps_org_slug: ['APP_SLUG_TAKEN', 'slug is already used by another app in this organization'],
  uq_apps_org_namespace: ['APP_NAMESPACE_TAKEN', 'namespace is already used by another app in this organization'],
};

export class DrizzleAppRepository implements AppRepository {
  private readonly transactions: TransactionContext;

  constructor(deps: { transactions: TransactionContext }) {
    this.transactions = deps.transactions;
  }

  async findById(id: AppId): Promise<App | null> {
    const [row] = await this.transactions.executor().select().from(apps).where(eq(apps.appId, id));
    return row ? toApp(row) : null;
  }

  async listByOrg(orgId: OrgId): Promise<App[]> {
    const rows = await this.transactions.executor().select().from(apps).where(eq(apps.orgId, orgId)).orderBy(asc(apps.slug));
    return rows.map(toApp);
  }

  async insert(app: App): Promise<void> {
    try {
      await this.transactions.executor().insert(apps).values(fromApp(app));
    } catch (err) {
      const duplicate = DUPLICATE_MESSAGES[duplicateKeyName(err) ?? ''];
      if (duplicate) throw new ConflictError(...duplicate);
      throw err;
    }
  }

  async update(app: App, expectedStatus: AppStatus): Promise<void> {
    const { appId: _id, orgId: _org, accountId: _account, createdAt: _created, ...changes } = fromApp(app);
    const [result] = (await this.transactions
      .executor()
      .update(apps)
      .set(changes)
      .where(and(eq(apps.appId, app.id), eq(apps.status, expectedStatus)))) as unknown as UpdateResult;
    if (result.affectedRows === 0) throw new ConcurrentTransitionError('App', app.id, expectedStatus);
  }

  lockForUpdate(id: AppId): Promise<boolean> {
    return lockParentRow(this.transactions.require('AppRepository.lockForUpdate'), apps, apps.appId, id);
  }
}
