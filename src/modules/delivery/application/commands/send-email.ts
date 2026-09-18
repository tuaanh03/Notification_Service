import type { Logger } from '../../../../shared/observability/logger.ts';
import type { EmailProvider, EmailSendResult, OutgoingEmail, Sleeper } from '../ports/index.ts';

/** Kết quả cuối cùng cho notifications: `retryable` đã được xử lý hết ở đây. */
export type EmailDeliveryResult = Exclude<EmailSendResult, { kind: 'retryable' }>;

/** implementation_plan.md §7: tối đa 3 lần, tổng thời gian chờ ≤ 2 phút. */
export const MAX_SEND_ATTEMPTS = 3;
export const MAX_TOTAL_WAIT_MS = 120_000;
const DEFAULT_BACKOFF_MS = [1_000, 2_000];

/**
 * Gửi một email, thử lại CHỈ khi provider chắc chắn chưa nhận (`retryable`). Hết lượt -> `rejected`:
 * thư chắc chắn chưa đi, notification sẽ là `failed`, không phải `outcome_unknown`.
 *
 * Provider lỡ ném exception (lỗi lập trình, không nằm trong 4 loại) -> coi là `unknown`: không biết
 * thư đã đi chưa thì theo at-most-once là KHÔNG gửi lại.
 */
export class SendEmail {
  private readonly provider: EmailProvider;
  private readonly sleeper: Sleeper;
  private readonly logger: Logger;

  constructor(deps: { provider: EmailProvider; sleeper: Sleeper; logger: Logger }) {
    this.provider = deps.provider;
    this.sleeper = deps.sleeper;
    this.logger = deps.logger.child('send-email');
  }

  async execute(email: OutgoingEmail): Promise<EmailDeliveryResult> {
    let waited = 0;
    for (let attempt = 1; ; attempt += 1) {
      const result = await this.attempt(email);
      if (result.kind !== 'retryable') return result;

      const wait = result.retryAfterMs ?? DEFAULT_BACKOFF_MS[attempt - 1] ?? 2_000;
      if (attempt >= MAX_SEND_ATTEMPTS || waited + wait > MAX_TOTAL_WAIT_MS) {
        return { kind: 'rejected', reason: `retry_exhausted: ${result.reason}` };
      }
      this.logger.warn('email provider asked to retry', {
        notification_id: email.notificationId,
        attempt,
        wait_ms: wait,
        reason: result.reason,
      });
      await this.sleeper.sleep(wait);
      waited += wait;
    }
  }

  private async attempt(email: OutgoingEmail): Promise<EmailSendResult> {
    try {
      return await this.provider.send(email);
    } catch (err) {
      return { kind: 'unknown', reason: `provider_threw: ${err instanceof Error ? err.message : String(err)}` };
    }
  }
}
