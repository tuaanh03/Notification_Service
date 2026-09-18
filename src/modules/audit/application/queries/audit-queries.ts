import { toAuditEntryDto, type AuditEntryDto } from '../dto.ts';
import type { AuditLogRepository } from '../ports/index.ts';

export class AuditQueries {
  private readonly auditLog: AuditLogRepository;

  constructor(deps: { auditLog: AuditLogRepository }) {
    this.auditLog = deps.auditLog;
  }

  /** Lịch sử của một đối tượng (`<AuditTrail>` ở mọi trang chi tiết), mới nhất trước. */
  async listByTarget(targetType: string, targetId: string, limit = 100): Promise<AuditEntryDto[]> {
    return (await this.auditLog.listByTarget(targetType, targetId, limit)).map(toAuditEntryDto);
  }
}
