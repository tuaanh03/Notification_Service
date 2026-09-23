import { audited, type CommandContext, type EventOutbox, type UnitOfWork } from '../../../../shared/application/index.ts';
import type { AdminSessionRepository, SessionTokenFactory } from '../ports/index.ts';

/**
 * Đăng xuất = XOÁ dòng phiên. Request ngay sau đó bị từ chối, không chờ hết hạn — đây chính là
 * lý do phiên nằm trong DB chứ không phải trong một token tự chứa.
 *
 * Không tìm thấy phiên thì coi như đã đăng xuất: gọi lại lần nữa không phải lỗi.
 */
export class LogoutAdmin {
  private readonly deps: { uow: UnitOfWork; outbox: EventOutbox; sessions: AdminSessionRepository; tokens: SessionTokenFactory };

  constructor(deps: LogoutAdmin['deps']) {
    this.deps = deps;
  }

  async execute(input: { token: string }, ctx: CommandContext): Promise<{ endedSession: boolean }> {
    const { uow, outbox, sessions, tokens } = this.deps;
    const session = await sessions.findByTokenHash(tokens.hashOf(input.token));
    if (session === null) return { endedSession: false };

    return uow.run(async () => {
      await sessions.deleteById(session.id);
      await outbox.append([
        {
          aggregateType: 'Admin',
          aggregateId: session.adminId,
          eventType: 'AdminSignedOut',
          payload: audited(ctx, { before: { sessionId: session.id } }),
        },
      ]);
      return { endedSession: true };
    });
  }
}
