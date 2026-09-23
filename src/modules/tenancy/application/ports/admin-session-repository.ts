import type { AdminId, AdminSessionId } from '../../../../shared/kernel/index.ts';
import type { AdminSession } from '../../domain/entities/admin-session.ts';

export interface AdminSessionRepository {
  insert(session: AdminSession): Promise<void>;
  /** Tra theo BĂM của token — token gốc không bao giờ nằm trong bảng. */
  findByTokenHash(tokenHash: string): Promise<AdminSession | null>;
  deleteById(id: AdminSessionId): Promise<void>;
  /** Đổi mật khẩu -> đá mọi phiên đang mở của admin đó. */
  deleteByAdmin(adminId: AdminId): Promise<void>;
}
