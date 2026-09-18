import { MySqlContainer, type StartedMySqlContainer } from '@testcontainers/mysql';
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';
import type { TestProject } from 'vitest/node';

/** Cùng phiên bản với docker-compose.yml. Đổi ở đây là đổi cho mọi test tích hợp. */
const MYSQL_IMAGE = 'mysql:8.4';
const REDIS_IMAGE = 'redis:7.4-alpine';

declare module 'vitest' {
  interface ProvidedContext {
    /** URI quyền root của container — helper dùng để tạo database riêng cho từng file test. */
    mysqlRootUrl: string;
    redisUrl: string;
  }
}

let mysql: StartedMySqlContainer | undefined;
let redis: StartedRedisContainer | undefined;

/**
 * MỘT MySQL + MỘT Redis cho cả lượt chạy. Mỗi file test tự tạo database riêng; phía Redis thì
 * mỗi test dùng tên stream riêng (`uniqueStream`) — cô lập mà không phải dựng thêm container.
 */
export async function setup(project: TestProject): Promise<void> {
  [mysql, redis] = await Promise.all([
    new MySqlContainer(MYSQL_IMAGE).start(),
    new RedisContainer(REDIS_IMAGE).start(),
  ]);
  project.provide('mysqlRootUrl', mysql.getConnectionUri(true));
  project.provide('redisUrl', redis.getConnectionUrl());
}

export async function teardown(): Promise<void> {
  await Promise.all([mysql?.stop(), redis?.stop()]);
}
