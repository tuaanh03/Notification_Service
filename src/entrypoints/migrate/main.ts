import { migrate } from 'drizzle-orm/mysql2/migrator';
import { createContainer } from '../../composition/index.ts';
import { loadEnvOrExit } from '../runtime/load-env-or-exit.ts';

/**
 * Chạy migration trong `drizzle/` — dùng cho job `migrate` của docker compose và cho deploy.
 * Không dùng `drizzle-kit migrate` vì drizzle-kit là devDependency, không có trong image production.
 *
 * Migrator của Drizzle ghi lại migration đã chạy trong `__drizzle_migrations`, nên chạy lại là
 * no-op. MySQL không có DDL trong transaction (ADR-0002): migration hỏng giữa chừng để lại trạng
 * thái dở — phải sửa bằng tay, không có rollback tự động.
 */
const MIGRATIONS_DIR = 'drizzle';

const container = createContainer(loadEnvOrExit());
const logger = container.ports.logger.child('migrate');
try {
  await migrate(container.infra.database.db, { migrationsFolder: MIGRATIONS_DIR });
  logger.info('migrations applied', { folder: MIGRATIONS_DIR });
} catch (err) {
  logger.fatal('migration failed', { error: err instanceof Error ? err.message : String(err) });
  process.exitCode = 1;
} finally {
  await container.dispose();
}
