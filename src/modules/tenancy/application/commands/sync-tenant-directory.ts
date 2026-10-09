import { audited, type CommandContext, type EventOutbox, type UnitOfWork } from '../../../../shared/application/index.ts';
import { AdminId, isEmail, normalizeEmail, UpstreamError, ValidationError, type Clock } from '../../../../shared/kernel/index.ts';
import { Admin } from '../../domain/entities/admin.ts';
import type { AccountRepository, AdminRepository, DirectoryPerson, TenantDirectory } from '../ports/index.ts';

/** Đếm theo kết quả — route trả nguyên, console hiện con số. Không kèm tên hay email của ai. */
export interface DirectorySyncDto {
  /** Số người hợp lệ đọc được từ M365 (đang bật, nhân viên, có email). */
  total: number;
  created: number;
  linked: number;
  renamed: number;
  unchanged: number;
  /** Email đã thuộc một tài khoản gắn với người M365 KHÁC — để nguyên, không đè. */
  conflicts: number;
}

type Outcome = 'created' | 'linked' | 'renamed' | 'unchanged' | 'conflicts';

/**
 * Đồng bộ danh bạ tenant M365 thành tài khoản EWS (ADR-0027) — CÙNG luật với lần đăng nhập M365 đầu
 * tiên (ADR-0024), chỉ khác là chạy cho cả tenant một lần:
 *   đã gắn `oid`              -> chỉ cập nhật tên
 *   có email, chưa gắn `oid`  -> gắn `oid` (+ tên)
 *   chưa có                   -> tạo vai `user`, không mật khẩu, account cũ nhất, gắn sẵn `oid`
 *   email gắn `oid` KHÁC       -> bỏ qua, đếm vào `conflicts`
 *
 * Mỗi người một transaction nhỏ: lỗi một người không làm hỏng cả lượt, và chạy chồng với lần đăng nhập
 * đầu của chính người đó (hay một lượt đồng bộ khác) thì khoá duy nhất quyết — lần thua đọc lại rồi so.
 * Chạy lại bao nhiêu lần cũng được. Không xoá / khoá ai đã rời tenant.
 */
export class SyncTenantDirectory {
  private readonly deps: {
    uow: UnitOfWork;
    outbox: EventOutbox;
    clock: Clock;
    directory: TenantDirectory;
    accounts: AccountRepository;
    admins: AdminRepository;
  };

  constructor(deps: SyncTenantDirectory['deps']) {
    this.deps = deps;
  }

  async execute(ctx: CommandContext): Promise<DirectorySyncDto> {
    const { directory, accounts, uow, outbox } = this.deps;
    if (!directory.configured) {
      throw new UpstreamError(directory.unavailableCode, 'Microsoft 365 directory is not available', 503);
    }
    const account = await accounts.findOldest();
    if (account === null) throw ValidationError.of('NO_ACCOUNT', 'EWS has no account to sync into yet');

    const people = await directory.listPeople();
    const result: DirectorySyncDto = { total: 0, created: 0, linked: 0, renamed: 0, unchanged: 0, conflicts: 0 };
    for (const person of people) {
      if (!isEmail(person.email)) continue;
      result.total += 1;
      result[await this.syncOne(person, account.id, ctx)] += 1;
    }

    // Một dòng audit cho cả lượt: ai bấm, lúc nào, kết quả — từng tài khoản tạo / gắn đã có event riêng.
    await uow.run(() =>
      outbox.append([
        { aggregateType: 'Account', aggregateId: account.id, eventType: 'TenantDirectorySynced', payload: audited(ctx, { after: { ...result } }) },
      ]),
    );
    return result;
  }

  private async syncOne(person: DirectoryPerson, accountId: Admin['accountId'], ctx: CommandContext): Promise<Outcome> {
    const { admins, uow, outbox, clock } = this.deps;
    const now = clock.now();

    const linked = await admins.findByMicrosoftOid(person.oid);
    if (linked !== null) {
      if (!linked.rename(person.displayName, now)) return 'unchanged';
      await admins.updateDisplayName(linked);
      return 'renamed';
    }

    const email = normalizeEmail(person.email);
    const existing = await admins.findByEmail(email);
    if (existing !== null) {
      if (existing.microsoftOid !== null) return 'conflicts';
      existing.linkMicrosoft(person.oid, now);
      existing.rename(person.displayName, now);
      const ok = await uow.run(async () => {
        if (!(await admins.linkMicrosoft(existing))) return false;
        await admins.updateDisplayName(existing);
        await outbox.append([
          {
            aggregateType: 'Admin',
            aggregateId: existing.id,
            eventType: 'AdminMicrosoftLinked',
            payload: audited(ctx, { after: { microsoftOid: person.oid, via: 'm365_directory_sync' } }),
          },
        ]);
        return true;
      });
      return ok ? 'linked' : this.afterRace(person.oid);
    }

    const admin = new Admin({
      id: AdminId.create(),
      accountId,
      email,
      role: 'user',
      passwordHash: null,
      microsoftOid: person.oid,
      displayName: person.displayName,
      createdAt: now,
    });
    const inserted = await uow.run(async () => {
      if (!(await admins.insertIfAbsent(admin))) return false;
      await outbox.append([
        {
          aggregateType: 'Admin',
          aggregateId: admin.id,
          eventType: 'AdminCreated',
          payload: audited(ctx, {
            after: { email: admin.email, role: admin.role, hasPassword: false, microsoftOid: person.oid, via: 'm365_directory_sync' },
          }),
        },
      ]);
      return true;
    });
    return inserted ? 'created' : this.afterRace(person.oid);
  }

  /** Bị lần khác (đăng nhập đầu / lượt đồng bộ khác) ghi trước: cùng `oid` thì coi như xong, khác thì là xung đột. */
  private async afterRace(oid: string): Promise<Outcome> {
    return (await this.deps.admins.findByMicrosoftOid(oid)) !== null ? 'unchanged' : 'conflicts';
  }
}
