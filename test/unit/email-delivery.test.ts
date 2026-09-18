import { describe, expect, it } from 'vitest';
import { SendEmail, type EmailProvider, type EmailSendResult, type OutgoingEmail } from '../../src/modules/delivery/application/index.ts';
import { Notification } from '../../src/modules/notifications/domain/entities/notification.ts';
import { emailGate } from '../../src/modules/notifications/domain/rules/email-gate.ts';
import { emailContent } from '../../src/modules/notifications/domain/types/email-content.ts';
import { AppId, NotificationId, TopicId, UserId } from '../../src/shared/kernel/index.ts';
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
