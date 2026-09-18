import {
  BaseEntity,
  ValidationError,
  issue,
  type Issue,
  type AppId,
  type NotificationId,
  type NotificationOrigin,
  type NotificationStatus,
  type SegmentId,
  type TemplateVersionId,
  type TimestampInput,
  type TopicId,
  type UserId,
} from '../../../../shared/kernel/index.ts';
import { EMPTY_COUNTERS, type Counters } from '../types/counters.ts';
import type { EmailContent } from '../types/email-content.ts';
import type { Actor, TransitionRecord } from '../types/transition-record.ts';
import { isTerminal, nextStatus, type TransitionEvent } from '../rules/transitions.ts';

/** Payload của một lần gửi: không lưu lên user, không dùng để lọc segment. */
export const MAX_PAYLOAD_BYTES = 2048;

export interface NotificationProps extends TimestampInput {
  id: NotificationId;
  appId: AppId;
  topicId: TopicId;
  origin: NotificationOrigin;
  status?: NotificationStatus | undefined;
  isTest?: boolean | undefined;
  templateVersionId?: TemplateVersionId | null | undefined;
  payload?: Record<string, unknown> | undefined;
  includedSegments?: readonly SegmentId[] | undefined;
  excludedSegments?: readonly SegmentId[] | undefined;
  idempotencyKey?: string | null | undefined;
  collapseKey?: string | null | undefined;
  occurrenceCount?: number | undefined;
  staleDirectory?: boolean | undefined;
  parentNotificationId?: NotificationId | null | undefined;
  scheduledAt?: Date | null | undefined;
  createdBy?: string | null | undefined;
  approvedBy?: string | null | undefined;
  previewRenderedAt?: Date | null | undefined;
  counters?: Counters | undefined;
  /** Gửi trực tiếp một người (MVP — ADR-0016). NULL khi gửi theo segment. */
  targetUserId?: UserId | null | undefined;
  /** Nội dung email trực tiếp. NULL khi dùng template. Tạo bằng `emailContent()`. */
  content?: EmailContent | null | undefined;
}

/**
 * Một bản ghi notification = MỘT LẦN GỬI, bất kể đến từ API hay người soạn (`origin`).
 *
 * Những thứ KHÔNG phải trạng thái, dù trông giống:
 *   duplicate  -> không sinh bản ghi; UNIQUE (app_id, idempotency_key) -> trả bản cũ, HTTP 200
 *   collapsed  -> không sinh bản ghi; occurrence_count++
 *   test_send  -> cột is_test, vẫn đi đủ vòng đời
 *   origin     -> cột, set lúc tạo, không đổi
 */
export class Notification extends BaseEntity<NotificationId> {
  readonly appId: AppId;
  readonly topicId: TopicId;
  readonly origin: NotificationOrigin;
  readonly isTest: boolean;
  readonly idempotencyKey: string | null;
  readonly collapseKey: string | null;
  readonly parentNotificationId: NotificationId | null;
  readonly createdBy: string | null;
  readonly targetUserId: UserId | null;
  readonly content: EmailContent | null;

  status: NotificationStatus;
  templateVersionId: TemplateVersionId | null;
  payload: Record<string, unknown>;
  includedSegments: readonly SegmentId[];
  excludedSegments: readonly SegmentId[];
  occurrenceCount: number;
  staleDirectory: boolean;
  scheduledAt: Date | null;
  approvedBy: string | null;
  previewRenderedAt: Date | null;
  counters: Counters;

  /** Trạng thái lúc đọc từ DB — repository dùng làm `WHERE status = :expected`. */
  private loadedStatus: NotificationStatus;
  private pending: TransitionRecord | null = null;

  constructor(props: NotificationProps) {
    super(props.id, props);
    this.appId = props.appId;
    this.topicId = props.topicId;
    this.origin = props.origin;
    this.isTest = props.isTest ?? false;
    this.idempotencyKey = props.idempotencyKey ?? null;
    this.collapseKey = props.collapseKey ?? null;
    this.parentNotificationId = props.parentNotificationId ?? null;
    this.createdBy = props.createdBy ?? null;
    this.targetUserId = props.targetUserId ?? null;
    this.content = props.content ?? null;

    this.status = props.status ?? (props.origin === 'api' ? 'queued' : 'draft');
    this.loadedStatus = this.status;
    this.templateVersionId = props.templateVersionId ?? null;
    this.payload = props.payload ?? {};
    this.includedSegments = props.includedSegments ?? [];
    this.excludedSegments = props.excludedSegments ?? [];
    this.occurrenceCount = props.occurrenceCount ?? 1;
    this.staleDirectory = props.staleDirectory ?? false;
    this.scheduledAt = props.scheduledAt ?? null;
    this.approvedBy = props.approvedBy ?? null;
    this.previewRenderedAt = props.previewRenderedAt ?? null;
    this.counters = props.counters ?? EMPTY_COUNTERS;

    assertPayloadSize(this.payload);
  }

