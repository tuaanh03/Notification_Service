import { createHmac } from 'node:crypto';
import type { WebhookEndpointId } from '../../../../shared/kernel/index.ts';
import type { WebhookSecrets } from '../../application/ports/index.ts';

/**
 * Secret KHÔNG lưu ở đâu cả (ADR-0029 §7a): `whsec_` + HMAC-SHA256(khoá chủ, "<endpointId>:<version>").
 * Lộ bản sao DB không lộ secret nào; đổi secret = tăng version. Đổi khoá chủ = đổi secret của MỌI URL.
 */
export class HmacWebhookSecrets implements WebhookSecrets {
  readonly configured = true;
  private readonly signingKey: string;

  constructor(deps: { signingKey: string }) {
    this.signingKey = deps.signingKey;
  }

  secretFor(endpointId: WebhookEndpointId, version: number): string {
    return `whsec_${createHmac('sha256', this.signingKey).update(`webhook-secret:${endpointId}:${version}`).digest('base64url')}`;
  }

  signatureHeader(endpointId: WebhookEndpointId, version: number, body: string, at: Date): string {
    const t = Math.floor(at.getTime() / 1000);
    const v1 = createHmac('sha256', this.secretFor(endpointId, version)).update(`${t}.${body}`).digest('hex');
    return `t=${t},v1=${v1}`;
  }
}

/** Thiếu `WEBHOOK_SIGNING_KEY`: route tạo / đổi secret trả 503, job không gọi gì. */
export class DisabledWebhookSecrets implements WebhookSecrets {
  readonly configured = false;

  secretFor(): never {
    throw new Error('WEBHOOK_SIGNING_KEY is not configured');
  }

  signatureHeader(): never {
    throw new Error('WEBHOOK_SIGNING_KEY is not configured');
  }
}
