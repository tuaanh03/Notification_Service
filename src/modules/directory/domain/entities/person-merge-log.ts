import type { MatchedOn, MergeLogId, PersonId, UserId } from '../../../../shared/kernel/index.ts';

/**
 * Audit trail của mọi lần gắn user vào person. Bắt buộc phải có để "unwind" được
 * khi gộp nhầm — gộp nhầm nghĩa là thư riêng của người này lọt sang người kia.
 */
export class PersonMergeLog {
  readonly id: MergeLogId;
  readonly personId: PersonId;
  readonly userId: UserId;
  readonly matchedOn: MatchedOn;
  /** Email/phone đã chuẩn hoá dùng để khớp, hoặc admin_id nếu gắn tay. */
  readonly matchedValue: string;
  readonly createdAt: Date;

  constructor(props: {
    id: MergeLogId;
    personId: PersonId;
    userId: UserId;
    matchedOn: MatchedOn;
    matchedValue: string;
    createdAt: Date;
  }) {
    this.id = props.id;
    this.personId = props.personId;
    this.userId = props.userId;
    this.matchedOn = props.matchedOn;
    this.matchedValue = props.matchedValue;
    this.createdAt = props.createdAt;
  }
}
