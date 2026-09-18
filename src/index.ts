import { createLogger } from './shared/observability/logger.ts';

const logger = createLogger({ context: 'bootstrap' });
logger.info('phase 0: domain + schema', {
  env: process.env['NODE_ENV'] ?? 'development',
  model: 'B',
});

// Phase 1 kế tiếp (theo thứ tự):
//   shared/config · shared/db (client + unit of work + outbox relay) · shared/streams
//   -> entrypoints/{api,worker,scheduler} -> lát cắt dọc đầu tiên: module apps
