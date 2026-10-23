import type { SystemSettingsQueries } from '../../../settings/application/index.ts';
import type { AppLimits } from '../../application/ports/index.ts';

/** apps -> settings. */
export class SettingsAppLimits implements AppLimits {
  private readonly queries: SystemSettingsQueries;

  constructor(deps: { systemSettings: SystemSettingsQueries }) {
    this.queries = deps.systemSettings;
  }

  async maxActiveApiKeys(): Promise<number> {
    return (await this.queries.current())['apps.max_active_api_keys'];
  }

  async defaultMaxSendPerHour(): Promise<number | null> {
    const value = (await this.queries.current())['apps.default_max_send_per_hour'];
    return value === 0 ? null : value;
  }
}
