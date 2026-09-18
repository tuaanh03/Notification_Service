import { createContainer } from './composition/index.ts';
import { loadEnvOrExit } from './entrypoints/load-env-or-exit.ts';
import { pingDatabase } from './shared/db/index.ts';

const container = createContainer(loadEnvOrExit());
const logger = container.ports.logger.child('bootstrap');

try {
  await pingDatabase(container.infra.database.db);
  logger.info('database reachable', { env: container.env.NODE_ENV });
} catch (err) {
  logger.fatal('database unreachable', { error: err instanceof Error ? err.message : String(err) });
  process.exitCode = 1;
} finally {
  await container.dispose();
}

// Lượt 3 thay file này bằng entrypoints/{api,worker,scheduler}: mỗi process dựng container
// một lần, chạy tới khi nhận SIGTERM, rồi dispose.
