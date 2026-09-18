import type { ApiKeyAuthenticator, AppCaller } from '../../../../shared/http/index.ts';
import type { AuthenticateApiKey } from '../../application/index.ts';

/**
 * Nối use case `AuthenticateApiKey` của apps vào hợp đồng xác thực `/v1` của shared/http. Nhờ lớp này,
 * route `/v1/*` của MỌI module được bảo vệ bằng API key mà không module nào phải import apps.
 */
export class AppsApiKeyAuthenticator implements ApiKeyAuthenticator {
  private readonly authenticateApiKey: AuthenticateApiKey;

  constructor(deps: { authenticateApiKey: AuthenticateApiKey }) {
    this.authenticateApiKey = deps.authenticateApiKey;
  }

  async authenticate(input: { apiKey: string | null; ip: string; origin: string | null }): Promise<AppCaller> {
    const app = await this.authenticateApiKey.execute(input);
    return { kind: 'app', ...app };
  }
}
