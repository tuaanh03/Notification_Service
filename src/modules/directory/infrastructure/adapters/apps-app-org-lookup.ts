import type { AppQueries } from '../../../apps/application/index.ts';
import { OrgId, type AppId } from '../../../../shared/kernel/index.ts';
import type { AppOrgLookup } from '../../application/ports/index.ts';

/** directory -> apps: org của app, qua query công khai của apps (không đọc bảng `apps`). App không có -> 404. */
export class AppsAppOrgLookup implements AppOrgLookup {
  private readonly appQueries: AppQueries;

  constructor(deps: { appQueries: AppQueries }) {
    this.appQueries = deps.appQueries;
  }

  async orgOf(appId: AppId): Promise<OrgId> {
    return OrgId.parse((await this.appQueries.get(appId)).orgId);
  }
}
