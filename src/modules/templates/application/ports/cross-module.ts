import type { AppId } from '../../../../shared/kernel/index.ts';

/** -> apps: template chỉ tạo được cho app có thật. Adapter gọi query công khai của apps. */
export interface AppLookup {
  exists(appId: AppId): Promise<boolean>;
}

/** -> settings: công tắc của template (ADR-0038). Adapter đọc cài đặt hệ thống (đệm 30 giây). */
export interface TemplateFeatures {
  /** Bộ kiểm HTML an toàn chạy khi xuất bản kiểu `html` (`templates.html_check_enabled`, mặc định bật). */
  htmlCheckEnabled(): Promise<boolean>;
}
