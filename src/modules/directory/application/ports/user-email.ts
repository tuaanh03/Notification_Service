import type { CommandContext } from '../../../../shared/application/index.ts';
import type { AppId, UserId } from '../../../../shared/kernel/index.ts';

/** Email của user nhìn từ directory — thuộc module subscriptions, directory chỉ hỏi qua port này. */
export interface UserEmailView {
  address: string;
  status: string;
  suppressedReason: string | null;
  optedOutOptional: boolean;
}

/**
 * Directory cần đặt / đọc / ngắt email của user, nhưng email (subscription) thuộc module subscriptions.
 * Adapter gọi use case của subscriptions — không query bảng `subscriptions`.
 */
export interface UserEmailPort {
  set(input: { appId: AppId; userId: UserId; email: string }, ctx: CommandContext): Promise<UserEmailView>;
  find(input: { appId: AppId; userId: UserId }): Promise<UserEmailView | null>;
  unsubscribe(input: { appId: AppId; userId: UserId }, ctx: CommandContext): Promise<UserEmailView>;
}
