import type { AppId } from '../../../../shared/kernel/index.ts';

/** -> apps: template chỉ tạo được cho app có thật. Adapter gọi query công khai của apps. */
export interface AppLookup {
  exists(appId: AppId): Promise<boolean>;
}
