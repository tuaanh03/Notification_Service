import type { EventOutbox, IntegrationEvent } from '../application/ports/event-outbox.ts';
import { outbox } from './schema.ts';
import type { TransactionContext } from './transaction-context.ts';

/** Quyết định stream nào nhận một event. Bảng định tuyến thật thuộc `shared/streams` (lượt 2). */
export type StreamRouter = (event: IntegrationEvent) => string;

/**
 * Hiện thực `EventOutbox`: INSERT vào bảng `outbox` trong transaction đang mở.
 * Relay (SELECT ... FOR UPDATE SKIP LOCKED -> XADD) thuộc `shared/streams`.
 */
export class DrizzleEventOutbox implements EventOutbox {
  private readonly transactions: TransactionContext;
  private readonly route: StreamRouter;

  constructor(deps: { transactions: TransactionContext; route: StreamRouter }) {
    this.transactions = deps.transactions;
    this.route = deps.route;
  }

  async append(events: readonly IntegrationEvent[]): Promise<void> {
    const tx = this.transactions.require('EventOutbox.append');
    if (events.length === 0) return;
    await tx.insert(outbox).values(
      events.map((event) => ({
        aggregateType: event.aggregateType,
        aggregateId: event.aggregateId,
        eventType: event.eventType,
        stream: this.route(event),
        payload: event.payload,
      })),
    );
  }
}
