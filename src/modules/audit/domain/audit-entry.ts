import type { ActorType, AuditId } from '../../../shared/kernel/index.ts';

/**
 * Append-only. Role DB của ứng dụng chỉ có INSERT/SELECT trên bảng này (SM-8).
 * Cần trả lời "tại sao thông báo đó không tới" nhiều tháng sau.
 */
export class AuditEntry {
  readonly id: AuditId;
  readonly actor: string;
  readonly actorType: ActorType;
  readonly action: string;
  readonly targetType: string;
  readonly targetId: string;
  readonly before: Record<string, unknown> | null;
  readonly after: Record<string, unknown> | null;
  readonly source: string;
  readonly at: Date;

  constructor(props: {
    id: AuditId;
    actor: string;
    actorType: ActorType;
    action: string;
    targetType: string;
    targetId: string;
    before?: Record<string, unknown> | null | undefined;
    after?: Record<string, unknown> | null | undefined;
    source: string;
    at?: Date | undefined;
  }) {
    this.id = props.id;
    this.actor = props.actor;
    this.actorType = props.actorType;
    this.action = props.action;
    this.targetType = props.targetType;
    this.targetId = props.targetId;
    this.before = props.before ?? null;
    this.after = props.after ?? null;
    this.source = props.source;
    this.at = props.at ?? new Date();
  }
}
