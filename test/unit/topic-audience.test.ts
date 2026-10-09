import { describe, expect, it } from 'vitest';
import { UserId } from '../../src/shared/kernel/index.ts';
import { selectTopicAudience, type AudienceCandidate } from '../../src/modules/notifications/domain/rules/topic-audience.ts';
import { MAX_PUBLICATION_RECIPIENTS, assertPublicationSize } from '../../src/modules/notifications/domain/entities/publication.ts';

const active = { status: 'active', suppressedReason: null, optedOutOptional: false } as const;
const id = (n: number) => UserId.parse(`00000000-0000-4000-8000-${String(n).padStart(12, '0')}`);
const candidate = (n: number, over: Partial<AudienceCandidate> = {}): AudienceCandidate => ({
  userId: id(n),
  subscription: active,
  preference: null,
  ...over,
});
const optOutTopic = { mandatory: false, defaultOptedIn: true };
const optInTopic = { mandatory: false, defaultOptedIn: false };
const mandatoryTopic = { mandatory: true, defaultOptedIn: true };

// Mọi luật ở đây là emailGate — test chỉ chốt rằng lần phát đi qua ĐÚNG cổng đó cho từng người.
describe('selectTopicAudience — người nhận của một lần phát (ADR-0028)', () => {
  const everyone = [
    candidate(1), // chưa chọn
    candidate(2, { preference: { optedIn: true } }),
    candidate(3, { preference: { optedIn: false } }),
    candidate(4, { subscription: null }),
    candidate(5, { subscription: { ...active, optedOutOptional: true } }),
    candidate(6, { subscription: { status: 'unsubscribed', suppressedReason: 'user_unsubscribe', optedOutOptional: false } }),
    candidate(7, { subscription: { status: 'invalid', suppressedReason: 'hard_bounce', optedOutOptional: false } }),
  ];

  it('topic mặc định bật: người chưa chọn + người đã bật', () => {
    expect(selectTopicAudience(everyone, optOutTopic)).toEqual([id(1), id(2)]);
  });

  it('topic mặc định tắt: chỉ người đã bật', () => {
    expect(selectTopicAudience(everyone, optInTopic)).toEqual([id(2)]);
  });

  it('topic bắt buộc: bỏ qua lựa chọn và L1, KHÔNG bỏ qua email đã ngắt / hỏng', () => {
    expect(selectTopicAudience(everyone, mandatoryTopic)).toEqual([id(1), id(2), id(3), id(5)]);
  });

  it('kết quả theo userId tăng dần, không phụ thuộc thứ tự đầu vào', () => {
    expect(selectTopicAudience([candidate(3), candidate(1), candidate(2)], optOutTopic)).toEqual([id(1), id(2), id(3)]);
  });

  it(`trần ${MAX_PUBLICATION_RECIPIENTS} người: đúng trần qua, vượt một người là PUBLICATION_TOO_LARGE`, () => {
    expect(() => assertPublicationSize(MAX_PUBLICATION_RECIPIENTS)).not.toThrow();
    expect(() => assertPublicationSize(MAX_PUBLICATION_RECIPIENTS + 1)).toThrow(
      expect.objectContaining({ issues: [expect.objectContaining({ code: 'PUBLICATION_TOO_LARGE' })] }),
    );
  });
});
