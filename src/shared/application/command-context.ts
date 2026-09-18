import type { ActorType } from '../kernel/enums.ts';

/** Ai gây ra thay đổi — đi vào payload của event, và từ đó vào `audit_log`. */
export interface Actor {
  id: string;
  type: ActorType;
}

/** Cửa nào đưa lệnh vào hệ thống — cột `source` của `audit_log`. */
export type CommandSource = 'admin_api' | 'v1_api' | 'worker' | 'scheduler' | 'system';

/**
 * Tham số thứ hai của MỌI command: không phải dữ liệu nghiệp vụ mà là "ai, qua cửa nào".
 * Interface (route / consumer) dựng nó từ caller đã xác thực; command không tự đoán.
 */
export interface CommandContext {
  actor: Actor;
  source: CommandSource;
}

/**
 * Quy ước payload cho event cần audit: `actor` + `source` luôn có; `before` / `after` khi có thay đổi
 * trạng thái. Consumer `audit-writer` đọc đúng các khoá này — module khác không phải biết audit tồn tại.
 */
export interface AuditedPayload {
  actor: Actor;
  source: CommandSource;
  before?: Record<string, unknown> | undefined;
  after?: Record<string, unknown> | undefined;
  [key: string]: unknown;
}

export function audited(
  ctx: CommandContext,
  change: { before?: Record<string, unknown>; after?: Record<string, unknown> } & Record<string, unknown> = {},
): AuditedPayload {
  return { actor: ctx.actor, source: ctx.source, ...change };
}
