import type { AppId, WebhookEndpointId } from '../../../../shared/kernel/index.ts';
import { requireEndpoint } from '../commands/shared.ts';
import { toWebhookDeliveryDto, toWebhookEndpointDto, type WebhookDeliveryDto, type WebhookEndpointDto } from '../dto.ts';
import type { WebhookDeliveryRepository, WebhookEndpointRepository, WebhookSecrets } from '../ports/index.ts';

/** Số dòng nhật ký gọi trả về mỗi URL. */
export const RECENT_DELIVERIES_LIMIT = 50;

export class WebhookQueries {
  private readonly deps: { endpoints: WebhookEndpointRepository; deliveries: WebhookDeliveryRepository; secrets: WebhookSecrets };

  constructor(deps: WebhookQueries['deps']) {
    this.deps = deps;
  }

  /** `configured = false` -> console báo "chưa cấu hình" thay vì để người dùng bấm rồi mới lỗi. */
  async list(appId: AppId): Promise<{ configured: boolean; endpoints: WebhookEndpointDto[] }> {
    const endpoints = await this.deps.endpoints.listByApp(appId);
    return { configured: this.deps.secrets.configured, endpoints: endpoints.map(toWebhookEndpointDto) };
  }

  async deliveries(appId: AppId, endpointId: WebhookEndpointId): Promise<WebhookDeliveryDto[]> {
    const endpoint = await requireEndpoint(this.deps.endpoints, appId, endpointId);
    return (await this.deps.deliveries.listRecent(endpoint.id, RECENT_DELIVERIES_LIMIT)).map(toWebhookDeliveryDto);
  }
}
