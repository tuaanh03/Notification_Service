import { PermanentMessageError, type StreamMessage } from './contracts.ts';

/** Một dòng outbox đã sẵn sàng đẩy lên stream. */
export interface OutboxRecord {
  outboxId: string;
  stream: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  payload: unknown;
  createdAt: Date;
}

/**
 * Hình dạng trên dây của một message: danh sách phẳng field/value (chuỗi) của XADD.
 * Tên field snake_case, ổn định — consumer ở phiên bản khác vẫn đọc được.
 */
export function encodeOutboxRecord(record: OutboxRecord): string[] {
  return [
    'outbox_id', record.outboxId,
    'event_type', record.eventType,
    'aggregate_type', record.aggregateType,
    'aggregate_id', record.aggregateId,
    'occurred_at', record.createdAt.toISOString(),
    'payload', JSON.stringify(record.payload ?? {}),
  ];
}

/** Ngược lại của encode. Message hỏng -> PermanentMessageError (thử lại không bao giờ khỏi). */
export function decodeMessage(
  stream: string,
  id: string,
  fields: readonly string[],
  deliveryCount: number,
): StreamMessage {
  const map = new Map<string, string>();
  for (let i = 0; i + 1 < fields.length; i += 2) map.set(fields[i]!, fields[i + 1]!);

  const required = (name: string): string => {
    const value = map.get(name);
    if (value === undefined || value === '') {
      throw new PermanentMessageError(`message ${stream}/${id} is missing field "${name}"`);
    }
    return value;
  };

  let payload: unknown;
  try {
    payload = JSON.parse(required('payload'));
  } catch (err) {
    if (err instanceof PermanentMessageError) throw err;
    throw new PermanentMessageError(`message ${stream}/${id} has invalid JSON payload`, { cause: err });
  }
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new PermanentMessageError(`message ${stream}/${id} payload must be a JSON object`);
  }
  const occurredAt = new Date(required('occurred_at'));
  if (Number.isNaN(occurredAt.getTime())) {
    throw new PermanentMessageError(`message ${stream}/${id} has invalid occurred_at`);
  }

  return {
    id,
    stream,
    eventType: required('event_type'),
    aggregateType: required('aggregate_type'),
    aggregateId: required('aggregate_id'),
    payload: payload as Record<string, unknown>,
    dedupKey: `outbox:${required('outbox_id')}`,
    occurredAt,
    deliveryCount,
  };
}
