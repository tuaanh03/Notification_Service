import { SendEmail, type EmailProvider } from '../../modules/delivery/application/index.ts';
import { MockEmailProvider, TimerSleeper } from '../../modules/delivery/infrastructure/adapters/index.ts';
import type { Container } from '../container.ts';
import type { ModuleDefinition } from '../module-definition.ts';

/**
 * Ghép module delivery: chọn provider theo `EMAIL_PROVIDER` (GĐ 3 chỉ có `mock`; `graph` ở GĐ 4).
 * Test truyền provider riêng để kịch bản hoá kết quả.
 */
export function deliveryModule(
  container: Container,
  overrides: { emailProvider?: EmailProvider | undefined } = {},
): { definition: ModuleDefinition; sendEmail: SendEmail; emailProvider: EmailProvider } {
  const { logger } = container.ports;
  const emailProvider = overrides.emailProvider ?? selectProvider(container);
  logger.child('delivery').info('email provider selected', { provider: emailProvider.name });
  return {
    definition: { name: 'delivery' },
    emailProvider,
    sendEmail: new SendEmail({ provider: emailProvider, sleeper: new TimerSleeper(), logger }),
  };
}

function selectProvider(container: Container): EmailProvider {
  switch (container.env.EMAIL_PROVIDER) {
    case 'mock':
      return new MockEmailProvider({ logger: container.ports.logger });
  }
}
