import type { AppId, AppSecretId } from '../../../../shared/kernel/index.ts';
import type { AppSecret } from '../../domain/entities/app-secret.ts';

export interface AppSecretRepository {
  findById(id: AppSecretId): Promise<AppSecret | null>;
  listByApp(appId: AppId): Promise<AppSecret[]>;
  countActive(appId: AppId): Promise<number>;
  insert(secret: AppSecret): Promise<void>;
  update(secret: AppSecret): Promise<void>;
  /** Ghi `last_used_at = at` chỉ khi lần ghi trước cũ hơn `staleBefore` (hoặc chưa có) — một UPDATE có điều kiện. */
  touchLastUsed(id: AppSecretId, at: Date, staleBefore: Date): Promise<void>;
}
