import { and, asc, desc, eq, inArray, lte } from 'drizzle-orm';
import { duplicateKeyName, type TransactionContext } from '../../../../shared/db/index.ts';
import {
  AppId,
  WEBHOOK_EVENT_TYPES,
  WebhookDeliveryId,
  WebhookEndpointId,
  type AppId as AppIdType,
  type WebhookEndpointId as WebhookEndpointIdType,
  type WebhookEventType,
} from '../../../../shared/kernel/index.ts';
import { WebhookSlotTakenError } from '../../application/errors.ts';
import type { WebhookDeliveryRepository, WebhookEndpointRepository } from '../../application/ports/index.ts';
import { WebhookDelivery } from '../../domain/entities/webhook-delivery.ts';
import { WEBHOOK_SLOTS, WebhookEndpoint, type WebhookSlot } from '../../domain/entities/webhook-endpoint.ts';
import { webhookDeliveries, webhookEndpoints } from '../db/schema.ts';

type EndpointRow = typeof webhookEndpoints.$inferSelect;
type DeliveryRow = typeof webhookDeliveries.$inferSelect;
type WriteResult = [{ affectedRows: number }, unknown];

export class DrizzleWebhookEndpointRepository implements WebhookEndpointRepository {
  private readonly transactions: TransactionContext;

  constructor(deps: { transactions: TransactionContext }) {
    this.transactions = deps.transactions;
  }

  async insert(e: WebhookEndpoint): Promise<void> {
    try {
      await this.transactions.executor().insert(webhookEndpoints).values({
        endpointId: e.id,
        appId: e.appId,
        slot: e.slot,
        url: e.url,
        events: [...e.events],
        secretVersion: e.secretVersion,
        status: e.status,
        createdBy: e.createdBy,
        createdAt: e.createdAt,
        updatedAt: e.updatedAt,
      });
    } catch (err) {
      if (duplicateKeyName(err) === 'uq_webhook_endpoints_app_slot') throw new WebhookSlotTakenError();
      throw err;
    }
  }

  async findById(id: WebhookEndpointIdType): Promise<WebhookEndpoint | null> {
    const [row] = await this.transactions.executor().select().from(webhookEndpoints).where(eq(webhookEndpoints.endpointId, id));
    return row ? toEndpoint(row) : null;
  }

  async listByApp(appId: AppIdType): Promise<WebhookEndpoint[]> {
    const rows = await this.transactions
      .executor()
      .select()
      .from(webhookEndpoints)
      .where(eq(webhookEndpoints.appId, appId))
      .orderBy(asc(webhookEndpoints.slot));
    return rows.map(toEndpoint);
  }

  async update(e: WebhookEndpoint): Promise<void> {
    await this.transactions
      .executor()
      .update(webhookEndpoints)
      .set({ events: [...e.events], secretVersion: e.secretVersion, status: e.status, updatedAt: e.updatedAt })
      .where(eq(webhookEndpoints.endpointId, e.id));
  }

  async delete(id: WebhookEndpointIdType): Promise<void> {
    await this.transactions.executor().delete(webhookEndpoints).where(eq(webhookEndpoints.endpointId, id));
  }
}

export class DrizzleWebhookDeliveryRepository implements WebhookDeliveryRepository {
  private readonly transactions: TransactionContext;

  constructor(deps: { transactions: TransactionContext }) {
    this.transactions = deps.transactions;
  }

  async insertIfAbsent(d: WebhookDelivery): Promise<void> {
    try {
      await this.transactions.executor().insert(webhookDeliveries).values({
        deliveryId: d.id,
        endpointId: d.endpointId,
        appId: d.appId,
        eventId: d.eventId,
        eventType: d.eventType,
        body: d.body,
        status: d.status,
        attempts: d.attempts,
        nextAttemptAt: d.nextAttemptAt,
        lastStatusCode: d.lastStatusCode,
        lastError: d.lastError,
        createdAt: d.createdAt,
        updatedAt: d.updatedAt,
        deliveredAt: d.deliveredAt,
      });
    } catch (err) {
      if (duplicateKeyName(err) === 'uq_webhook_deliveries_endpoint_event') return;
      throw err;
    }
  }

