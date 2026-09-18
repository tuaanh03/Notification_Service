import type { AuditEntry } from '../domain/entities/audit-entry.ts';

export interface AuditEntryDto {
  id: string;
  actor: string;
  actorType: string;
  action: string;
  targetType: string;
  targetId: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  source: string;
  at: string;
}

export const toAuditEntryDto = (e: AuditEntry): AuditEntryDto => ({
  id: e.id,
  actor: e.actor,
  actorType: e.actorType,
  action: e.action,
  targetType: e.targetType,
  targetId: e.targetId,
  before: e.before,
  after: e.after,
  source: e.source,
  at: e.at.toISOString(),
});
