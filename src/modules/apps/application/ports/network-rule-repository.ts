import type { AppId, NetworkRuleKind } from '../../../../shared/kernel/index.ts';
import type { AppNetworkRule } from '../../domain/entities/app-network-rule.ts';

export interface NetworkRuleRepository {
  listByApp(appId: AppId): Promise<AppNetworkRule[]>;
  /** Đã có đúng rule đó -> ConflictError. */
  insert(rule: AppNetworkRule): Promise<void>;
  /** Trả false nếu không có rule đó. */
  remove(appId: AppId, kind: NetworkRuleKind, value: string): Promise<boolean>;
}
