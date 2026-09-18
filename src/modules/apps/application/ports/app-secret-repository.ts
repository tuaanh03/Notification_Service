import type { AppId, AppSecretId } from '../../../../shared/kernel/index.ts';
import type { AppSecret } from '../../domain/entities/app-secret.ts';

export interface AppSecretRepository {
  findById(id: AppSecretId): Promise<AppSecret | null>;
  listByApp(appId: AppId): Promise<AppSecret[]>;
  countActive(appId: AppId): Promise<number>;
  insert(secret: AppSecret): Promise<void>;
  update(secret: AppSecret): Promise<void>;
}
