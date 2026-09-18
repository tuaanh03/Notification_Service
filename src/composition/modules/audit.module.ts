import { AuditQueries, RecordAuditEntry } from '../../modules/audit/application/index.ts';
import { DrizzleAuditLogRepository } from '../../modules/audit/infrastructure/adapters/index.ts';
import { adminAuditRoutes, auditWriterHandler } from '../../modules/audit/interface/index.ts';
import { STREAMS } from '../../shared/streams/index.ts';
import type { Container } from '../container.ts';
import type { ModuleDefinition } from '../module-definition.ts';

/** Ghép module audit: consumer ghi `audit_log` từ `audit.events` + route tra lịch sử. */
export function auditModule(container: Container): ModuleDefinition {
  const auditLog = new DrizzleAuditLogRepository({ transactions: container.infra.transactions });
  return {
    name: 'audit',
    http: { admin: [adminAuditRoutes({ queries: new AuditQueries({ auditLog }) })] },
    consumers: [
      {
        group: 'audit-writer',
        stream: STREAMS.AUDIT_EVENTS,
        handler: auditWriterHandler({ recordAuditEntry: new RecordAuditEntry({ uow: container.ports.uow, auditLog }) }),
      },
    ],
  };
}
