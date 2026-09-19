import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FixedWindowRateLimiter } from '../../src/shared/rate-limit/index.ts';
import type { RedisHandle } from '../../src/shared/streams/index.ts';
import { createTestRedis } from './support/redis.ts';

let redis: RedisHandle;

beforeAll(async () => {
  redis = await createTestRedis();
});

afterAll(async () => {
  await redis.close();
});

/** Đồng hồ điều khiển tay; `sleep` giả tua đồng hồ thay vì chờ thật. */
function limiter(start = new Date('2026-09-19T10:00:10.000Z')) {
  let now = start.getTime();
  const sleeps: number[] = [];
  const instance = new FixedWindowRateLimiter({
    redis: redis.client,
    clock: { now: () => new Date(now) },
    sleep: async (ms) => {
      sleeps.push(ms);
      now += ms;
    },
    keyPrefix: `test:${randomUUID().slice(0, 8)}`,
  });
  return { instance, sleeps, advance: (ms: number) => (now += ms) };
}

describe('FixedWindowRateLimiter (Redis thật)', () => {
  it('nhiều worker đồng thời: đúng `limit` lượt mỗi phút, không hơn', async () => {
    const { instance } = limiter();
    const decisions = await Promise.all(Array.from({ length: 20 }, () => instance.tryAcquire('mailbox', 5)));
    expect(decisions.filter((d) => d.allowed)).toHaveLength(5);
    // Bị từ chối lúc 10:00:10 -> chờ tới 10:01:00.
    expect(decisions.find((d) => !d.allowed)).toEqual({ allowed: false, retryAfterMs: 50_000 });
  });

  it('sang phút mới thì có lượt lại; bucket khác nhau không ảnh hưởng nhau', async () => {
    const { instance, advance } = limiter();
    expect(await instance.tryAcquire('a', 1)).toEqual({ allowed: true });
    expect((await instance.tryAcquire('a', 1)).allowed).toBe(false);
    expect(await instance.tryAcquire('b', 1)).toEqual({ allowed: true });
    advance(50_000);
    expect(await instance.tryAcquire('a', 1)).toEqual({ allowed: true });
  });

  it('acquire chờ tới đầu phút sau rồi mới trả về', async () => {
    const { instance, sleeps } = limiter();
    await instance.acquire('mailbox', 2);
    await instance.acquire('mailbox', 2);
    expect(sleeps).toEqual([]);
    await instance.acquire('mailbox', 2);
    expect(sleeps).toHaveLength(1);
    expect(sleeps[0]).toBeGreaterThanOrEqual(50_000);
    expect(sleeps[0]).toBeLessThan(50_250);
  });

  it('key đếm có hạn — không để rác trong Redis', async () => {
    const prefix = `test:${randomUUID().slice(0, 8)}`;
    const instance = new FixedWindowRateLimiter({
      redis: redis.client,
      clock: { now: () => new Date('2026-09-19T10:00:00.000Z') },
      sleep: async () => undefined,
      keyPrefix: prefix,
    });
    await instance.tryAcquire('ttl', 10);
    const [key] = await redis.client.keys(`${prefix}:*`);
    expect(key).toBeDefined();
    const ttl = await redis.client.pttl(key ?? '');
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(120_000);
  });
});
