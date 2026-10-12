import { audited, type CommandContext, type EventOutbox, type UnitOfWork } from '../../../../shared/application/index.ts';
import type { AdminId, Clock } from '../../../../shared/kernel/index.ts';
import type { AdminRepository } from '../ports/index.ts';

/** Trần số tài khoản mỗi lần tích — route ép bằng zod; bằng một trang lớn nhất của màn Danh bạ. */
export const MAX_MEMBER_LISTED_BATCH = 100;

/**
 * Super Admin tích / bỏ tích "hiện khi thêm thành viên" cho một lô tài khoản (màn Danh bạ).
 * Chỉ ghi những người thật sự đổi, mỗi người một dòng audit. Id không tồn tại thì bỏ qua — trang
 * console có thể cũ hơn DB, không đáng báo lỗi. Bỏ tích không gỡ ai khỏi org đang ở.
 */
export class SetMemberListed {
  private readonly deps: { uow: UnitOfWork; outbox: EventOutbox; clock: Clock; admins: AdminRepository };

  constructor(deps: SetMemberListed['deps']) {
    this.deps = deps;
  }

  async execute(input: { adminIds: readonly AdminId[]; listed: boolean }, ctx: CommandContext): Promise<{ changed: number }> {
    const { uow, outbox, clock, admins } = this.deps;
    return uow.run(async () => {
      const now = clock.now();
      const changed = (await admins.findManyByIds(input.adminIds)).filter((a) => a.setMemberListed(input.listed, now));
      await admins.updateMemberListed(
        changed.map((a) => a.id),
        input.listed,
        now,
      );
      await outbox.append(
        changed.map((a) => ({
          aggregateType: 'Admin',
          aggregateId: a.id,
          eventType: 'AdminMemberListedChanged',
          payload: audited(ctx, { before: { memberListed: !input.listed }, after: { memberListed: input.listed } }),
        })),
      );
      return { changed: changed.length };
    });
  }
}
