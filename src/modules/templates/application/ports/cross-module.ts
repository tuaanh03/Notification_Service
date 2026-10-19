import type { AppId } from '../../../../shared/kernel/index.ts';

/** -> apps: template chỉ tạo được cho app có thật. Adapter gọi query công khai của apps. */
export interface AppLookup {
  exists(appId: AppId): Promise<boolean>;
}

/** -> settings: cờ bật bộ soạn trực quan (ADR-0036). Adapter đọc cài đặt hệ thống (đệm 30 giây). */
export interface TemplateFeatures {
  visualEditorEnabled(): Promise<boolean>;
}
