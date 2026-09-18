import { describe, expect, it } from 'vitest';
import { SegmentId, SubscriptionId, TopicId, UserId, PersonId } from '../../src/shared/kernel/index.ts';
import { effectiveOptIn } from '../../src/modules/topics/domain/rules/topic-consent.ts';
import {
  resolveRecipients,
  type Candidate,
  type ResolutionRequest,
  type TopicView,
} from '../../src/modules/segments/domain/rules/resolution-pipeline.ts';

const BUYERS = SegmentId.create();
const CHURNED = SegmentId.create();

const optionalTopic: TopicView = { id: TopicId.create(), mandatory: false, defaultOptedIn: true };
const mandatoryTopic: TopicView = { id: TopicId.create(), mandatory: true, defaultOptedIn: true };

function candidate(overrides: Partial<Candidate> = {}): Candidate {
  return {
    userId: UserId.create(),
    personId: null,
    isSystemApp: false,
    segmentIds: [BUYERS],
    subscription: {
      id: SubscriptionId.create(),
      channel: 'email',
      value: 'minh@example.com',
      status: 'active',
      suppressedReason: null,
      optedOutOptional: false,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    },
    preference: null,
    ...overrides,
  };
}

function request(overrides: Partial<ResolutionRequest> = {}): ResolutionRequest {
  return {
    mode: 'snapshot',
    channel: 'email',
    topic: optionalTopic,
    includedSegments: [BUYERS],
    computedAt: new Date('2026-09-17T00:00:00.000Z'),
    ...overrides,
  };
}

