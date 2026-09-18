import { and, count, desc, eq } from 'drizzle-orm';
import type { TransactionContext } from '../../../../shared/db/index.ts';
import type { AppId, AppSecretId } from '../../../../shared/kernel/index.ts';
import type { AppSecretRepository } from '../../application/ports/index.ts';
import type { AppSecret } from '../../domain/entities/app-secret.ts';
import { appSecrets } from '../db/schema.ts';
import { toAppSecret } from './mappers.ts';

export class DrizzleAppSecretRepository implements AppSecretRepository {
  private readonly transactions: TransactionContext;

  constructor(deps: { transactions: TransactionContext }) {
    this.transactions = deps.transactions;
  }

  async findById(id: AppSecretId): Promise<AppSecret | null> {
    const [row] = await this.transactions.executor().select().from(appSecrets).where(eq(appSecrets.appSecretId, id));
    return row ? toAppSecret(row) : null;
  }

  async listByApp(appId: AppId): Promise<AppSecret[]> {
    const rows = await this.transactions
      .executor()
      .select()
      .from(appSecrets)
      .where(eq(appSecrets.appId, appId))
      .orderBy(desc(appSecrets.createdAt));
    return rows.map(toAppSecret);
  }

  async countActive(appId: AppId): Promise<number> {
    const [row] = await this.transactions
      .executor()
      .select({ n: count() })
      .from(appSecrets)
      .where(and(eq(appSecrets.appId, appId), eq(appSecrets.status, 'active')));
    return row?.n ?? 0;
  }

  async insert(secret: AppSecret): Promise<void> {
    await this.transactions.executor().insert(appSecrets).values({
      appSecretId: secret.id,
      appId: secret.appId,
      secretHash: secret.secretHash,
      hint: secret.hint,
      status: secret.status,
      createdAt: secret.createdAt,
      revokedAt: secret.revokedAt,
    });
  }

  async update(secret: AppSecret): Promise<void> {
    await this.transactions
      .executor()
      .update(appSecrets)
      .set({ status: secret.status, revokedAt: secret.revokedAt })
      .where(eq(appSecrets.appSecretId, secret.id));
  }
}
