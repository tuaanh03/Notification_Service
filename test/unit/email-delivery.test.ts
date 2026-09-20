import { describe, expect, it } from 'vitest';
import { SendEmail, type EmailProvider, type EmailSendResult, type OutgoingEmail } from '../../src/modules/delivery/application/index.ts';
import { DeliverEmailNotification } from '../../src/modules/notifications/application/commands/deliver-email-notification.ts';
import type { EmailDeliveryOutcome, UserEmailForDelivery } from '../../src/modules/notifications/application/ports/index.ts';
import { Notification } from '../../src/modules/notifications/domain/entities/notification.ts';
import { emailGate } from '../../src/modules/notifications/domain/rules/email-gate.ts';
import { emailContent } from '../../src/modules/notifications/domain/types/email-content.ts';
import { AppId, NotificationId, SubscriptionId, TopicId, UserId } from '../../src/shared/kernel/index.ts';
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

describe('emailGate — ghép L0/L1/L3 có sẵn cho một người nhận', () => {
  const active = { status: 'active' as const, suppressedReason: null, optedOutOptional: false };
  const optional = { mandatory: false, defaultOptedIn: true };
  const mandatory = { mandatory: true, defaultOptedIn: true };

  it.each([
    ['không có email', null, optional, null, 'no_channel'],
    ['email hard bounce', { status: 'invalid' as const, suppressedReason: 'hard_bounce' as const, optedOutOptional: false }, optional, null, 'invalid'],
    ['user tự ngắt email', { status: 'unsubscribed' as const, suppressedReason: 'user_unsubscribe' as const, optedOutOptional: false }, optional, null, 'suppressed'],
    ['tắt tin không bắt buộc (L1)', { ...active, optedOutOptional: true }, optional, null, 'opted_out_optional'],
    ['tắt topic (L3)', active, optional, { optedIn: false }, 'opted_out'],
    ['topic opt_in chưa chọn', active, { mandatory: false, defaultOptedIn: false }, null, 'opted_out'],
  ])('%s -> chặn: %s', (_name, subscription, topic, preference, reason) => {
    expect(emailGate({ subscription, topic, preference })).toEqual({ allowed: false, reason });
  });

  it('mandatory vượt L1 và L3 ...', () => {
    expect(emailGate({ subscription: { ...active, optedOutOptional: true }, topic: mandatory, preference: { optedIn: false } })).toEqual({
      allowed: true,
    });
  });

  it('... nhưng KHÔNG BAO GIỜ vượt L0', () => {
    for (const status of ['invalid', 'unsubscribed'] as const) {
      const gate = emailGate({ subscription: { ...active, status }, topic: mandatory, preference: null });
      expect(gate.allowed).toBe(false);
    }
  });
});

describe('SendEmail — thử lại CHỈ khi chắc chắn provider chưa nhận', () => {
  const email: OutgoingEmail = { to: 'a@company.com', subject: 's', html: 'h', text: null, notificationId: 'n-1' };

  function run(...script: (EmailSendResult | Error)[]) {
    const calls: number[] = [];
    const waits: number[] = [];
    const provider: EmailProvider = {
      name: 'fake',
      send: async () => {
        calls.push(1);
        const next = script.shift() ?? { kind: 'accepted', providerMessageId: 'x' };
        if (next instanceof Error) throw next;
        return next;
      },
    };
    const sendEmail = new SendEmail({ provider, sleeper: { sleep: async (ms) => void waits.push(ms) }, logger: silent });
    return { result: sendEmail.execute(email), calls, waits };
  }

  it('429 rồi thành công -> accepted sau 2 lần, chờ đúng Retry-After', async () => {
    const r = run({ kind: 'retryable', reason: 'HTTP 429', retryAfterMs: 1500 });
    expect(await r.result).toEqual({ kind: 'accepted', providerMessageId: 'x' });
    expect(r.calls).toHaveLength(2);
    expect(r.waits).toEqual([1500]);
  });

  it('retryable 3 lần -> dừng ở lần 3, kết quả rejected (chắc chắn chưa gửi)', async () => {
    const retry = { kind: 'retryable' as const, reason: 'HTTP 503', retryAfterMs: null };
    const r = run(retry, retry, retry);
    expect(await r.result).toMatchObject({ kind: 'rejected', reason: 'retry_exhausted: HTTP 503' });
    expect(r.calls).toHaveLength(3);
  });

  it('Retry-After vượt ngân sách 2 phút -> không chờ, dừng luôn', async () => {
    const r = run({ kind: 'retryable', reason: 'HTTP 429', retryAfterMs: 10 * 60_000 });
    expect((await r.result).kind).toBe('rejected');
    expect(r.waits).toEqual([]);
  });

  it.each([
    ['rejected', { kind: 'rejected' as const, reason: 'HTTP 400' }],
    ['unknown (timeout sau khi gửi)', { kind: 'unknown' as const, reason: 'timeout' }],
  ])('%s -> KHÔNG thử lại', async (_name, outcome) => {
    const r = run(outcome);
    expect(await r.result).toEqual(outcome);
    expect(r.calls).toHaveLength(1);
  });

  it('provider ném exception -> unknown (at-most-once: không biết thì không gửi lại)', async () => {
    const r = run(new Error('boom'));
    expect(await r.result).toMatchObject({ kind: 'unknown', reason: 'provider_threw: boom' });
    expect(r.calls).toHaveLength(1);
  });
});

