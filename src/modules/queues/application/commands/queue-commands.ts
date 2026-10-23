import { audited, type CommandContext, type EventOutbox, type UnitOfWork } from '../../../../shared/application/index.ts';
import { NotFoundError, ValidationError } from '../../../../shared/kernel/index.ts';
import { QUEUE_AGGREGATE, QUEUE_EVENTS, QUEUE_ID } from '../events.ts';
import type { QueueAdmin } from '../ports/index.ts';
import type { QueueQueries } from '../queries/queue-queries.ts';

/** Lý do bỏ một message lỗi: bắt buộc, vào nhật ký hoạt động. */
export const MAX_DISCARD_REASON = 500;

type Deps = { uow: UnitOfWork; outbox: EventOutbox; admin: QueueAdmin; queries: QueueQueries };

/**
 * Thao tác của Super Admin trên hàng đợi (ADR-0042). Lệnh Redis chạy BÊN TRONG transaction ghi audit: Redis lỗi thì
 * không có dòng audit nào; chỉ còn khe "Redis xong, commit hỏng" (hiếm) là thao tác không có dấu vết.
 */
abstract class QueueCommand {
  protected readonly deps: Deps;

  constructor(deps: Deps) {
    this.deps = deps;
  }

  protected record(ctx: CommandContext, eventType: string, after: Record<string, unknown>): Promise<void> {
    return this.deps.outbox.append([{ aggregateType: QUEUE_AGGREGATE, aggregateId: QUEUE_ID, eventType, payload: audited(ctx, { after }) }]);
  }
}

/**
 * Đưa message trong DLQ về stream gốc để worker xử lý lại. An toàn khi lỗi đã được sửa (dữ liệu, cấu hình, dịch vụ
 * ngoài sống lại): khử trùng vẫn theo `outbox_id` / trạng thái trong DB nên message đã xong không chạy hai lần.
 */
export class RequeueDeadLetter extends QueueCommand {
  async execute(input: { stream: string; id: string }, ctx: CommandContext): Promise<{ id: string }> {
    const { uow, admin, queries } = this.deps;
    const stream = queries.requireStream(input.stream);
    return uow.run(async () => {
      const letter = await admin.deadLetter(stream, input.id);
      if (!letter) throw new NotFoundError('dead letter', input.id);
      const id = await admin.requeue(stream, input.id);
      if (id === null) throw new NotFoundError('dead letter', input.id);
      await this.record(ctx, QUEUE_EVENTS.deadLetterRequeued, {
        stream,
        deadLetterId: input.id,
        newId: id,
        eventType: letter.eventType,
        aggregateId: letter.aggregateId,
        reason: letter.reason,
      });
      return { id };
    });
  }
}

/** Xoá hẳn một message lỗi — không xử lý nữa. Bắt buộc ghi lý do. */
export class DiscardDeadLetter extends QueueCommand {
  async execute(input: { stream: string; id: string; reason: string }, ctx: CommandContext): Promise<void> {
    const { uow, admin, queries } = this.deps;
    const stream = queries.requireStream(input.stream);
    const reason = input.reason.trim();
    if (reason === '') throw ValidationError.of('DISCARD_REASON_REQUIRED', 'a reason is required to discard a message', 'reason');
    if (reason.length > MAX_DISCARD_REASON) {
      throw ValidationError.of('DISCARD_REASON_TOO_LONG', `reason must be at most ${MAX_DISCARD_REASON} characters`, 'reason');
    }
    await uow.run(async () => {
      const letter = await admin.deadLetter(stream, input.id);
      if (!letter || !(await admin.discard(stream, input.id))) throw new NotFoundError('dead letter', input.id);
      await this.record(ctx, QUEUE_EVENTS.deadLetterDiscarded, {
        stream,
        deadLetterId: input.id,
        eventType: letter.eventType,
        aggregateId: letter.aggregateId,
        reason: letter.reason,
        discardReason: reason,
      });
    });
  }
}

/**
 * Tạm dừng / chạy lại một consumer group — mọi bản worker ngừng lấy message (tối đa vài giây), message nằm yên trong
 * stream. Dùng khi dịch vụ ngoài hỏng (Graph, URL webhook của app) để không đốt hết số lần thử. Không đổi gì -> không ghi.
 */
export class SetGroupPaused extends QueueCommand {
  async execute(input: { group: string; paused: boolean }, ctx: CommandContext): Promise<{ paused: boolean }> {
    const { uow, admin, queries } = this.deps;
    const definition = queries.requireGroup(input.group);
    if (!definition.pausable) {
      throw ValidationError.of('CONSUMER_NOT_PAUSABLE', `consumer group ${input.group} cannot be paused`, 'group');
    }
    if ((await admin.isPaused(input.group)) === input.paused) return { paused: input.paused };
    await uow.run(async () => {
      await admin.setPaused(input.group, input.paused);
      await this.record(ctx, input.paused ? QUEUE_EVENTS.groupPaused : QUEUE_EVENTS.groupResumed, {
        group: input.group,
        stream: definition.stream,
      });
    });
    return { paused: input.paused };
  }
}
