import { describe, expect, it } from 'vitest';
import {
  decodeMessage,
  dlqOf,
  encodeOutboxRecord,
  PermanentMessageError,
  routeEvent,
  STREAMS,
  type OutboxRecord,
} from '../../src/shared/streams/index.ts';

const record: OutboxRecord = {
  outboxId: '42',
  stream: STREAMS.AUDIT_EVENTS,
  eventType: 'AppApproved',
  aggregateType: 'App',
  aggregateId: 'a-1',
  payload: { appId: 'a-1', note: 'có dấu' },
  createdAt: new Date('2026-09-18T01:02:03.456Z'),
};

describe('codec message', () => {
  it('encode rồi decode giữ nguyên nội dung', () => {
    const message = decodeMessage(record.stream, '1-0', encodeOutboxRecord(record), 1);
    expect(message).toEqual({
      id: '1-0',
      stream: STREAMS.AUDIT_EVENTS,
      eventType: 'AppApproved',
      aggregateType: 'App',
      aggregateId: 'a-1',
      payload: { appId: 'a-1', note: 'có dấu' },
      dedupKey: 'outbox:42',
      occurredAt: record.createdAt,
      deliveryCount: 1,
    });
  });

  // Relay XADD lại sau khi commit hỏng: message id đổi, khoá khử trùng phải giữ nguyên.
  it('dedupKey theo outbox id, không theo message id của Redis', () => {
    const fields = encodeOutboxRecord(record);
    expect(decodeMessage(record.stream, '1-0', fields, 1).dedupKey).toBe(
      decodeMessage(record.stream, '9-0', fields, 1).dedupKey,
    );
  });

  it.each([
    ['thiếu field', ['event_type', 'X']],
    ['payload không phải JSON', encodeOutboxRecord(record).map((v, i, a) => (a[i - 1] === 'payload' ? '{oops' : v))],
    ['payload là mảng', encodeOutboxRecord(record).map((v, i, a) => (a[i - 1] === 'payload' ? '[]' : v))],
    ['occurred_at sai', encodeOutboxRecord(record).map((v, i, a) => (a[i - 1] === 'occurred_at' ? 'x' : v))],
  ])('message hỏng (%s) -> PermanentMessageError, không thử lại', (_case, fields) => {
    expect(() => decodeMessage('s', '1-0', fields, 1)).toThrow(PermanentMessageError);
  });
});

describe('định tuyến event', () => {
  const event = (eventType: string) => ({ eventType, aggregateType: 'App', aggregateId: 'a-1', payload: {} });

  it('mọi event đều vào audit.events', () => {
    expect(routeEvent(event('Whatever'))).toEqual([STREAMS.AUDIT_EVENTS]);
  });

  it('NotificationQueued vào thêm notif.queued cho worker giải người nhận', () => {
    expect(routeEvent(event('NotificationQueued'))).toEqual([
      STREAMS.AUDIT_EVENTS,
      STREAMS.NOTIF_QUEUED,
    ]);
  });

  it('DLQ của mỗi stream là stream riêng', () => {
    expect(dlqOf(STREAMS.NOTIF_QUEUED)).toBe('notif.queued.dlq');
  });
});
