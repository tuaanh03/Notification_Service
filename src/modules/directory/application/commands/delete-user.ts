import { audited, type CommandContext, type EventOutbox, type UnitOfWork } from '../../../../shared/application/index.ts';
import { NotFoundError, type AppId, type Clock } from '../../../../shared/kernel/index.ts';
import { USER_AGGREGATE, USER_EVENTS } from '../events.ts';
import type { UserRepository } from '../ports/index.ts';

/**
 * Người quản lý app xoá MỀM một người nhận trên console (`DELETE /admin/apps/:appId/users/:externalId`).
 *
 * Ẩn khỏi danh sách, tra cứu (`/v1` và `/admin` -> 404), gửi lẻ (RECIPIENT_NOT_FOUND) và phát vào chủ đề.
 * GIỮ lịch sử gửi và email (kể cả trạng thái tự ngắt) — app khai lại cùng mã thì dùng tiếp nguyên vẹn.
 * Thư đã xếp hàng trước lúc xoá vẫn đi (worker không kiểm lại người nhận).
 */
export class DeleteUser {
  private readonly deps: { uow: UnitOfWork; outbox: EventOutbox; clock: Clock; users: UserRepository };

  constructor(deps: DeleteUser['deps']) {
    this.deps = deps;
  }

  async execute(input: { appId: AppId; externalId: string }, ctx: CommandContext): Promise<void> {
    const { uow, outbox, clock, users } = this.deps;
    await uow.run(async () => {
      const user = await users.findByExternalId(input.appId, input.externalId);
      if (!user) throw new NotFoundError('user', input.externalId);
      await users.lockForUpdate(user.id);
      if (!user.remove(clock.now())) return;
      await users.update(user);
      await outbox.append([
        {
          aggregateType: USER_AGGREGATE,
          aggregateId: user.id,
          eventType: USER_EVENTS.deleted,
          payload: audited(ctx, { before: { externalId: input.externalId } }),
        },
      ]);
    });
  }
}