describe('pipeline giải người nhận', () => {
  it('người bình thường thì nhận được', () => {
    const result = resolveRecipients([candidate()], request());
    expect(result.expected).toBe(1);
    expect(result.recipients).toHaveLength(1);
    expect(result.exclusions).toEqual([]);
  });

  it('mode estimate chỉ đếm, không trả recipients', () => {
    const result = resolveRecipients([candidate()], request({ mode: 'estimate' }));
    expect(result.expected).toBe(1);
    expect(result.recipients).toEqual([]);
  });

  // Đây là case cố định quan trọng nhất của bước 6.
  it('excluded THẮNG included khi một người thuộc cả hai', () => {
    const both = candidate({ segmentIds: [BUYERS, CHURNED] });
    const result = resolveRecipients([both], request({ excludedSegments: [CHURNED] }));
    expect(result.expected).toBe(0);
    expect(result.exclusions).toEqual([{ userId: both.userId, reason: 'excluded' }]);
  });

  describe('ngoại lệ của topic mandatory', () => {
    it('BỎ QUA preference: user tắt topic vẫn nhận tin mandatory', () => {
      const optedOut = candidate({ preference: { optedIn: false } });
      expect(resolveRecipients([optedOut], request()).expected).toBe(0);
      expect(resolveRecipients([optedOut], request({ topic: mandatoryTopic })).expected).toBe(1);
    });

    it('BỎ QUA opted_out_optional: tin bắt buộc vẫn đi qua', () => {
      const optedOutOptional = candidate({
        subscription: { ...candidate().subscription!, optedOutOptional: true },
      });
      expect(resolveRecipients([optedOutOptional], request()).exclusions[0]?.reason).toBe(
        'opted_out_optional',
      );
      expect(resolveRecipients([optedOutOptional], request({ topic: mandatoryTopic })).expected).toBe(1);
    });

    // Ranh giới dễ code ngược nhất: mandatory KHÔNG cứu được kênh đã chết.
    it('KHÔNG BAO GIỜ bỏ qua kênh chết, kể cả mandatory', () => {
      const bounced = candidate({
        subscription: {
          ...candidate().subscription!,
          status: 'invalid',
          suppressedReason: 'hard_bounce',
        },
      });
      for (const topic of [optionalTopic, mandatoryTopic]) {
        const result = resolveRecipients([bounced], request({ topic }));
        expect(result.expected).toBe(0);
        expect(result.exclusions[0]?.reason).toBe('invalid');
      }
    });
  });

  it('không có subscription trên kênh đang gửi -> no_channel', () => {
    const push = candidate({
      subscription: { ...candidate().subscription!, channel: 'push' },
    });
    const result = resolveRecipients([push, candidate({ subscription: null })], request());
    expect(result.expected).toBe(0);
    expect(result.exclusions.map((e) => e.reason)).toEqual(['no_channel', 'no_channel']);
  });

  it('gộp trùng theo user: khớp nhiều segment vẫn chỉ nhận một lần', () => {
    const userId = UserId.create();
    const result = resolveRecipients(
      [candidate({ userId }), candidate({ userId, segmentIds: [CHURNED] })],
      request(),
    );
    expect(result.expected).toBe(1);
    expect(result.exclusions).toEqual([{ userId, reason: 'duplicate' }]);
  });

  it('broadcast toàn org gộp theo person: một người ở hai app chỉ nhận một lần', () => {
    const personId = PersonId.create();
    const shop = candidate({ personId });
    const seller = candidate({ personId });

    expect(resolveRecipients([shop, seller], request()).expected).toBe(2);
    expect(resolveRecipients([shop, seller], request({ dedupeBy: 'person' })).expected).toBe(1);
  });

  it('topic opt_in: chưa có preference thì KHÔNG gửi', () => {
    const optInTopic: TopicView = { id: TopicId.create(), mandatory: false, defaultOptedIn: false };
    const result = resolveRecipients([candidate()], request({ topic: optInTopic }));
    expect(result.expected).toBe(0);
    expect(result.exclusions[0]?.reason).toBe('opted_out');
  });

  it('các bước đều ghi lại số liệu để frontend vẽ pipeline', () => {
    const result = resolveRecipients(
      [candidate(), candidate({ subscription: null })],
      request(),
    );
    expect(result.steps).toEqual({
      candidates: 2,
      users: 2,
      withChannel: 1,
      afterChannelGate: 1,
      afterExcluded: 1,
      afterPreference: 1,
      expected: 1,
    });
  });

  // L3 chỉ được viết một lần (topic-consent.ts). Pipeline phải cho đúng kết quả của hàm đó
  // trên mọi tổ hợp — nếu ai viết lại rule trong pipeline, test này bắt được.
  it('L3 của pipeline khớp effectiveOptIn trên mọi tổ hợp', () => {
    for (const mandatory of [false, true]) {
      for (const defaultOptedIn of [false, true]) {
        for (const preference of [null, { optedIn: false }, { optedIn: true }]) {
          const topic: TopicView = { id: TopicId.create(), mandatory, defaultOptedIn };
          const result = resolveRecipients([candidate({ preference })], request({ topic }));
          expect(result.expected).toBe(effectiveOptIn(topic, preference) ? 1 : 0);
        }
      }
    }
  });
});

