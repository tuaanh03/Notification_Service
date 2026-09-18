import type { AppId, UserId } from '../../../../shared/kernel/index.ts';
import { toEmailSubscriptionDto, type EmailSubscriptionDto } from '../dto.ts';
import type { SubscriptionRepository } from '../ports/index.ts';

/**
 * Query công khai — cửa để module khác (directory hiển thị user, notifications kiểm gate) hỏi về email
 * của user. Không module nào đọc bảng `subscriptions` trực tiếp.
 */
export class FindUserEmail {
  private readonly subscriptions: SubscriptionRepository;

  constructor(deps: { subscriptions: SubscriptionRepository }) {
    this.subscriptions = deps.subscriptions;
  }

  async execute(input: { appId: AppId; userId: UserId }): Promise<EmailSubscriptionDto | null> {
    const found = await this.subscriptions.findByUser(input.appId, input.userId, 'email');
    return found ? toEmailSubscriptionDto(found) : null;
  }
}
