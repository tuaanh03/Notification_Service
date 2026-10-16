import type { AppId, OrgId } from '../../../../shared/kernel/index.ts';

/** -> apps: org của app — user lưu kèm `org_id` (composite FK chống rò rỉ chéo org). Route `/admin` chỉ có `appId`. */
export interface AppOrgLookup {
  orgOf(appId: AppId): Promise<OrgId>;
}
