import { SendEmail, type EmailProvider, type SendRateLimiter } from '../../modules/delivery/application/index.ts';
import {
  GraphEmailProvider,
  MockEmailProvider,
  RedisSendRateLimiter,
  TimerSleeper,
} from '../../modules/delivery/infrastructure/adapters/index.ts';
import { FixedWindowRateLimiter } from '../../shared/rate-limit/index.ts';
import type { Env } from '../../shared/config/index.ts';
import type { Container } from '../container.ts';
import type { ModuleDefinition } from '../module-definition.ts';

/**
 * Ghép module delivery: chọn provider theo `EMAIL_PROVIDER` (`mock` | `graph`) và dựng bộ giới hạn
 * tốc độ `EMAIL_MAX_PER_MINUTE` đếm trên Redis (dùng chung mọi worker).
 * Test truyền provider riêng để kịch bản hoá kết quả.
 */
export function deliveryModule(
  container: Container,
  overrides: { emailProvider?: EmailProvider | undefined } = {},
): {
  definition: ModuleDefinition;
  sendEmail: SendEmail;
  sendRateLimiter: SendRateLimiter;
  emailProvider: EmailProvider;
} {
  const { logger, clock } = container.ports;
  const { env } = container;
  const sleeper = new TimerSleeper();
  const emailProvider = overrides.emailProvider ?? selectProvider(container);
  logger.child('delivery').info('email provider selected', {
    provider: emailProvider.name,
    maxPerMinute: env.EMAIL_MAX_PER_MINUTE,
  });
  return {
    definition: { name: 'delivery' },
    emailProvider,
    sendEmail: new SendEmail({ provider: emailProvider, sleeper, logger }),
    sendRateLimiter: new RedisSendRateLimiter({
      limiter: new FixedWindowRateLimiter({
        redis: container.infra.redis.client,
        clock,
        sleep: (ms) => sleeper.sleep(ms),
      }),
      sender: env.EMAIL_SENDER_ADDRESS ?? emailProvider.name,
      maxPerMinute: env.EMAIL_MAX_PER_MINUTE,
    }),
  };
}

function selectProvider(container: Container): EmailProvider {
  const { env } = container;
  const { logger, clock } = container.ports;
  switch (env.EMAIL_PROVIDER) {
    case 'mock':
      return new MockEmailProvider({ logger });
    case 'graph':
      return new GraphEmailProvider({ config: graphConfig(env), clock, logger });
  }
}

/** `loadEnv` đã ép đủ biến khi `EMAIL_PROVIDER=graph`; kiểm lại ở đây để không phải dùng `!`. */
function graphConfig(env: Env) {
  const { EMAIL_SENDER_ADDRESS: sender, GRAPH_TENANT_ID: tenantId, GRAPH_CLIENT_ID: clientId } = env;
  const clientSecret = env.GRAPH_CLIENT_SECRET;
  if (!sender || !tenantId || !clientId || !clientSecret) {
    throw new Error('EMAIL_PROVIDER=graph requires EMAIL_SENDER_ADDRESS and GRAPH_TENANT_ID/CLIENT_ID/CLIENT_SECRET');
  }
  return { sender, tenantId, clientId, clientSecret, timeoutMs: env.EMAIL_SEND_TIMEOUT_MS };
}
