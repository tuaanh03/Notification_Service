import type { SystemSettingsQueries } from '../../../settings/application/index.ts';
import type { WebhookLimits } from '../../application/ports/index.ts';

/** webhooks -> settings. */
export class SettingsWebhookLimits implements WebhookLimits {
  private readonly queries: SystemSettingsQueries;

  constructor(deps: { systemSettings: SystemSettingsQueries }) {
    this.queries = deps.systemSettings;
  }

  async maxEndpointsPerApp(): Promise<number> {
    return (await this.queries.current())['webhooks.max_endpoints_per_app'];
  }
}
