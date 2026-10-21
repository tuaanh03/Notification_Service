import { audited, type CommandContext, type EventOutbox, type UnitOfWork } from '../../../../shared/application/index.ts';
import { isEmail, normalizeEmail, NotFoundError, type Clock } from '../../../../shared/kernel/index.ts';
import { loginSubject } from '../../domain/rules/login-throttle.ts';
import type { AdminRepository, LoginAttemptStore } from '../ports/index.ts';

export type UnlockLoginInput = { kind: 'email'; email: string } | { kind: 'ip'; ip: string };

/**
 * Super Admin mở khoá (ADR-0039): theo email = gỡ khoá tạm + bộ đếm + chuỗi khoá liên tiếp VÀ khoá hẳn của tài khoản;
 * theo IP = gỡ khoá tạm của IP. Không có gì để mở -> 404 (bấm hai lần, hoặc khoá vừa tự hết hạn).
 *
 * Audit `LoginUnlocked` gắn vào tài khoản được mở; IP / email không có tài khoản thì gắn vào người bấm (aggregate là
 * id dạng uuid — CLI không có id như vậy, nên CLI mở email lạ thì không có dòng audit, chỉ có log của CLI).
 */
export class UnlockLogin {
  private readonly deps: {
    uow: UnitOfWork;
    outbox: EventOutbox;
    clock: Clock;
    admins: AdminRepository;
    attempts: LoginAttemptStore;
  };

  constructor(deps: UnlockLogin['deps']) {
    this.deps = deps;
  }

  async execute(input: UnlockLoginInput, ctx: CommandContext): Promise<{ unlocked: true }> {
    const { uow, outbox, clock, admins, attempts } = this.deps;
    const subject = input.kind === 'email' ? loginSubject(input.email) : input.ip;
    const admin = input.kind === 'email' && isEmail(subject) ? await admins.findByEmail(normalizeEmail(subject)) : null;

    const temporary = await attempts.unlock(input.kind, subject);
    const permanent = admin?.unlock(clock.now()) ?? false;
    if (!temporary && !permanent) throw new NotFoundError('LoginLock', subject);

    const aggregateId = admin?.id ?? (ctx.source === 'admin_api' ? ctx.actor.id : null);
    await uow.run(async () => {
      if (permanent && admin !== null) await admins.updateLock(admin);
      if (aggregateId === null) return;
      await outbox.append([
        {
          aggregateType: 'Admin',
          aggregateId,
          eventType: 'LoginUnlocked',
          payload: audited(ctx, { after: { kind: input.kind, subject, temporary, permanent } }),
        },
      ]);
    });
    return { unlocked: true };
  }
}
