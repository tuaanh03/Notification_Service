import type { MessageHandler } from '../../../../shared/streams/contracts.ts';
import type { RecordAuditEntry } from '../../application/index.ts';

/**
 * Consumer group `audit-writer` trên stream `audit.events`: mọi domain event của mọi module -> một dòng
 * `audit_log`. Handler chỉ đổi message thành input của use case — idempotency, transaction, retry, DLQ
 * do khung `StreamConsumer` lo.
 */
export function auditWriterHandler(useCases: { recordAuditEntry: RecordAuditEntry }): MessageHandler {
  return (message) =>
    useCases.recordAuditEntry.execute({
      eventType: message.eventType,
      aggregateType: message.aggregateType,
      aggregateId: message.aggregateId,
      payload: message.payload,
      occurredAt: message.occurredAt,
    });
}
