import { randomUUID } from 'node:crypto';
import { inject } from 'vitest';
import { createRedis, type RedisHandle } from '../../../src/shared/streams/index.ts';

export function createTestRedis(): RedisHandle {
  return createRedis({ url: inject('redisUrl'), connectionName: 'ews-test' });
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
