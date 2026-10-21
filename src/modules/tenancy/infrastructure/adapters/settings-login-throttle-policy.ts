import type { SystemSettingsQueries } from '../../../settings/application/index.ts';
import type { LoginThrottlePolicySource } from '../../application/ports/index.ts';
import { loginThrottlePolicy, type LoginThrottlePolicy } from '../../domain/rules/login-throttle.ts';

/** tenancy -> settings (query công khai, đệm 30 giây): con số chặn đăng nhập sai do Super Admin chỉnh (ADR-0039). */
export class SettingsLoginThrottlePolicy implements LoginThrottlePolicySource {
  private readonly queries: SystemSettingsQueries;

  constructor(deps: { systemSettings: SystemSettingsQueries }) {
    this.queries = deps.systemSettings;
  }

  async current(): Promise<LoginThrottlePolicy> {
    const s = await this.queries.current();
    return loginThrottlePolicy({
      enabled: s['auth.lockout_enabled'],
      maxFailures: s['auth.max_failed_attempts'],
      windowMinutes: s['auth.failure_window_minutes'],
      lockMinutes: s['auth.lockout_minutes'],
      ipMaxFailures: s['auth.ip_max_failed_attempts'],
      permanentAfter: s['auth.permanent_lock_after'],
    });
  }
}
