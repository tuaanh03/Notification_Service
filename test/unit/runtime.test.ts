import { describe, expect, it } from 'vitest';
import { selectConsumers, type ConsumerRegistration } from '../../src/composition/consumer-registry.ts';
import { toProblem } from '../../src/shared/http/problem.ts';
import { JobRunner } from '../../src/shared/jobs/index.ts';
import {
  ConcurrentTransitionError,
  CrossOrgViolationError,
  InvalidIdError,
  InvalidTransitionError,
  ValidationError,
} from '../../src/shared/kernel/index.ts';
import type { Logger } from '../../src/shared/observability/logger.ts';

const silent: Logger = {
  trace: () => undefined,
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  fatal: () => undefined,
  child: () => silent,
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('lỗi -> problem+json', () => {
  it('ValidationError -> 422, giữ nguyên issues có code để frontend map', () => {
    const p = toProblem(ValidationError.of('APP_NAME_REQUIRED', 'app name must not be empty', 'name'), '/admin/apps');
    expect(p).toMatchObject({
      status: 422,
      code: 'VALIDATION',
      instance: '/admin/apps',
      issues: [{ code: 'APP_NAME_REQUIRED', path: 'name' }],
    });
  });

  it.each([
    ['InvalidIdError', new InvalidIdError('AppId', 'x'), 400, 'INVALID_ID'],
    ['CrossOrgViolationError', new CrossOrgViolationError('person', 'a', 'b'), 403, 'CROSS_ORG'],
    // Huỷ thua race với lô đầu tiên (SM-3): 409, không phải 500.
    ['ConcurrentTransitionError', new ConcurrentTransitionError('Notification', 'n', 'queued'), 409, 'CONCURRENT_TRANSITION'],
    ['InvalidTransitionError', new InvalidTransitionError('Notification', 'sent', 'cancel'), 409, 'INVALID_TRANSITION'],
  ])('%s -> %i', (_name, err, status, code) => {
    expect(toProblem(err)).toMatchObject({ status, code });
  });

  it('lỗi 4xx của Fastify (JSON hỏng, body quá lớn) giữ status của nó', () => {
    expect(toProblem(Object.assign(new Error('Body is too large'), { statusCode: 413 }))).toMatchObject({
      status: 413,
      code: 'HTTP_413',
    });
  });

  it('lỗi lạ -> 500 với câu chung chung, KHÔNG lộ chi tiết nội bộ ra response', () => {
    const p = toProblem(new Error("ER_NO_SUCH_TABLE: Table 'ews.secret_stuff' doesn't exist"));
    expect(p).toMatchObject({ status: 500, code: 'INTERNAL', detail: 'internal server error' });
    expect(JSON.stringify(p)).not.toContain('secret_stuff');
  });
});

describe('JobRunner', () => {
  it('không chồng lần: job chậm hơn nhịp vẫn chỉ có một lần chạy tại một thời điểm', async () => {
    let active = 0;
    let maxActive = 0;
    let runs = 0;
    const runner = new JobRunner({
      logger: silent,
      jobs: [
        {
          name: 'slow',
          everyMs: 1,
          run: async () => {
            active += 1;
            maxActive = Math.max(maxActive, active);
            await sleep(20);
            runs += 1;
            active -= 1;
          },
        },
      ],
    });
    runner.start();
    await sleep(100);
    await runner.stop();
    expect(runs).toBeGreaterThan(1);
    expect(maxActive).toBe(1);
  });

  it('job lỗi thì nhịp sau vẫn chạy tiếp — một job hỏng không làm chết scheduler', async () => {
    let calls = 0;
    const runner = new JobRunner({
      logger: silent,
      jobs: [{ name: 'flaky', everyMs: 1, run: async () => { calls += 1; throw new Error('boom'); } }],
    });
    runner.start();
    await sleep(50);
    await runner.stop();
    expect(calls).toBeGreaterThan(1);
  });

  it('stop() chờ lần đang chạy xong rồi mới trả về, và không chạy thêm lần nào', async () => {
    let finished = false;
    let calls = 0;
    const runner = new JobRunner({
      logger: silent,
      jobs: [{ name: 'long', everyMs: 1, run: async () => { calls += 1; await sleep(50); finished = true; } }],
    });
    runner.start();
    await sleep(10);
    await runner.stop();
    expect(finished).toBe(true);
    await sleep(20);
    expect(calls).toBe(1);
  });
});

describe('chọn consumer group theo WORKER_GROUPS', () => {
  const reg = (group: string): ConsumerRegistration => ({ group, stream: `s.${group}`, handler: () => async () => undefined });
  const registry = [reg('resolver'), reg('delivery-email'), reg('accounting')];

  it('all -> mọi group', () => {
    expect(selectConsumers(registry, 'all').map((r) => r.group)).toEqual(['resolver', 'delivery-email', 'accounting']);
  });

  it('danh sách -> đúng các group đó', () => {
    expect(selectConsumers(registry, ['delivery-email']).map((r) => r.group)).toEqual(['delivery-email']);
  });

  // Gõ sai tên mà worker vẫn chạy = một hàng đợi không ai xử lý, lặng lẽ dồn lên.
  it('tên group không tồn tại -> lỗi ngay lúc khởi động', () => {
    expect(() => selectConsumers(registry, ['delivery-emial'])).toThrow(/unknown WORKER_GROUPS: delivery-emial/);
  });
});
