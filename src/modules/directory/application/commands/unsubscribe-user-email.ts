import type { CommandContext, UnitOfWork } from '../../../../shared/application/index.ts';
import { NotFoundError, type AppId } from '../../../../shared/kernel/index.ts';
import { toUserDto, type UserDto } from '../dto.ts';
import type { UserEmailPort, UserRepository } from '../ports/index.ts';

/** `DELETE /v1/users/:externalId/email` — user ngắt hẳn nhận email (L0). */
export class UnsubscribeUserEmail {
  private readonly deps: { uow: UnitOfWork; users: UserRepository; emails: UserEmailPort };

  constructor(deps: UnsubscribeUserEmail['deps']) {
    this.deps = deps;
  }

  async execute(input: { appId: AppId; externalId: string }, ctx: CommandContext): Promise<UserDto> {
    const { uow, users, emails } = this.deps;
    return uow.run(async () => {
      const user = await users.findByExternalId(input.appId, input.externalId);
      if (!user) throw new NotFoundError('user', input.externalId);
      await users.lockForUpdate(user.id);
      return toUserDto(user, await emails.unsubscribe({ appId: input.appId, userId: user.id }, ctx));
    });
  }
}
