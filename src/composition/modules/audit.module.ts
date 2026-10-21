import { AuditQueries, RecordAuditEntry } from '../../modules/audit/application/index.ts';
import { DrizzleAuditLogRepository, TenancyActorDirectory } from '../../modules/audit/infrastructure/adapters/index.ts';
import type { DescribeAdmins } from '../../modules/tenancy/application/index.ts';
import { adminAuditRoutes, auditWriterHandler } from '../../modules/audit/interface/index.ts';
import { STREAMS } from '../../shared/streams/index.ts';
import type { Container } from '../container.ts';
import type { ModuleDefinition } from '../module-definition.ts';

/** Ghép module audit: consumer ghi `audit_log` từ `audit.events` + route tra lịch sử (cần tenancy để gắn tên người làm). */
export function auditModule(container: Container, dependencies: { describeAdmins: DescribeAdmins }): ModuleDefinition {
  const auditLog = new DrizzleAuditLogRepository({ transactions: container.infra.transactions });
  const actors = new TenancyActorDirectory(dependencies);
  return {
    name: 'audit',
    http: { admin: [adminAuditRoutes({ queries: new AuditQueries({ auditLog, actors }) })] },
    consumers: [
      {
        group: 'audit-writer',
        stream: STREAMS.AUDIT_EVENTS,
        handler: auditWriterHandler({ recordAuditEntry: new RecordAuditEntry({ uow: container.ports.uow, auditLog }) }),
      },
    ],
  };
}
