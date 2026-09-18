import { describe, expect, it } from 'vitest';
import { SegmentId, SubscriptionId, TopicId, UserId, PersonId } from '../../src/shared/kernel/index.ts';
import {
  resolveRecipients,
  type Candidate,
  type ResolutionRequest,
  type TopicView,
} from '../../src/modules/segments/domain/resolution-pipeline.ts';

const BUYERS = SegmentId.create();
const CHURNED = SegmentId.create();

const optionalTopic: TopicView = { id: TopicId.create(), mandatory: false, defaultOptedIn: true };
const mandatoryTopic: TopicView = { id: TopicId.create(), mandatory: true, defaultOptedIn: true };

function candidate(overrides: Partial<Candidate> = {}): Candidate {
  return {
    userId: UserId.create(),
    personId: null,
    segmentIds: [BUYERS],
    subscription: {
      id: SubscriptionId.create(),
      channel: 'email',
      value: 'minh@example.com',
      status: 'active',
      suppressedReason: null,
      optedOutOptional: false,
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
    expect(result.steps).toMatchObject({
      candidates: 2,
      deduped: 2,
      withChannel: 1,
      afterChannelGate: 1,
      afterExcluded: 1,
      expected: 1,
    });
  });
});
