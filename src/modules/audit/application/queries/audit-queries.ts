import { toAuditEntryDto, type AuditEntryDto } from '../dto.ts';
import type { ActorDirectory, AuditLogRepository, AuditSearch } from '../ports/index.ts';

/** Một dòng nhật ký chung — kèm email / tên của người làm khi đó là tài khoản EWS. */
export interface AuditEventDto extends AuditEntryDto {
  actorEmail: string | null;
  actorName: string | null;
  /** Đối tượng là tài khoản EWS (`targetType = 'Admin'`) -> email của tài khoản đó; còn lại `null`. */
  targetEmail: string | null;
}

export interface AuditEventPageDto {
  items: AuditEventDto[];
  /** Tổng số khớp bộ lọc (không tính phân trang). */
  total: number;
  /** Đưa lại vào `cursor` để lấy trang kế; `null` = hết. */
  nextCursor: string | null;
}

/** Con trỏ trang = `<at ISO>|<audit_id>` của dòng cuối trang trước. Sai định dạng -> coi như trang đầu. */
export function parseAuditCursor(cursor: string | undefined): AuditSearch['before'] {
  if (!cursor) return undefined;
  const [at, id] = cursor.split('|');
  const date = at ? new Date(at) : null;
  return date && !Number.isNaN(date.getTime()) && id ? { at: date, id } : undefined;
}

export class AuditQueries {
  private readonly auditLog: AuditLogRepository;
  private readonly actors: ActorDirectory | undefined;

  constructor(deps: { auditLog: AuditLogRepository; actors?: ActorDirectory | undefined }) {
    this.auditLog = deps.auditLog;
    this.actors = deps.actors;
  }

  /**
   * Lịch sử của một đối tượng (`<AuditTrail>` ở mọi trang chi tiết), mới nhất trước — kèm email / tên người làm
   * (tra theo lô như `search`) để console hiện "ai đã làm" thay cho UUID.
   */
  async listByTarget(
    targetType: string,
    targetId: string,
    limit = 100,
  ): Promise<Array<AuditEntryDto & Pick<AuditEventDto, 'actorEmail' | 'actorName'>>> {
    const entries = await this.auditLog.listByTarget(targetType, targetId, limit);
    const people = this.actors ? await this.actors.describe(entries.map((e) => e.actor)) : new Map();
    return entries.map((e) => {
      const who = people.get(e.actor);
      return { ...toAuditEntryDto(e), actorEmail: who?.email ?? null, actorName: who?.displayName ?? null };
    });
  }

  /** Nhật ký chung (Super Admin): lọc + phân trang bằng con trỏ; tên người làm tra theo LÔ, một truy vấn mỗi trang. */
  async search(filter: AuditSearch): Promise<AuditEventPageDto> {
    const { items, total } = await this.auditLog.search(filter);
    // Một lần tra cho cả người làm lẫn đối tượng là tài khoản (khoá, mở khoá, đăng nhập… gắn vào `Admin`).
    const ids = [...items.map((e) => e.actor), ...items.filter((e) => e.targetType === 'Admin').map((e) => e.targetId)];
    const people = this.actors ? await this.actors.describe(ids) : new Map();
    const last = items.at(-1);
    return {
      items: items.map((e) => {
        const who = people.get(e.actor);
        const target = e.targetType === 'Admin' ? people.get(e.targetId) : undefined;
        return { ...toAuditEntryDto(e), actorEmail: who?.email ?? null, actorName: who?.displayName ?? null, targetEmail: target?.email ?? null };
      }),
      total,
      nextCursor: items.length === filter.limit && last ? `${last.at.toISOString()}|${last.id}` : null,
    };
  }
}
