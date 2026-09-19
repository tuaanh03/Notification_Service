import { randomUUID } from 'node:crypto';
import { createContainer, deliveryModule } from '../../composition/index.ts';
import { loadEnvOrExit } from '../runtime/load-env-or-exit.ts';

/**
 * Gửi MỘT thư thử qua provider đang cấu hình (`EMAIL_PROVIDER`) — kiểm cấu hình Graph trước khi
 * bật worker thật. Không chạm DB, không tạo notification:
 *   npm run email:test -- someone@example.com
 * Đi qua đúng `SendEmail` (thử lại khi chắc chắn chưa gửi) như worker, nên kết quả in ra là thứ
 * worker sẽ thấy.
 */
const to = process.argv[2];
if (!to) {
  console.error('usage: npm run email:test -- <recipient@example.com>');
  process.exit(2);
}

const container = createContainer(loadEnvOrExit());
const logger = container.ports.logger.child('send-test-email');
try {
  const { sendEmail, emailProvider } = deliveryModule(container);
  const notificationId = randomUUID();
  const sentAt = container.ports.clock.now().toISOString();
  const result = await sendEmail.execute({
    to,
    subject: `EWS AstroLink test email ${sentAt}`,
    html: `<p>Test email from <b>EWS AstroLink</b> via <code>${emailProvider.name}</code> at ${sentAt}.</p>`,
    text: null,
    notificationId,
  });
  logger.info('test email finished', { provider: emailProvider.name, notificationId, result });
  if (result.kind !== 'accepted') process.exitCode = 1;
} catch (err) {
  logger.fatal('test email failed', { error: err instanceof Error ? err.message : String(err) });
  process.exitCode = 1;
} finally {
  await container.dispose();
}
