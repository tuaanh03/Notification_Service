import type { EventOutbox, IntegrationEvent } from '../application/ports/event-outbox.ts';
import { outbox } from './schema.ts';
import type { TransactionContext } from './transaction-context.ts';

/**
 * Quyết định những stream nào nhận một event (bảng thật: `shared/streams/names.ts`, tiêm qua
 * composition root). Mỗi stream đích -> một dòng outbox, để relay chỉ việc XADD từng dòng.
 */
export type StreamRouter = (event: IntegrationEvent) => readonly string[];

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
    const rows = events.flatMap((event) =>
      this.route(event).map((stream) => ({
        aggregateType: event.aggregateType,
        aggregateId: event.aggregateId,
        eventType: event.eventType,
        stream,
        payload: event.payload,
      })),
    );
    if (rows.length === 0) return;
    await tx.insert(outbox).values(rows);
  }
}
