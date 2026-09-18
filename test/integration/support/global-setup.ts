import { MySqlContainer, type StartedMySqlContainer } from '@testcontainers/mysql';
import type { TestProject } from 'vitest/node';

/** Cùng dòng MySQL 8 với production (ADR-0002). Đổi phiên bản ở đây là đổi cho mọi test tích hợp. */
const MYSQL_IMAGE = 'mysql:8.4';

declare module 'vitest' {
  interface ProvidedContext {
    /** URI quyền root của container — helper dùng để tạo database riêng cho từng file test. */
    mysqlRootUrl: string;
  }
}

let container: StartedMySqlContainer | undefined;

/** MỘT container cho cả lượt chạy; mỗi file test tự tạo database riêng trong đó. */
export async function setup(project: TestProject): Promise<void> {
  container = await new MySqlContainer(MYSQL_IMAGE).start();
  project.provide('mysqlRootUrl', container.getConnectionUri(true));
}

export async function teardown(): Promise<void> {
  await container?.stop();
}
