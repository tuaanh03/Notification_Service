import { BaseEntity, ValidationError, type AccountId, type TimestampInput } from '../../../../shared/kernel/index.ts';

export interface AccountProps extends TimestampInput {
  id: AccountId;
  name: string;
}

/** Tầng cao nhất: một khách hàng / một hợp đồng. Chứa nhiều organization. */
export class Account extends BaseEntity<AccountId> {
  name: string;

  constructor(props: AccountProps) {
    super(props.id, props);
    const name = props.name.trim();
    if (!name) throw ValidationError.of('ACCOUNT_NAME_REQUIRED', 'account name must not be empty', 'name');
    this.name = name;
  }
}
