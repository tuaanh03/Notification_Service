import {
  BaseEntity,
  ValidationError,
  WEBHOOK_EVENT_TYPES,
  type AppId,
  type TimestampInput,
  type WebhookEndpointId,
  type WebhookEndpointStatus,
  type WebhookEventType,
} from '../../../../shared/kernel/index.ts';
import { parseWebhookUrl } from '../rules/webhook-url.ts';

/**
 * Tối đa 2 URL mỗi app (ADR-0029). Mỗi URL giữ một "chỗ" (`slot` 1 hoặc 2); unique `(app_id, slot)` ở DB
 * là chốt cuối khi hai lệnh thêm chạy song song — không cần khoá bảng của module apps.
 */
export const WEBHOOK_SLOTS = [1, 2] as const;
export type WebhookSlot = (typeof WEBHOOK_SLOTS)[number];

export interface WebhookEndpointProps extends TimestampInput {
  id: WebhookEndpointId;
  appId: AppId;
  slot: WebhookSlot;
  url: string;
  events: readonly WebhookEventType[];
  /** Secret không lưu — tính lại từ khoá chủ + id + số này (ADR-0029 §7a). Đổi secret = +1. */
  secretVersion?: number | undefined;
  status?: WebhookEndpointStatus | undefined;
  createdBy?: string | null | undefined;
}

/** Một URL của app nhận webhook. */
export class WebhookEndpoint extends BaseEntity<WebhookEndpointId> {
  readonly appId: AppId;
  readonly slot: WebhookSlot;
  readonly url: string;
  readonly createdBy: string | null;
  events: readonly WebhookEventType[];
  secretVersion: number;
  status: WebhookEndpointStatus;

  constructor(props: WebhookEndpointProps) {
    super(props.id, props);
    this.appId = props.appId;
    this.slot = props.slot;
    this.url = parseWebhookUrl(props.url);
    this.events = normalizeEvents(props.events);
    this.secretVersion = props.secretVersion ?? 1;
    this.status = props.status ?? 'active';
    this.createdBy = props.createdBy ?? null;
  }

  /** Chỗ còn trống cho URL mới; null = app đã đủ 2 URL. */
  static freeSlot(used: readonly number[]): WebhookSlot | null {
    return WEBHOOK_SLOTS.find((slot) => !used.includes(slot)) ?? null;
  }

  static assertHasFreeSlot(slot: WebhookSlot | null): asserts slot is WebhookSlot {
    if (slot === null) {
      throw ValidationError.of('WEBHOOK_LIMIT_REACHED', `an app can have at most ${WEBHOOK_SLOTS.length} webhook URLs`, 'url');
    }
  }

  changeEvents(events: readonly WebhookEventType[], at: Date): void {
    this.events = normalizeEvents(events);
    this.touch(at);
  }

  setStatus(status: WebhookEndpointStatus, at: Date): void {
    this.status = status;
    this.touch(at);
  }

  rotateSecret(at: Date): void {
    this.secretVersion += 1;
    this.touch(at);
  }

  subscribesTo(event: WebhookEventType): boolean {
    return this.status === 'active' && this.events.includes(event);
  }
}

/** Không rỗng, không trùng, theo thứ tự cố định của `WEBHOOK_EVENT_TYPES`. */
function normalizeEvents(events: readonly WebhookEventType[]): WebhookEventType[] {
  const unknown = events.filter((e) => !(WEBHOOK_EVENT_TYPES as readonly string[]).includes(e));
  if (unknown.length > 0) throw ValidationError.of('WEBHOOK_EVENT_UNKNOWN', `unknown events: ${unknown.join(', ')}`, 'events');
  const picked = WEBHOOK_EVENT_TYPES.filter((e) => events.includes(e));
  if (picked.length === 0) throw ValidationError.of('WEBHOOK_EVENTS_REQUIRED', 'choose at least one event', 'events');
  return picked;
}