describe('Notification — mốc vòng đời', () => {
  it('queued lúc tạo; sending / kết thúc do apply() đặt', () => {
    const t0 = new Date('2026-09-19T00:00:00.000Z');
    const t1 = new Date('2026-09-19T00:00:05.000Z');
    const t2 = new Date('2026-09-19T00:00:07.000Z');
    const n = new Notification({
      id: NotificationId.create(),
      appId: AppId.create(),
      topicId: TopicId.create(),
      origin: 'api',
      targetUserId: UserId.create(),
      content: emailContent({ subject: 's', html: 'h' }),
      createdAt: t0,
    });
    const actor = { id: 'email-sender', type: 'system' as const };
    expect(n.queuedAt).toEqual(t0);
    n.apply('first_batch_left', actor, t1);
    expect(n.sendingAt).toEqual(t1);
    expect(n.finishedAt).toBeNull();
    n.apply('all_accepted', actor, t2);
    expect(n.finishedAt).toEqual(t2);
  });
});

describe('DeliverEmailNotification — một dòng log cho MỌI kết cục (ĐX-0001)', () => {
  /** Fake tối thiểu: chỉ đủ để chạy hết 4 nhánh DeliveryOutcome, không chạm DB. */
  function harness(options: { notification: Notification | null; email?: UserEmailForDelivery | null; sendKind?: EmailDeliveryOutcome['kind'] }) {
    const lines: Array<{ msg: string; meta: Record<string, unknown> }> = [];
    const capture: Logger = { ...silent, info: (msg, meta) => void lines.push({ msg, meta: meta ?? {} }), child: () => capture };
    // Clock nhích 5ms mỗi lần đọc -> duration_ms tính được mà không cần hẹn giờ thật.
    let tick = 0;
    const topicId = options.notification?.topicId ?? TopicId.create();
    const deliver = new DeliverEmailNotification({
      uow: { run: async (work) => work() },
      outbox: { append: async () => undefined },
      clock: { now: () => new Date(2026, 8, 20, 0, 0, 0, (tick += 5)) },
      logger: capture,
      notifications: {
        insert: async () => undefined,
        findById: async () => options.notification,
        findByIdempotencyKey: async () => null,
        saveTransition: async () => undefined,
        listStuckSending: async () => [],
      },
      recipients: { findByNotification: async () => null, insert: async () => undefined, update: async () => undefined },
      emails: { find: async () => options.email ?? null },
      topics: {
        topicByKey: async () => null,
        topicById: async () => ({ topicId, key: 'order_updates', status: 'active', mandatory: false, defaultOptedIn: true }),
        preference: async () => null,
      },
      sender: {
        awaitCapacity: async () => undefined,
        send: async () =>
          options.sendKind === 'rejected'
            ? { kind: 'rejected', reason: 'mailbox full' }
            : { kind: 'accepted', providerMessageId: 'graph-1' },
      },
    });
    return { deliver, lines };
  }

  function queued() {
    return new Notification({
      id: NotificationId.create(),
      appId: AppId.create(),
      topicId: TopicId.create(),
      origin: 'api',
      targetUserId: UserId.create(),
      content: emailContent({ subject: 's', html: 'h' }),
      createdAt: new Date(2026, 8, 20),
    });
  }

  const reachable: UserEmailForDelivery = {
    subscriptionId: SubscriptionId.create(),
    address: 'nhanvien@company.com',
    status: 'active',
    suppressedReason: null,
    optedOutOptional: false,
  };

  it.each([
    ['gửi được', { notification: queued(), email: reachable }, 'sent', { provider_result: 'accepted', exclusion_reason: null }],
    ['provider từ chối', { notification: queued(), email: reachable, sendKind: 'rejected' as const }, 'failed', { provider_result: 'rejected', exclusion_reason: null }],
    ['gate chặn — chưa có email', { notification: queued(), email: null }, 'no_recipient', { provider_result: null, exclusion_reason: 'no_channel' }],
  ])('%s -> outcome %s, đủ trường, KHÔNG có dữ liệu cá nhân', async (_name, options, outcome, extra) => {
    const { deliver, lines } = harness(options);
    expect(await deliver.execute(options.notification.id)).toBe(outcome);
    expect(lines).toHaveLength(1);
    const [line] = lines;
    expect(line?.msg).toBe('email delivery finished');
    expect(line?.meta).toMatchObject({
      notification_id: options.notification.id,
      app_id: options.notification.appId,
      topic: 'order_updates',
      outcome,
      ...extra,
    });
    expect(line?.meta['duration_ms']).toBeGreaterThan(0);
    // Địa chỉ / tiêu đề / nội dung không được rơi vào log dù ở bất kỳ trường nào.
    expect(JSON.stringify(line?.meta)).not.toContain('company.com');
  });

  it('notification không còn queued -> vẫn ghi một dòng, app_id và topic để trống', async () => {
    const { deliver, lines } = harness({ notification: null });
    const id = NotificationId.create();
    expect(await deliver.execute(id)).toBe('skipped');
    expect(lines).toHaveLength(1);
    expect(lines[0]?.meta).toMatchObject({ notification_id: id, outcome: 'skipped', app_id: null, topic: null });
  });
});