  async claimDue(now: Date, leaseUntil: Date, limit: number): Promise<WebhookDelivery[]> {
    const tx = this.transactions.require('WebhookDeliveryRepository.claimDue');
    const rows = await tx
      .select()
      .from(webhookDeliveries)
      .where(and(eq(webhookDeliveries.status, 'pending'), lte(webhookDeliveries.nextAttemptAt, now)))
      .orderBy(asc(webhookDeliveries.nextAttemptAt))
      .limit(limit)
      .for('update', { skipLocked: true });
    if (rows.length === 0) return [];
    await tx
      .update(webhookDeliveries)
      .set({ nextAttemptAt: leaseUntil })
      .where(inArray(webhookDeliveries.deliveryId, rows.map((r) => r.deliveryId)));
    return rows.map((row) => toDelivery({ ...row, nextAttemptAt: leaseUntil }));
  }

  async saveResult(d: WebhookDelivery, expectedAttempts: number): Promise<boolean> {
    const [result] = (await this.transactions
      .executor()
      .update(webhookDeliveries)
      .set({
        status: d.status,
        attempts: d.attempts,
        nextAttemptAt: d.nextAttemptAt,
        lastStatusCode: d.lastStatusCode,
        lastError: d.lastError,
        updatedAt: d.updatedAt,
        deliveredAt: d.deliveredAt,
      })
      .where(
        and(
          eq(webhookDeliveries.deliveryId, d.id),
          eq(webhookDeliveries.status, 'pending'),
          eq(webhookDeliveries.attempts, expectedAttempts),
        ),
      )) as unknown as WriteResult;
    return result.affectedRows > 0;
  }

  async abandonPending(endpointId: WebhookEndpointIdType, reason: string, at: Date): Promise<void> {
    await this.transactions
      .executor()
      .update(webhookDeliveries)
      .set({ status: 'failed', lastError: reason, nextAttemptAt: null, updatedAt: at })
      .where(and(eq(webhookDeliveries.endpointId, endpointId), eq(webhookDeliveries.status, 'pending')));
  }

  async deleteByEndpoint(endpointId: WebhookEndpointIdType): Promise<void> {
    await this.transactions.executor().delete(webhookDeliveries).where(eq(webhookDeliveries.endpointId, endpointId));
  }

  async listRecent(endpointId: WebhookEndpointIdType, limit: number): Promise<WebhookDelivery[]> {
    const rows = await this.transactions
      .executor()
      .select()
      .from(webhookDeliveries)
      .where(eq(webhookDeliveries.endpointId, endpointId))
      .orderBy(desc(webhookDeliveries.createdAt), desc(webhookDeliveries.deliveryId))
      .limit(limit);
    return rows.map(toDelivery);
  }
}

function toEndpoint(row: EndpointRow): WebhookEndpoint {
  const slot = WEBHOOK_SLOTS.find((s) => s === row.slot);
  if (slot === undefined) throw new Error(`unexpected webhook slot: ${row.slot}`);
  return new WebhookEndpoint({
    id: WebhookEndpointId.parse(row.endpointId),
    appId: AppId.parse(row.appId),
    slot: slot satisfies WebhookSlot,
    url: row.url,
    // Sự kiện đã bỏ khỏi danh mục thì lặng lẽ bỏ — đừng để một URL cũ làm hỏng cả màn danh sách.
    events: row.events.filter((e): e is WebhookEventType => (WEBHOOK_EVENT_TYPES as readonly string[]).includes(e)),
    secretVersion: row.secretVersion,
    status: row.status,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

function toDelivery(row: DeliveryRow): WebhookDelivery {
  return new WebhookDelivery({
    id: WebhookDeliveryId.parse(row.deliveryId),
    endpointId: WebhookEndpointId.parse(row.endpointId),
    appId: AppId.parse(row.appId),
    eventId: row.eventId,
    eventType: row.eventType,
    body: row.body,
    status: row.status,
    attempts: row.attempts,
    nextAttemptAt: row.nextAttemptAt,
    lastStatusCode: row.lastStatusCode,
    lastError: row.lastError,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deliveredAt: row.deliveredAt,
  });
}
