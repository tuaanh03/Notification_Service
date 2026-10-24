import type { SystemSettingsQueries } from '../../../settings/application/index.ts';
import type { PersonalAccessTokenPolicySource } from '../../application/ports/index.ts';

/** tenancy -> settings (query công khai, đệm 30 giây): giới hạn PAT do Super Admin chỉnh (ADR-0044). */
export class SettingsPatPolicy implements PersonalAccessTokenPolicySource {
  private readonly queries: SystemSettingsQueries;

  constructor(deps: { systemSettings: SystemSettingsQueries }) {
    this.queries = deps.systemSettings;
  }

  async current(): Promise<{ maxPerAdmin: number; maxLifetimeDays: number }> {
    const s = await this.queries.current();
    return { maxPerAdmin: s['pat.max_per_admin'], maxLifetimeDays: s['pat.max_lifetime_days'] };
  }
}
