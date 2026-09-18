import type { UnitOfWork } from '../../../../shared/application/index.ts';
import { ACTOR_TYPES, AuditId, type ActorType } from '../../../../shared/kernel/index.ts';
import { AuditEntry } from '../../domain/entities/audit-entry.ts';
import type { AuditLogRepository } from '../ports/index.ts';

/** Một domain event bất kỳ, đã rời module phát ra nó. */
export interface RecordAuditEntryInput {
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  payload: Record<string, unknown>;
  occurredAt: Date;
}

const KNOWN_ACTOR_TYPES = new Set<string>(ACTOR_TYPES);

/**
 * Ghi một dòng `audit_log` từ một domain event. Audit KHÔNG biết module nào phát event — chỉ đọc quy
 * ước `AuditedPayload` (actor, source, before, after). Event thiếu actor vẫn được ghi, với actor
 * `system`: thiếu thông tin thì ghi nhận là thiếu, không bỏ dòng audit.
 *
 * `at` là lúc event XẢY RA (outbox created_at), không phải lúc worker xử lý — worker có thể chạy trễ.
 */
export class RecordAuditEntry {
  private readonly deps: { uow: UnitOfWork; auditLog: AuditLogRepository };

  constructor(deps: RecordAuditEntry['deps']) {
    this.deps = deps;
  }

  async execute(input: RecordAuditEntryInput): Promise<void> {
    const { payload } = input;
    const actor = isRecord(payload['actor']) ? payload['actor'] : {};
    const actorType = String(actor['type'] ?? 'system');

    const entry = new AuditEntry({
      id: AuditId.create(),
      actor: String(actor['id'] ?? 'system').slice(0, 64),
      actorType: KNOWN_ACTOR_TYPES.has(actorType) ? (actorType as ActorType) : 'system',
      action: input.eventType.slice(0, 96),
      targetType: input.aggregateType.slice(0, 64),
      targetId: input.aggregateId.slice(0, 64),
      before: isRecord(payload['before']) ? payload['before'] : null,
      after: isRecord(payload['after']) ? payload['after'] : null,
      source: String(payload['source'] ?? 'unknown').slice(0, 64),
      at: input.occurredAt,
    });
    await this.deps.uow.run(() => this.deps.auditLog.append(entry));
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
