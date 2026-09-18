import type { BounceEventId, BounceKind } from '../../../../shared/kernel/index.ts';

/**
 * Bounce/complaint từ ESP. Hard bounce -> phát MarkedInvalid cho module subscriptions.
 * Suppression scope theo app (`subscriptions.app_id`), không phải một danh sách chung
 * toàn account — nếu dùng chung, một app gửi hỏng sẽ chặn oan địa chỉ ở app khác.
 */
export class BounceEvent {
  readonly id: BounceEventId;
  readonly providerId: string;
  readonly address: string;
  readonly kind: BounceKind;
  readonly raw: Record<string, unknown>;
  readonly at: Date;

  constructor(props: {
    id: BounceEventId;
    providerId: string;
    address: string;
    kind: BounceKind;
    raw?: Record<string, unknown> | undefined;
    at: Date;
  }) {
    this.id = props.id;
    this.providerId = props.providerId;
    this.address = props.address;
    this.kind = props.kind;
    this.raw = props.raw ?? {};
    this.at = props.at;
  }

  get suppressesChannel(): boolean {
    return this.kind === 'hard';
  }
}
