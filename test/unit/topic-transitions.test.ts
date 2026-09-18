import { describe, expect, it } from 'vitest';
import { Topic } from '../../src/modules/topics/domain/entities/topic.ts';
import { AppId, InvalidTransitionError, TopicId, ValidationError } from '../../src/shared/kernel/index.ts';

const AT = new Date('2026-09-19T00:00:00.000Z');
const topic = () => new Topic({ id: TopicId.create(), appId: AppId.create(), key: 'order_updates', name: 'Đơn hàng', createdAt: AT });

describe('vòng đời topic', () => {
  it('draft -> active -> suspended -> active', () => {
    const t = topic();
    expect(t.status).toBe('draft');
    t.apply('activate', AT);
    expect(t.canSend).toBe(true);
    t.apply('suspend', AT);
    expect(t.status).toBe('suspended');
    t.apply('activate', AT);
    expect(t.status).toBe('active');
  });

  it('sai đường -> InvalidTransitionError (draft không suspend được; active không activate lại)', () => {
    expect(() => topic().apply('suspend', AT)).toThrow(InvalidTransitionError);
    const t = topic();
    t.apply('activate', AT);
    expect(() => t.apply('activate', AT)).toThrow(InvalidTransitionError);
  });

  it('tên rỗng -> TOPIC_NAME_REQUIRED', () => {
    expect(() => new Topic({ id: TopicId.create(), appId: AppId.create(), key: 'k1', name: ' ', createdAt: AT })).toThrow(
      ValidationError,
    );
  });
});
