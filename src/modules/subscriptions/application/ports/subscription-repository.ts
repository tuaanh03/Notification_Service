import type { AppId, Channel, SubscriptionStatus, UserId } from '../../../../shared/kernel/index.ts';
import type { Subscription } from '../../domain/entities/subscription.ts';

export interface SubscriptionRepository {
  /** Điểm nhận của user trên một kênh. MVP: mỗi user một email mỗi app (ADR-0016 D9). */
  findByUser(appId: AppId, userId: UserId, channel: Channel): Promise<Subscription | null>;
  /**
   * Như `findByUser` nhưng cho nhiều user một lần — dùng khi liệt kê người nhận, để màn danh sách
   * không bắn N+1 truy vấn. Danh sách rỗng -> trả mảng rỗng, không gọi DB.
   */
  findManyByUsers(appId: AppId, userIds: readonly UserId[], channel: Channel): Promise<Subscription[]>;
  /** Số điểm nhận của MỘT app theo trạng thái (index `idx_subscriptions_app_status`). Trạng thái không có dòng nào -> 0. */
  countByStatus(appId: AppId, channel: Channel): Promise<Record<SubscriptionStatus, number>>;
  /** Ai đang giữ địa chỉ này trong app (`uq_subscriptions_app_channel_value`). */
  findByValue(appId: AppId, channel: Channel, value: string): Promise<Subscription | null>;
  /** Địa chỉ đã thuộc user khác -> ConflictError `EMAIL_TAKEN`. */
  insert(subscription: Subscription): Promise<void>;
  /** Như insert khi đổi sang địa chỉ đã có người giữ. */
  update(subscription: Subscription): Promise<void>;
}
