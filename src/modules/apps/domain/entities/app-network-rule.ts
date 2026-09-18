import { ValidationError, type AppId, type NetworkRuleKind } from '../../../../shared/kernel/index.ts';

/** Allowlist IP / Origin cho `/v1/*`. Khoá kép (app_id, kind, value). */
export class AppNetworkRule {
  readonly appId: AppId;
  readonly kind: NetworkRuleKind;
  readonly value: string;

  constructor(props: { appId: AppId; kind: NetworkRuleKind; value: string }) {
    const value = props.value.trim();
    if (!value) throw ValidationError.of('NETWORK_RULE_VALUE_REQUIRED', 'network rule value must not be empty', 'value');
    this.appId = props.appId;
    this.kind = props.kind;
    this.value = value;
  }
}
