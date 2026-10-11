import { eq } from 'drizzle-orm';
import type { TransactionContext } from '../../../../shared/db/index.ts';
import type { StoredSetting, SystemSettingRepository } from '../../application/ports/index.ts';
import { systemSettings } from '../db/schema.ts';

export class DrizzleSystemSettingRepository implements SystemSettingRepository {
  private readonly transactions: TransactionContext;

  constructor(deps: { transactions: TransactionContext }) {
    this.transactions = deps.transactions;
  }

  async listAll(): Promise<StoredSetting[]> {
    const rows = await this.transactions.executor().select().from(systemSettings);
    return rows.map((r) => ({ key: r.settingKey, value: r.value, updatedBy: r.updatedBy, updatedAt: r.updatedAt }));
  }

  async upsert(s: StoredSetting): Promise<void> {
    await this.transactions
      .executor()
      .insert(systemSettings)
      .values({ settingKey: s.key, value: s.value, updatedBy: s.updatedBy, updatedAt: s.updatedAt })
      .onDuplicateKeyUpdate({ set: { value: s.value, updatedBy: s.updatedBy, updatedAt: s.updatedAt } });
  }

  async delete(key: string): Promise<void> {
    await this.transactions.executor().delete(systemSettings).where(eq(systemSettings.settingKey, key));
  }
}
