import type { AppId, Channel, UserId } from '../../../../shared/kernel/index.ts';
import type { Subscription } from '../../domain/entities/subscription.ts';

export interface SubscriptionRepository {
  /** Điểm nhận của user trên một kênh. MVP: mỗi user một email mỗi app (ADR-0016 D9). */
  findByUser(appId: AppId, userId: UserId, channel: Channel): Promise<Subscription | null>;
  /** Ai đang giữ địa chỉ này trong app (`uq_subscriptions_app_channel_value`). */
  findByValue(appId: AppId, channel: Channel, value: string): Promise<Subscription | null>;
  /** Địa chỉ đã thuộc user khác -> ConflictError `EMAIL_TAKEN`. */
  insert(subscription: Subscription): Promise<void>;
  /** Như insert khi đổi sang địa chỉ đã có người giữ. */
  update(subscription: Subscription): Promise<void>;
}
