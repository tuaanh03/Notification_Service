import {
  BaseEntity,
  ValidationError,
  type AccountId,
  type OrgId,
  type TimestampInput,
} from '../../../shared/kernel/index.ts';

export interface OrganizationProps extends TimestampInput {
  id: OrgId;
  accountId: AccountId;
  name: string;
}

/**
 * Org là ranh giới SỞ HỮU và HỢP NHẤT PERSON (nguyên tắc nền tảng, mô hình B).
 * Mọi app và person đều thuộc đúng một org; không có gì đi xuyên qua ranh giới này.
 */
export class Organization extends BaseEntity<OrgId> {
  readonly accountId: AccountId;
  name: string;

  constructor(props: OrganizationProps) {
    super(props.id, props);
    const name = props.name.trim();
    if (!name) throw new ValidationError(['organization name không được rỗng']);
    this.accountId = props.accountId;
    this.name = name;
  }
}
