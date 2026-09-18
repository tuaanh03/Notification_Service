import type { AppId, UserId } from '../../../../shared/kernel/index.ts';
import type { User } from '../../domain/entities/user.ts';

export interface UserRepository {
  findByExternalId(appId: AppId, externalId: string): Promise<User | null>;
  /** Đã có user cùng `(app_id, external_id)` -> `UserAlreadyExistsError` (caller thử lại). */
  insert(user: User): Promise<void>;
  /** `SELECT ... FOR UPDATE` trên dòng user — tuần tự hoá mọi thay đổi email của một user. */
  lockForUpdate(id: UserId): Promise<boolean>;
}
