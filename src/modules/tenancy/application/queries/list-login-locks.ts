import { isEmail, normalizeEmail, type Clock } from '../../../../shared/kernel/index.ts';
import type { AdminRepository, LoginAttemptStore } from '../ports/index.ts';

/** Một dòng màn "Theo dõi & Bảo mật" (ADR-0039). */
export interface LoginLockDto {
  /** `email` / `ip` = khoá TẠM (tự mở lúc `until`); `account` = tài khoản bị KHOÁ HẲN, chỉ Super Admin mở. */
  kind: 'email' | 'ip' | 'account';
  /** Email (đã hạ chữ thường) hoặc địa chỉ IP. */
  subject: string;
  /** Tài khoản EWS ứng với email; `null` = IP, hoặc email không có tài khoản (người dò thử email bịa). */
  adminId: string | null;
  displayName: string | null;
  lockedAt: string;
  /** `null` với khoá hẳn. */
  until: string | null;
}

/**
 * Khoá đang giữ: khoá tạm trên Redis + tài khoản khoá hẳn trong MySQL. Email đã khoá hẳn thì không hiện thêm dòng
 * khoá tạm — mở khoá hẳn là gỡ luôn khoá tạm.
 */
export class ListLoginLocks {
  private readonly deps: { clock: Clock; admins: AdminRepository; attempts: LoginAttemptStore };

  constructor(deps: ListLoginLocks['deps']) {
    this.deps = deps;
  }

  async execute(): Promise<LoginLockDto[]> {
    const { clock, admins, attempts } = this.deps;
    const [temporary, locked] = await Promise.all([attempts.list(clock.now()), admins.listLocked()]);
    const lockedEmails = new Set<string>(locked.map((a) => a.email));
    const emails = temporary.filter((t) => t.kind === 'email' && isEmail(t.subject)).map((t) => normalizeEmail(t.subject));
    const byEmail = new Map((await admins.findManyByEmails(emails)).map((a) => [a.email as string, a]));

    return [
      ...locked.map(
        (a): LoginLockDto => ({
          kind: 'account',
          subject: a.email,
          adminId: a.id,
          displayName: a.displayName,
          lockedAt: (a.lockedAt ?? a.updatedAt).toISOString(),
          until: null,
        }),
      ),
      ...temporary
        .filter((t) => !(t.kind === 'email' && lockedEmails.has(t.subject)))
        .map((t): LoginLockDto => {
          const admin = t.kind === 'email' ? byEmail.get(t.subject) : undefined;
          return {
            kind: t.kind,
            subject: t.subject,
            adminId: admin?.id ?? null,
            displayName: admin?.displayName ?? null,
            lockedAt: t.lockedAt.toISOString(),
            until: t.until.toISOString(),
          };
        }),
    ];
  }
}
