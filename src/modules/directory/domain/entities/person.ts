import {
  BaseEntity,
  normalizeEmail,
  normalizePhone,
  type NormalizedEmail,
  type NormalizedPhone,
  type OrgId,
  type PersonId,
  type TimestampInput,
} from '../../../../shared/kernel/index.ts';

export interface PersonProps extends TimestampInput {
  id: PersonId;
  orgId: OrgId;
  primaryEmail: string;
  primaryPhone?: string | null | undefined;
}

/**
 * Person = nhận diện toàn cục TRONG MỘT ORG. Đây là thứ cho phép SYS gửi đúng một lần
 * cho người có tài khoản ở nhiều app. `UNIQUE (org_id, primary_email)`.
 */
export class Person extends BaseEntity<PersonId> {
  readonly orgId: OrgId;
  primaryEmail: NormalizedEmail;
  primaryPhone: NormalizedPhone | null;

  constructor(props: PersonProps) {
    super(props.id, props);
    this.orgId = props.orgId;
    this.primaryEmail = normalizeEmail(props.primaryEmail);
    this.primaryPhone = props.primaryPhone ? normalizePhone(props.primaryPhone) : null;
  }
}
