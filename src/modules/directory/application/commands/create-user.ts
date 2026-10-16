import { audited, type CommandContext, type EventOutbox, type UnitOfWork } from '../../../../shared/application/index.ts';
import { UserId, type AppId, type Clock } from '../../../../shared/kernel/index.ts';
import { User } from '../../domain/entities/user.ts';
import { toUserDto, type UserDto } from '../dto.ts';
import { UserAlreadyExistsError } from '../errors.ts';
import { USER_AGGREGATE, USER_EVENTS } from '../events.ts';
import type { AppOrgLookup, UserEmailPort, UserRepository } from '../ports/index.ts';

/**
 * Người quản lý app thêm TAY một người nhận trên console (`POST /admin/apps/:appId/users`).
 *
 * Khác `UpsertUser` của `/v1` đúng một chỗ: mã đã có -> 409 `USER_ALREADY_EXISTS`, KHÔNG ghi đè —
 * thêm tay mà âm thầm đổi email của người đã có là nguy hiểm. Email đi qua cùng `emails.set` nên
 * cùng luật kiểm / chuẩn hoá; user + email trong MỘT transaction (email hỏng thì không có user nào).
 * `source = 'console'` để biết người này không do app đẩy vào.
 */
export class CreateUser {
  private readonly deps: {
    uow: UnitOfWork;
    outbox: EventOutbox;
    clock: Clock;
    users: UserRepository;
    emails: UserEmailPort;
    apps: AppOrgLookup;
  };

  constructor(deps: CreateUser['deps']) {
    this.deps = deps;
  }

  async execute(input: { appId: AppId; externalId: string; email?: string | undefined }, ctx: CommandContext): Promise<UserDto> {
    const { uow, outbox, clock, users, emails, apps } = this.deps;
    const orgId = await apps.orgOf(input.appId);
    return uow.run(async () => {
      if (await users.findByExternalId(input.appId, input.externalId)) throw new UserAlreadyExistsError(input.externalId);
      const user = new User({
        id: UserId.create(),
        appId: input.appId,
        orgId,
        externalId: input.externalId,
        source: 'console',
        createdAt: clock.now(),
      });
      // Hai người bấm cùng lúc: bên thua đụng unique `uq_users_app_external` -> cũng UserAlreadyExistsError.
      await users.insert(user);
      await outbox.append([
        {
          aggregateType: USER_AGGREGATE,
          aggregateId: user.id,
          eventType: USER_EVENTS.created,
          payload: audited(ctx, { after: { externalId: input.externalId, source: 'console' } }),
        },
      ]);
      const email = input.email === undefined ? null : await emails.set({ appId: input.appId, userId: user.id, email: input.email }, ctx);
      return toUserDto(user, email);
    });
  }
}
