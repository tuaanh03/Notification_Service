import { and, asc, eq } from 'drizzle-orm';
import { isDuplicateKeyError, type TransactionContext } from '../../../../shared/db/index.ts';
import { ConflictError, type AppId, type NetworkRuleKind } from '../../../../shared/kernel/index.ts';
import type { NetworkRuleRepository } from '../../application/ports/index.ts';
import type { AppNetworkRule } from '../../domain/entities/app-network-rule.ts';
import { appNetworkRules } from '../db/schema.ts';
import { toNetworkRule } from './mappers.ts';

type DeleteResult = [{ affectedRows: number }, unknown];

export class DrizzleNetworkRuleRepository implements NetworkRuleRepository {
  private readonly transactions: TransactionContext;

  constructor(deps: { transactions: TransactionContext }) {
    this.transactions = deps.transactions;
  }

  async listByApp(appId: AppId): Promise<AppNetworkRule[]> {
    const rows = await this.transactions
      .executor()
      .select()
      .from(appNetworkRules)
      .where(eq(appNetworkRules.appId, appId))
      .orderBy(asc(appNetworkRules.kind), asc(appNetworkRules.value));
    return rows.map(toNetworkRule);
  }

  async insert(rule: AppNetworkRule): Promise<void> {
    try {
      await this.transactions.executor().insert(appNetworkRules).values({ appId: rule.appId, kind: rule.kind, value: rule.value });
    } catch (err) {
      if (isDuplicateKeyError(err)) throw new ConflictError('NETWORK_RULE_EXISTS', `${rule.kind} rule ${rule.value} already exists`);
      throw err;
    }
  }

  async remove(appId: AppId, kind: NetworkRuleKind, value: string): Promise<boolean> {
    const [result] = (await this.transactions
      .executor()
      .delete(appNetworkRules)
      .where(and(eq(appNetworkRules.appId, appId), eq(appNetworkRules.kind, kind), eq(appNetworkRules.value, value)))) as unknown as DeleteResult;
    return result.affectedRows > 0;
  }
}
