import { randomUUID } from 'node:crypto';
import { Redis } from 'ioredis';
import { inject } from 'vitest';
import { createRedis, type RedisHandle } from '../../../src/shared/streams/index.ts';

/**
 * MỖI FILE TEST MỘT DATABASE LOGIC CỦA REDIS (1..15). Tên stream là toàn cục (`notif.queued`,
 * `audit.events`): dùng chung một db thì worker của file này (kể cả process worker thật mà
 * processes.test spawn) LẤY MẤT message của file khác. Số db cấp nguyên tử bằng INCR trên db 0 nên
 * các file chạy song song không trùng. Vitest nạp lại module cho từng file -> cache dưới đây là theo file.
 */
let fileRedisUrl: Promise<string> | undefined;

export function testRedisUrl(): Promise<string> {
  fileRedisUrl ??= allocateDatabase();
  return fileRedisUrl;
}

async function allocateDatabase(): Promise<string> {
  const base = inject('redisUrl');
  const admin = new Redis(base, { protocol: 2 });
  try {
    const n = await admin.incr('test:redis-db-counter');
    if (n > 15) throw new Error('out of Redis logical databases (1..15) for integration test files');
    const url = new URL(base);
    url.pathname = `/${n}`;
    return url.toString();
  } finally {
    admin.disconnect();
  }
}

export async function createTestRedis(): Promise<RedisHandle> {
  return createRedis({ url: await testRedisUrl(), connectionName: 'ews-test' });
}

/** Tên stream không trùng giữa các test/file chạy song song trên cùng một Redis. */
export function uniqueStream(prefix: string): string {
  return `test.${prefix}.${randomUUID().slice(0, 8)}`;
}

/** Chờ tới khi `check` trả true — cho test của vòng lặp `run`, tránh sleep cố định. */
export async function eventually(check: () => Promise<boolean>, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`condition not met within ${timeoutMs}ms`);
}
