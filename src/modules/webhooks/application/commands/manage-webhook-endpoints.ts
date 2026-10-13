import { audited, type CommandContext, type EventOutbox, type UnitOfWork } from '../../../../shared/application/index.ts';
import {
  WebhookEndpointId,
  type AppId,
  type Clock,
  type WebhookEndpointStatus,
  type WebhookEventType,
} from '../../../../shared/kernel/index.ts';
import { WebhookEndpoint } from '../../domain/entities/webhook-endpoint.ts';
import { toWebhookEndpointDto, type IssuedWebhookSecretDto, type WebhookEndpointDto } from '../dto.ts';
import { WebhookSlotTakenError } from '../errors.ts';
import { WEBHOOK_ENDPOINT_AGGREGATE, WEBHOOK_EVENTS } from '../events.ts';
import type { WebhookDeliveryRepository, WebhookEndpointRepository, WebhookLimits, WebhookSecrets } from '../ports/index.ts';
import { requireConfigured, requireEndpoint } from './shared.ts';

interface Deps {
  uow: UnitOfWork;
  outbox: EventOutbox;
  clock: Clock;
  endpoints: WebhookEndpointRepository;
  deliveries: WebhookDeliveryRepository;
  secrets: WebhookSecrets;
}

const auditEvent = (endpoint: WebhookEndpoint, eventType: string, ctx: CommandContext, after: Record<string, unknown>) => ({
  aggregateType: WEBHOOK_ENDPOINT_AGGREGATE,
  aggregateId: endpoint.id,
  eventType,
  payload: audited(ctx, { after: { appId: endpoint.appId, ...after } }),
});

/**
 * Thêm URL nhận webhook (ADR-0029). Tối đa N URL mỗi app (cài đặt hệ thống) — mỗi URL giữ một chỗ, unique `(app_id, slot)`
 * quyết khi hai lệnh chạy song song: bên thua đọc lại rồi thử chỗ còn lại; hết chỗ -> 422
 * WEBHOOK_LIMIT_REACHED. Secret chỉ nằm trong response này.
 */
export class CreateWebhookEndpoint {
  private readonly deps: Deps & { limits: WebhookLimits };

  constructor(deps: Deps & { limits: WebhookLimits }) {
    this.deps = deps;
  }

  async execute(
    input: { appId: AppId; url: string; events: readonly WebhookEventType[] },
    ctx: CommandContext,
  ): Promise<IssuedWebhookSecretDto> {
    const { uow, outbox, clock, endpoints, secrets, limits } = this.deps;
    requireConfigured(secrets);
    const max = await limits.maxEndpointsPerApp();
    // Mỗi lần thua cuộc đua là một chỗ vừa bị lấy — số lần thử đủ để thấy app đã đầy.
    for (let attempt = 0; ; attempt++) {
      try {
        const endpoint = await uow.run(async () => {
          const used = (await endpoints.listByApp(input.appId)).map((e) => e.slot);
          const slot = WebhookEndpoint.freeSlot(used, max);
          WebhookEndpoint.assertHasFreeSlot(slot, max);
          const created = new WebhookEndpoint({
            id: WebhookEndpointId.create(),
            appId: input.appId,
            slot,
            url: input.url,
            events: input.events,
            createdBy: ctx.actor.id,
            createdAt: clock.now(),
          });
          await endpoints.insert(created);
          await outbox.append([auditEvent(created, WEBHOOK_EVENTS.created, ctx, { url: created.url, events: created.events })]);
          return created;
        });
        return { endpoint: toWebhookEndpointDto(endpoint), secret: secrets.secretFor(endpoint.id, endpoint.secretVersion) };
      } catch (err) {
        if (!(err instanceof WebhookSlotTakenError) || attempt >= max) throw err;
      }
    }
  }
}

/** Đổi sự kiện / tắt / bật lại. Tắt -> mọi lượt còn chờ của URL thành `failed` (không dồn gọi khi bật lại). */
export class UpdateWebhookEndpoint {
  private readonly deps: Deps;

  constructor(deps: Deps) {
    this.deps = deps;
  }

  async execute(
    input: {
      appId: AppId;
      endpointId: WebhookEndpointId;
      events?: readonly WebhookEventType[] | undefined;
      status?: WebhookEndpointStatus | undefined;
    },
    ctx: CommandContext,
  ): Promise<WebhookEndpointDto> {
    const { uow, outbox, clock, endpoints, deliveries } = this.deps;
    return uow.run(async () => {
      const endpoint = await requireEndpoint(endpoints, input.appId, input.endpointId);
      const now = clock.now();
      if (input.events !== undefined) endpoint.changeEvents(input.events, now);
      const disabling = input.status === 'disabled' && endpoint.status !== 'disabled';
      if (input.status !== undefined) endpoint.setStatus(input.status, now);
      await endpoints.update(endpoint);
      if (disabling) await deliveries.abandonPending(endpoint.id, 'endpoint_disabled', now);
      await outbox.append([auditEvent(endpoint, WEBHOOK_EVENTS.updated, ctx, { events: endpoint.events, status: endpoint.status })]);
      return toWebhookEndpointDto(endpoint);
    });
  }
}

/** Đổi secret: phiên bản +1, secret cũ hết hiệu lực NGAY ở lượt gọi kế tiếp. Secret mới chỉ nằm trong response. */
export class RotateWebhookSecret {
  private readonly deps: Deps;

  constructor(deps: Deps) {
    this.deps = deps;
  }

  async execute(input: { appId: AppId; endpointId: WebhookEndpointId }, ctx: CommandContext): Promise<IssuedWebhookSecretDto> {
    const { uow, outbox, clock, endpoints, secrets } = this.deps;
    requireConfigured(secrets);
    const endpoint = await uow.run(async () => {
      const found = await requireEndpoint(endpoints, input.appId, input.endpointId);
      found.rotateSecret(clock.now());
      await endpoints.update(found);
      await outbox.append([auditEvent(found, WEBHOOK_EVENTS.secretRotated, ctx, { secretVersion: found.secretVersion })]);
      return found;
    });
    return { endpoint: toWebhookEndpointDto(endpoint), secret: secrets.secretFor(endpoint.id, endpoint.secretVersion) };
  }
}

/** Xoá URL cùng nhật ký gọi của nó (lượt đang chờ cũng mất — không gọi nữa). Chỗ được trả lại. */
export class DeleteWebhookEndpoint {
  private readonly deps: Deps;

  constructor(deps: Deps) {
    this.deps = deps;
  }

  async execute(input: { appId: AppId; endpointId: WebhookEndpointId }, ctx: CommandContext): Promise<void> {
    const { uow, outbox, endpoints, deliveries } = this.deps;
    await uow.run(async () => {
      const endpoint = await requireEndpoint(endpoints, input.appId, input.endpointId);
      await deliveries.deleteByEndpoint(endpoint.id);
      await endpoints.delete(endpoint.id);
      await outbox.append([auditEvent(endpoint, WEBHOOK_EVENTS.deleted, ctx, { url: endpoint.url })]);
    });
  }
}
