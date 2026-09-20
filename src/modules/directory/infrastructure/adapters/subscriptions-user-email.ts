import type { CommandContext } from '../../../../shared/application/index.ts';
import type { AppId, UserId } from '../../../../shared/kernel/index.ts';
import type {
  EmailSubscriptionDto,
  FindUserEmail,
  SetUserEmail,
  UnsubscribeEmail,
} from '../../../subscriptions/application/index.ts';
import type { UserEmailPort, UserEmailView } from '../../application/ports/index.ts';

/**
 * Adapter xuyên module: directory -> use case công khai của subscriptions. Chạy trong transaction của
 * directory (uow.run lồng nhau nhập vào transaction ngoài), nên user + email cùng commit hoặc cùng rollback.
 */
export class SubscriptionsUserEmail implements UserEmailPort {
  private readonly deps: { setUserEmail: SetUserEmail; findUserEmail: FindUserEmail; unsubscribeEmail: UnsubscribeEmail };

  constructor(deps: SubscriptionsUserEmail['deps']) {
    this.deps = deps;
  }

  async set(input: { appId: AppId; userId: UserId; email: string }, ctx: CommandContext): Promise<UserEmailView> {
    return view(await this.deps.setUserEmail.execute(input, ctx));
  }

  async find(input: { appId: AppId; userId: UserId }): Promise<UserEmailView | null> {
    const found = await this.deps.findUserEmail.execute(input);
    return found ? view(found) : null;
  }

  async findMany(input: { appId: AppId; userIds: readonly UserId[] }): Promise<Map<UserId, UserEmailView>> {
    const found = await this.deps.findUserEmail.executeMany(input);
    return new Map([...found].map(([userId, dto]) => [userId, view(dto)]));
  }

  async unsubscribe(input: { appId: AppId; userId: UserId }, ctx: CommandContext): Promise<UserEmailView> {
    return view(await this.deps.unsubscribeEmail.execute(input, ctx));
  }
}

/** Chỉ lấy đúng những gì directory cần — `subscriptionId` là chi tiết nội bộ của subscriptions. */
const view = (dto: EmailSubscriptionDto): UserEmailView => ({
  address: dto.address,
  status: dto.status,
  suppressedReason: dto.suppressedReason,
  optedOutOptional: dto.optedOutOptional,
});
