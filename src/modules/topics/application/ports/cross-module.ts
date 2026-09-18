import type { CommandContext } from '../../../../shared/application/index.ts';
import type { AppId, UserId } from '../../../../shared/kernel/index.ts';

/**
 * Ba cổng sang module khác — adapter gọi use case công khai của module đó, không đọc bảng của nó.
 * Chiều phụ thuộc một chiều: topics -> apps / directory / subscriptions (không module nào gọi ngược lại).
 */

/** -> apps: topic chỉ tạo được cho app có thật. */
export interface AppLookup {
  exists(appId: AppId): Promise<boolean>;
}

/** Trạng thái email của user, đủ để hiển thị trang preference. */
export interface UserEmailSummary {
  status: string;
  optedOutOptional: boolean;
}

/** -> directory: tra user theo external_id TRONG app đang gọi. */
export interface UserLookup {
  find(input: { appId: AppId; externalId: string }): Promise<{ userId: UserId; email: UserEmailSummary | null } | null>;
}

/** -> subscriptions: cờ L1 "tắt mọi email không bắt buộc" nằm trên subscription email. */
export interface OptionalEmailSetting {
  set(input: { appId: AppId; userId: UserId; optedOut: boolean }, ctx: CommandContext): Promise<void>;
}