  /** Trạng thái mà repository phải dùng trong `UPDATE ... WHERE status = ?`. */
  get expectedStatus(): NotificationStatus {
    return this.loadedStatus;
  }

  get pendingTransition(): TransitionRecord | null {
    return this.pending;
  }

  get isTerminal(): boolean {
    return isTerminal(this.status);
  }

  /** Vạch phân chia: qua đây rồi thì không thu hồi được nữa, chỉ còn Dừng. */
  get hasLeftTheBuilding(): boolean {
    return this.status === 'sending' || isTerminal(this.status);
  }

  /**
   * Mọi command đều đi qua đây. Ghi lại transition để repository insert
   * vào notification_transitions TRONG CÙNG TRANSACTION với lần UPDATE (SM-9).
   */
  apply(event: TransitionEvent, actor: Actor, at: Date, reason?: string): TransitionRecord {
    const from = this.status;
    const to = nextStatus(from, event);
    const record: TransitionRecord = { from, to, event, actor, reason: reason ?? null, at };
    this.status = to;
    this.pending = record;
    this.touch(at);
    return record;
  }

  /** Repository gọi sau khi UPDATE thành công, để aggregate sẵn sàng cho lần ghi sau. */
  commitTransition(): void {
    this.loadedStatus = this.status;
    this.pending = null;
  }

  markPreviewRendered(at: Date): void {
    this.previewRenderedAt = at;
    this.touch(at);
  }

  markStaleDirectory(at: Date): void {
    this.staleDirectory = true;
    this.touch(at);
  }

  /** UC-005 A6: tin lặp trong cửa sổ gộp -> không sinh bản ghi mới. */
  collapseOnce(at: Date): void {
    this.occurrenceCount += 1;
    this.touch(at);
  }

  /**
   * BR-5: khoá nút gửi cho tới khi đã xem thử, không sót biến, và ba con số khớp
   * với lần server tính lại. UI có thể bị bypass bằng curl nên guard phải ở đây.
   */
  assertReadyToSubmit(check: {
    unresolvedVariables: readonly string[];
    confirmation: { topicId: TopicId; estimate: number; templateVersionId: TemplateVersionId };
    serverEstimate: number;
  }): void {
    const issues: Issue[] = [];
    if (this.previewRenderedAt === null) issues.push(issue('PREVIEW_REQUIRED', 'content has not been previewed'));
    if (check.unresolvedVariables.length > 0) {
      issues.push(
        issue(
          'UNRESOLVED_VARIABLES',
          `unresolved variables: ${check.unresolvedVariables.join(', ')}`,
        ),
      );
    }
    if (check.confirmation.topicId !== this.topicId) issues.push(issue('TOPIC_CHANGED', 'topic has changed, review again', 'topicId'));
    if (check.confirmation.templateVersionId !== this.templateVersionId) {
      issues.push(
        issue('TEMPLATE_VERSION_CHANGED', 'template version has changed, review again', 'templateVersionId'),
      );
    }
    if (check.confirmation.estimate !== check.serverEstimate) {
      issues.push(
        issue(
          'ESTIMATE_CHANGED',
          `recipient count changed: confirmed ${check.confirmation.estimate}, server computed ${check.serverEstimate}`,
          'estimate',
        ),
      );
    }
    if (issues.length) throw new ValidationError(issues);
  }
}

const UTF8 = new TextEncoder();

function assertPayloadSize(payload: Record<string, unknown>): void {
  // TextEncoder là API chuẩn, không phải của Node — domain không phụ thuộc runtime.
  const bytes = UTF8.encode(JSON.stringify(payload)).length;
  if (bytes > MAX_PAYLOAD_BYTES) {
    throw ValidationError.of(
      'PAYLOAD_TOO_LARGE',
      `payload is ${bytes} bytes, exceeds the ${MAX_PAYLOAD_BYTES}-byte limit`,
      'payload',
    );
  }
}
