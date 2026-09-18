import {
  BaseEntity,
  CrossOrgViolationError,
  type AppId,
  type OrgId,
  type PersonId,
  type TimestampInput,
  type UserId,
  type UserSource,
} from '../../../../shared/kernel/index.ts';
import type { Person } from './person.ts';

export interface UserProps extends TimestampInput {
  id: UserId;
  appId: AppId;
  /** Denormalize để ép được composite FK (app_id, org_id) và (person_id, org_id). */
  orgId: OrgId;
  externalId: string | null;
  personId?: PersonId | null | undefined;
  source?: UserSource | undefined;
  lastSeen?: Date | null | undefined;
}

/**
 * User = bản ghi của một người TRONG MỘT APP. `UNIQUE (app_id, external_id)` —
 * external_id KHÔNG unique toàn cục, hai app là hai namespace độc lập hoàn toàn.
 */
export class User extends BaseEntity<UserId> {
  readonly appId: AppId;
  readonly orgId: OrgId;
  readonly externalId: string | null;
  personId: PersonId | null;
  source: UserSource;
  lastSeen: Date | null;

  constructor(props: UserProps) {
    super(props.id, props);
    this.appId = props.appId;
    this.orgId = props.orgId;
    this.externalId = props.externalId;
    this.personId = props.personId ?? null;
    this.source = props.source ?? 'api';
    this.lastSeen = props.lastSeen ?? null;
  }

  /**
   * Nối user vào một person. Đây là chỗ mô hình B chống rò rỉ dữ liệu giữa các org:
   * domain chặn trước, composite FK trong MySQL chặn lần cuối.
   */
  linkToPerson(person: Person, at: Date): void {
    if (person.orgId !== this.orgId) {
      throw new CrossOrgViolationError('person', this.orgId, person.orgId);
    }
    this.personId = person.id;
    this.touch(at);
  }

  unlinkPerson(at: Date): void {
    this.personId = null;
    this.touch(at);
  }

  seenAt(at: Date): void {
    this.lastSeen = at;
    this.touch(at);
  }
}
