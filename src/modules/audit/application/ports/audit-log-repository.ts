import type { AuditEntry } from '../../domain/entities/audit-entry.ts';

export interface AuditLogRepository {
  /** Append-only: không có update, không có delete (SM-8). */
  append(entry: AuditEntry): Promise<void>;
  listByTarget(targetType: string, targetId: string, limit: number): Promise<AuditEntry[]>;
}
