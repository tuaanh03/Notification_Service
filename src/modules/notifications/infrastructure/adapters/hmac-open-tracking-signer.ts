import { createHmac, timingSafeEqual } from 'node:crypto';
import type { NotificationId } from '../../../../shared/kernel/index.ts';
import type { OpenTrackingSigner } from '../../application/ports/index.ts';

/**
 * Chữ ký = HMAC-SHA256(khoá chủ, "email-open:<notificationId>") base64url (43 ký tự) — ADR-0031.
 * Chuỗi đầu vào khác token incoming (`incoming-hook-token:…`) và secret outgoing (`webhook-secret:…`)
 * nên không bao giờ trùng dù chung khoá. Đổi khoá chủ = ảnh trong thư cũ thôi được đếm.
 */
export class HmacOpenTrackingSigner implements OpenTrackingSigner {
  readonly configured: boolean;
  private readonly signingKey: string | null;

  constructor(deps: { signingKey: string | null | undefined }) {
    this.signingKey = deps.signingKey ?? null;
    this.configured = this.signingKey !== null;
  }

  sign(notificationId: NotificationId): string {
    if (this.signingKey === null) throw new Error('WEBHOOK_SIGNING_KEY is not configured');
    return createHmac('sha256', this.signingKey).update(`email-open:${notificationId}`).digest('base64url');
  }

  verify(notificationId: NotificationId, signature: string): boolean {
    if (this.signingKey === null) return false;
    const expected = Buffer.from(this.sign(notificationId));
    const given = Buffer.from(signature);
    return given.length === expected.length && timingSafeEqual(given, expected);
  }
}
