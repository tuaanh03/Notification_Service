import type { AppId, TemplateId, TemplateVersionId } from '../../../../shared/kernel/index.ts';

/** -> apps: template chỉ tạo được cho app có thật. Adapter gọi query công khai của apps. */
export interface AppLookup {
  exists(appId: AppId): Promise<boolean>;
}

/** Template còn được dùng ở đâu — mọi app, mọi trạng thái. Lệnh dọn của admin-cli đọc (ADR-0037). */
export interface TemplateReferences {
  notifications: number;
  publications: number;
  incomingHooks: number;
}

/** -> notifications (thư / lần phát gửi bằng version) + incoming (hook trỏ tới template). Adapter gọi query công khai của hai module. */
export interface TemplateUsageLookup {
  referencesOf(templateId: TemplateId, versionIds: readonly TemplateVersionId[]): Promise<TemplateReferences>;
}
