import { audited, type CommandContext, type EventOutbox, type UnitOfWork } from '../../../../shared/application/index.ts';
import { AdminSessionId, type Clock } from '../../../../shared/kernel/index.ts';
import { AdminSession } from '../../domain/entities/admin-session.ts';
import type { Admin } from '../../domain/entities/admin.ts';
import { toAdminDto, type SignInDto } from '../dto.ts';
import type { AdminSessionRepository, SessionTokenFactory } from '../ports/index.ts';

export interface IssueSessionDeps {
  uow: UnitOfWork;
  outbox: EventOutbox;
  clock: Clock;
  sessions: AdminSessionRepository;
  tokens: SessionTokenFactory;
  /** Hạn TUYỆT ĐỐI của phiên. Hết hạn là đăng nhập lại, không gia hạn ngầm. */
  sessionTtlMs: number;
}

/**
 * Bước chung của MỌI cách đăng nhập (mật khẩu, Microsoft): tạo phiên + ghi audit `AdminSignedIn`.
 * Gọi khi đã chắc chắn `admin` được vào. `method` vào audit để biết phiên đến từ đường nào.
 */
export async function issueAdminSession(
  deps: IssueSessionDeps,
  admin: Admin,
  method: 'password' | 'microsoft',
  ctx: CommandContext,
): Promise<SignInDto> {
  const { uow, outbox, clock, sessions, tokens, sessionTtlMs } = deps;
  const issued = tokens.create();
  const now = clock.now();
  const session = new AdminSession({
    id: AdminSessionId.create(),
    adminId: admin.id,
    tokenHash: issued.hash,
    expiresAt: new Date(now.getTime() + sessionTtlMs),
    createdAt: now,
  });

  return uow.run(async () => {
    await sessions.insert(session);
    await outbox.append([
      {
        aggregateType: 'Admin',
        aggregateId: admin.id,
        eventType: 'AdminSignedIn',
        // Chỉ id phiên, KHÔNG token: audit_log không được chứa thứ dùng để mạo danh.
        payload: audited(ctx, { after: { sessionId: session.id, expiresAt: session.expiresAt.toISOString(), method } }),
      },
    ]);
    return { token: issued.token, expiresAt: session.expiresAt.toISOString(), admin: toAdminDto(admin) };
  });
}