// Lọc trước, gộp sau: xem comment đầu resolution-pipeline.ts.
describe('gộp theo person (broadcast toàn org / app SYS)', () => {
  const byPerson = (overrides: Partial<ResolutionRequest> = {}) =>
    request({ dedupeBy: 'person', ...overrides });
  const at = (iso: string) => new Date(iso);
  const withSub = (c: Candidate, patch: Partial<NonNullable<Candidate['subscription']>>): Candidate => ({
    ...c,
    subscription: { ...c.subscription!, ...patch },
  });

  it('user đầu danh sách chết kênh -> vẫn nhận qua user kia của cùng người', () => {
    const personId = PersonId.create();
    const dead = withSub(candidate({ personId }), { status: 'invalid', suppressedReason: 'hard_bounce' });
    const alive = candidate({ personId });
    const noChannel = candidate({ personId, subscription: null });

    const result = resolveRecipients([dead, noChannel, alive], byPerson());
    expect(result.expected).toBe(1);
    expect(result.recipients.map((r) => r.userId)).toEqual([alive.userId]);
    expect(result.exclusions).toEqual(
      expect.arrayContaining([
        { userId: dead.userId, reason: 'invalid' },
        { userId: noChannel.userId, reason: 'no_channel' },
      ]),
    );
  });

  it('một user thuộc segment excluded -> cả người bị loại', () => {
    const personId = PersonId.create();
    const shop = candidate({ personId });
    const seller = candidate({ personId, segmentIds: [CHURNED] });

    const result = resolveRecipients([shop, seller], byPerson({ excludedSegments: [CHURNED] }));
    expect(result.expected).toBe(0);
    expect(result.exclusions.map((e) => e.reason)).toEqual(['excluded', 'excluded']);
  });

  it('user excluded dù đã chết kênh vẫn kéo cả người ra khỏi danh sách', () => {
    const personId = PersonId.create();
    const excludedNoChannel = candidate({ personId, segmentIds: [CHURNED], subscription: null });
    const other = candidate({ personId });

    const result = resolveRecipients([excludedNoChannel, other], byPerson({ excludedSegments: [CHURNED] }));
    expect(result.expected).toBe(0);
  });

  it('một user tắt topic -> cả người không nhận', () => {
    const personId = PersonId.create();
    const optedIn = candidate({ personId, preference: { optedIn: true } });
    const optedOut = candidate({ personId, preference: { optedIn: false } });

    const result = resolveRecipients([optedIn, optedOut], byPerson());
    expect(result.expected).toBe(0);
    expect(result.exclusions.map((e) => e.reason)).toEqual(['opted_out', 'opted_out']);
  });

  it('một user tắt topic nhưng topic mandatory -> vẫn nhận', () => {
    const personId = PersonId.create();
    const optedOut = candidate({ personId, preference: { optedIn: false } });
    const other = candidate({ personId });
    expect(resolveRecipients([optedOut, other], byPerson({ topic: mandatoryTopic })).expected).toBe(1);
  });

  it('đại diện: user của app SYS được ưu tiên trước', () => {
    const personId = PersonId.create();
    const older = withSub(candidate({ personId }), { createdAt: at('2025-01-01T00:00:00.000Z') });
    const sys = candidate({ personId, isSystemApp: true });

    const result = resolveRecipients([older, sys], byPerson());
    expect(result.recipients.map((r) => r.userId)).toEqual([sys.userId]);
    expect(result.exclusions).toEqual([{ userId: older.userId, reason: 'duplicate' }]);
  });

  it('đại diện: không có SYS thì lấy subscription tạo sớm nhất', () => {
    const personId = PersonId.create();
    const newer = withSub(candidate({ personId }), { createdAt: at('2026-06-01T00:00:00.000Z') });
    const older = withSub(candidate({ personId }), { createdAt: at('2025-06-01T00:00:00.000Z') });
    expect(resolveRecipients([newer, older], byPerson()).recipients.map((r) => r.userId)).toEqual([
      older.userId,
    ]);
  });

  it('đại diện: hoà mọi tiêu chí thì lấy userId nhỏ nhất', () => {
    const personId = PersonId.create();
    const a = candidate({ personId });
    const b = candidate({ personId });
    const smaller = a.userId < b.userId ? a.userId : b.userId;
    expect(resolveRecipients([a, b], byPerson()).recipients.map((r) => r.userId)).toEqual([smaller]);
  });

  it('đảo thứ tự đầu vào không đổi kết quả', () => {
    const p1 = PersonId.create();
    const p2 = PersonId.create();
    const input = [
      withSub(candidate({ personId: p1 }), { status: 'invalid', suppressedReason: 'hard_bounce' }),
      withSub(candidate({ personId: p1 }), { createdAt: at('2026-03-01T00:00:00.000Z') }),
      withSub(candidate({ personId: p1 }), { createdAt: at('2026-02-01T00:00:00.000Z') }),
      candidate({ personId: p2, isSystemApp: true }),
      candidate({ personId: p2 }),
      candidate(),
    ];
    const summary = (cs: Candidate[]) => {
      const result = resolveRecipients(cs, byPerson());
      const sortBy = <T extends { userId: string }>(xs: readonly T[]) =>
        [...xs].sort((x, y) => x.userId.localeCompare(y.userId));
      return { recipients: sortBy(result.recipients), exclusions: sortBy(result.exclusions) };
    };
    expect(summary([...input].reverse())).toEqual(summary(input));
    expect(summary(input).recipients).toHaveLength(3);
  });
});
