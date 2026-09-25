import type { AppId, SubscriptionStatus, UserId } from '../../../../shared/kernel/index.ts';
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

  /**
   * Bản nhiều user cho màn danh sách người nhận — MỘT truy vấn thay vì N.
   * Trả map theo `userId`; user chưa có email thì không có khoá trong map.
   */
  async executeMany(input: { appId: AppId; userIds: readonly UserId[] }): Promise<Map<UserId, EmailSubscriptionDto>> {
    const found = await this.subscriptions.findManyByUsers(input.appId, input.userIds, 'email');
    return new Map(found.map((s) => [s.userId, toEmailSubscriptionDto(s)]));
  }

  /** Số email của app theo trạng thái — cho màn Tổng quan (bao nhiêu người còn nhận được thư). */
  countByStatus(input: { appId: AppId }): Promise<Record<SubscriptionStatus, number>> {
    return this.subscriptions.countByStatus(input.appId, 'email');
  }
}
