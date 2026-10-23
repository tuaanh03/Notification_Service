import { describe, expect, it } from 'vitest';
import { routeEvent, STREAMS } from '../../src/shared/streams/index.ts';

/** Định tuyến event -> stream (ADR-0013), làn ưu tiên cho tin bắt buộc (ADR-0041). */
describe('routeEvent', () => {
  const queued = (payload: Record<string, unknown>) => ({
    aggregateType: 'Notification',
    aggregateId: 'n1',
    eventType: 'NotificationQueued',
    payload,
  });

  it('thư thường -> notif.queued; tin bắt buộc (priority: true) -> notif.queued.priority, không vào cả hai', () => {
    expect(routeEvent(queued({}))).toEqual([STREAMS.AUDIT_EVENTS, STREAMS.NOTIF_QUEUED]);
    expect(routeEvent(queued({ priority: true }))).toEqual([STREAMS.AUDIT_EVENTS, STREAMS.NOTIF_QUEUED_PRIORITY]);
  });

  it('cờ priority chỉ có nghĩa với NotificationQueued', () => {
    expect(routeEvent({ ...queued({ priority: true }), eventType: 'NotificationScheduled' })).toEqual([STREAMS.AUDIT_EVENTS]);
  });
});
