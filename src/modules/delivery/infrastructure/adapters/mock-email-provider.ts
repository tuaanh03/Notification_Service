import type { Logger } from '../../../../shared/observability/logger.ts';
import type { EmailProvider, EmailSendResult, OutgoingEmail } from '../../application/ports/index.ts';

/**
 * Provider giả cho dev và test (`EMAIL_PROVIDER=mock`). Không gửi thư thật: ghi log, lưu lại mọi lần
 * gọi, và mặc định trả `accepted`.
 *
 * Test kịch bản hoá kết quả bằng `respondWith(...)`: mỗi lần gọi lấy một kết quả trong hàng đợi, hết
 * hàng đợi thì quay lại mặc định. Nhờ vậy giả lập được 429 rồi thành công, timeout sau khi gửi...
 */
export class MockEmailProvider implements EmailProvider {
  readonly name = 'mock';
  /** Mọi lần gọi, theo thứ tự — kể cả lần bị giả lập lỗi. */
  readonly attempts: OutgoingEmail[] = [];
  /** Chỉ những lần provider "nhận" thư (accepted) — số thư đã thật sự đi. */
  readonly delivered: OutgoingEmail[] = [];
  private readonly scripted: EmailSendResult[] = [];
  private readonly logger: Logger;
  private sequence = 0;

  constructor(deps: { logger: Logger }) {
    this.logger = deps.logger.child('mock-email');
  }

  respondWith(...results: EmailSendResult[]): void {
    this.scripted.push(...results);
  }

  reset(): void {
    this.attempts.length = 0;
    this.delivered.length = 0;
    this.scripted.length = 0;
  }

  async send(email: OutgoingEmail): Promise<EmailSendResult> {
    this.attempts.push(email);
    const result = this.scripted.shift() ?? { kind: 'accepted', providerMessageId: `mock-${(this.sequence += 1)}` };
    if (result.kind === 'accepted') this.delivered.push(email);
    this.logger.info('mock email', {
      notification_id: email.notificationId,
      to: email.to,
      subject: email.subject,
      result: result.kind,
    });
    return result;
  }
}
