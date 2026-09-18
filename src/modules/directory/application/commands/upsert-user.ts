import { audited, type CommandContext, type EventOutbox, type UnitOfWork } from '../../../../shared/application/index.ts';
import { UserId, type AppId, type Clock, type OrgId } from '../../../../shared/kernel/index.ts';
import { User } from '../../domain/entities/user.ts';
import { toUserDto, type UserDto } from '../dto.ts';
import { UserAlreadyExistsError } from '../errors.ts';
import { USER_AGGREGATE, USER_EVENTS } from '../events.ts';
import type { UserEmailPort, UserRepository } from '../ports/index.ts';

export interface UpsertUserInput {
  appId: AppId;
  orgId: OrgId;
  externalId: string;
  /** Không truyền = giữ email hiện có. */
  email?: string | undefined;
}

/**
 * Đồng bộ một user từ app service theo `(app, external_id)`, kèm email — trong MỘT transaction:
 * user mới + email hỏng thì không có user nào được tạo.
 *
 * Không resolve danh tính (`person_id` để NULL — MVP ngoài phạm vi, ADR-0016).
 *
 * Hai request tạo cùng một user song song: bên thua đụng `uq_users_app_external`, được thử lại MỘT
 * lần — lần thử lại chạy trong transaction mới nên thấy user bên kia vừa tạo.
 */
export class UpsertUser {
  private readonly deps: {
    uow: UnitOfWork;
    outbox: EventOutbox;
    clock: Clock;
    users: UserRepository;
    emails: UserEmailPort;
  };

  constructor(deps: UpsertUser['deps']) {
    this.deps = deps;
  }

  async execute(input: UpsertUserInput, ctx: CommandContext): Promise<UserDto & { created: boolean }> {
    try {
      return await this.attempt(input, ctx);
    } catch (err) {
      if (err instanceof UserAlreadyExistsError) return this.attempt(input, ctx);
      throw err;
    }
  }

  private attempt(input: UpsertUserInput, ctx: CommandContext): Promise<UserDto & { created: boolean }> {
    const { uow, outbox, clock, users, emails } = this.deps;
    return uow.run(async () => {
      let user = await users.findByExternalId(input.appId, input.externalId);
      const created = user === null;
      if (!user) {
        user = new User({
          id: UserId.create(),
          appId: input.appId,
          orgId: input.orgId,
          externalId: input.externalId,
          source: 'api',
          createdAt: clock.now(),
        });
        await users.insert(user);
        await outbox.append([
          {
            aggregateType: USER_AGGREGATE,
            aggregateId: user.id,
            eventType: USER_EVENTS.created,
            payload: audited(ctx, { after: { externalId: input.externalId } }),
          },
        ]);
      }

      // Khoá dòng user: hai request đặt email song song cho cùng user phải xếp hàng (ADR-0009).
      await users.lockForUpdate(user.id);
      const email =
        input.email === undefined
          ? await emails.find({ appId: input.appId, userId: user.id })
          : await emails.set({ appId: input.appId, userId: user.id, email: input.email }, ctx);

      return { ...toUserDto(user, email), created };
    });
  }
}
