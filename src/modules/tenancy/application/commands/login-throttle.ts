import { audited, type CommandContext, type EventOutbox, type UnitOfWork } from '../../../../shared/application/index.ts';
import type { Clock } from '../../../../shared/kernel/index.ts';
import type { Logger } from '../../../../shared/observability/logger.ts';
import type { Admin } from '../../domain/entities/admin.ts';
import { shouldLockPermanently, type LoginThrottlePolicy } from '../../domain/rules/login-throttle.ts';
import type { AdminRepository, AdminSessionRepository, LoginAttemptStore, LoginThrottlePolicySource } from '../ports/index.ts';

/**
 * Chặn đăng nhập mật khẩu sai nhiều lần (ADR-0039) — `LoginAdmin` gọi trước và sau bước kiểm mật khẩu.
 *
 * Bộ đếm hỏng (Redis chết) thì CHO QUA và ghi log: phiên đăng nhập nằm ở MySQL, khoá cả hệ thống vì mất bộ đếm là tự
 * gây sự cố lớn hơn thứ đang chống. Đọc chính sách hỏng (MySQL chết) thì đằng nào đăng nhập cũng không chạy -> ném.
 */
export class LoginThrottle {
  private readonly deps: {
    uow: UnitOfWork;
    outbox: EventOutbox;
    clock: Clock;
    logger: Logger;
    admins: AdminRepository;
    sessions: AdminSessionRepository;
    attempts: LoginAttemptStore;
    policy: LoginThrottlePolicySource;
  };

  constructor(deps: LoginThrottle['deps']) {
    this.deps = deps;
  }

  /** Email hoặc IP đang bị khoá tạm. Chính sách tắt -> không bao giờ chặn. */
  async isBlocked(subject: string, ip: string | null): Promise<boolean> {
    const policy = await this.deps.policy.current();
    if (!policy.enabled) return false;
    const until = await this.safely('read login lock', () => this.deps.attempts.lockedUntil(subject, ip, this.deps.clock.now()));
    return until !== null && until !== undefined;
  }

  /**
   * Ghi một lần sai. Vừa khoá tạm một tài khoản có thật -> audit `LoginLocked`; chuỗi khoá liên tiếp chạm ngưỡng ->
   * khoá hẳn + đá mọi phiên + audit `AdminLocked`. Email không có tài khoản / IP chỉ ghi log (audit gắn với tài khoản).
   */
  async recordFailure(subject: string, ip: string | null, admin: Admin | null, ctx: CommandContext): Promise<void> {
    const { clock, logger } = this.deps;
    const policy = await this.deps.policy.current();
    if (!policy.enabled) return;
    const now = clock.now();
    const outcome = await this.safely('record failed login', () => this.deps.attempts.recordFailure(subject, ip, policy, now));
    if (outcome === undefined) return;

    if (outcome.ipLockedUntil !== null) {
      logger.warn('login locked for ip after repeated failures', { ip, until: outcome.ipLockedUntil.toISOString() });
    }
    if (outcome.emailLockedUntil === null) return;
    if (admin === null) {
      logger.warn('login locked for unknown email after repeated failures', { until: outcome.emailLockedUntil.toISOString() });
      return;
    }
    await this.lockAccount(admin, policy, outcome.emailLockedUntil, outcome.streak, now, ctx);
  }

  /** Đăng nhập đúng: xoá bộ đếm + chuỗi khoá liên tiếp của email. */
  async clear(subject: string): Promise<void> {
    await this.safely('clear login failures', () => this.deps.attempts.clear(subject));
  }

  private async lockAccount(
    admin: Admin,
    policy: LoginThrottlePolicy,
    until: Date,
    streak: number,
    now: Date,
    ctx: CommandContext,
  ): Promise<void> {
    const { uow, outbox, admins, sessions } = this.deps;
    // Actor là chính tài khoản bị khoá: chưa ai đăng nhập, `ctx.actor` chỉ là chuỗi email đang thử.
    const actorCtx: CommandContext = { ...ctx, actor: { id: admin.id, type: 'admin' } };
    const permanent = shouldLockPermanently(policy, streak) && admin.lock(now);
    await uow.run(async () => {
      if (permanent) {
        await admins.updateLock(admin);
        await sessions.deleteByAdmin(admin.id);
      }
      await outbox.append([
        {
          aggregateType: 'Admin',
          aggregateId: admin.id,
          eventType: permanent ? 'AdminLocked' : 'LoginLocked',
          payload: audited(actorCtx, {
            after: permanent
              ? { email: admin.email, reason: 'repeated_failed_logins', lockouts: streak, sessionsRevoked: true }
              : { email: admin.email, until: until.toISOString(), failures: policy.maxFailures, lockouts: streak },
          }),
        },
      ]);
    });
  }

  private async safely<T>(what: string, work: () => Promise<T>): Promise<T | undefined> {
    try {
      return await work();
    } catch (error) {
      this.deps.logger.error(`failed to ${what}; login throttling skipped`, { error: String(error) });
      return undefined;
    }
  }
}
