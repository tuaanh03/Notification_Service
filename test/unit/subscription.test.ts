import { describe, expect, it } from 'vitest';
import { AppId, SubscriptionId, UserId, ValidationError } from '../../src/shared/kernel/index.ts';
import { Subscription } from '../../src/modules/subscriptions/domain/subscription.ts';

const AT = new Date('2026-09-17T10:00:00.000Z');

function subscription(): Subscription {
  return new Subscription({
    id: SubscriptionId.create(),
    userId: UserId.create(),
    appId: AppId.create(),
    channel: 'email',
    value: 'minh@example.com',
    manageToken: SubscriptionId.create(),
  });
}

describe('Subscription — unsubscribed ≠ invalid (BR-9)', () => {
  it('hard bounce đi vào invalid, KHÔNG BAO GIỜ vào unsubscribed', () => {
    const sub = subscription();
    sub.markInvalid('hard_bounce', AT);
    expect(sub.status).toBe('invalid');
    expect(sub.suppressedReason).toBe('hard_bounce');
  });

  it('user tự tắt thì vào unsubscribed', () => {
    const sub = subscription();
    sub.unsubscribe(AT);
    expect(sub.status).toBe('unsubscribed');
    expect(sub.suppressedReason).toBe('user_unsubscribe');
  });

  it('app service KHÔNG bật lại được địa chỉ đã hard bounce', () => {
    const sub = subscription();
    sub.markInvalid('hard_bounce', AT);
    expect(() => sub.resubscribe('user xác nhận qua hotline', AT)).toThrow(ValidationError);
  });

  it('bật lại được sau khi user tự tắt, nhưng bắt buộc có evidence', () => {
    const sub = subscription();
    sub.unsubscribe(AT);
    expect(() => sub.resubscribe('   ', AT)).toThrow(ValidationError);
    sub.resubscribe('user bấm đăng ký lại ngày 17/09', AT);
    expect(sub.status).toBe('active');
    expect(sub.suppressedReason).toBeNull();
  });

  it('sửa địa chỉ là đường khác hẳn resubscribe, và xoay token quản lý', () => {
    const sub = subscription();
    sub.markInvalid('hard_bounce', AT);
    const oldToken = sub.manageToken;
    sub.fixAddress('minh.nguyen@example.com', SubscriptionId.create(), AT);
    expect(sub.status).toBe('active');
    expect(sub.value).toBe('minh.nguyen@example.com');
    expect(sub.manageToken).not.toBe(oldToken);
  });
});

describe('Subscription — tắt tin không bắt buộc tách khỏi kênh chết', () => {
  it('opted_out_optional chặn tin thường nhưng không chặn tin mandatory', () => {
    const sub = subscription();
    sub.optOutOptional(AT);
    expect(sub.canReceive({ topicMandatory: false })).toEqual({
      allowed: false,
      reason: 'opted_out_optional',
    });
    expect(sub.canReceive({ topicMandatory: true })).toEqual({ allowed: true });
  });

  it('kênh chết chặn cả tin mandatory', () => {
    const sub = subscription();
    sub.markInvalid('complaint', AT);
    expect(sub.canReceive({ topicMandatory: true })).toEqual({ allowed: false, reason: 'invalid' });
  });
});
