import { NotFoundError } from '../../../../shared/kernel/index.ts';
import { toDeadLetterDto, type DeadLetterDto, type QueuesDto } from '../dto.ts';
import type { QueueAdmin, QueueGroupDefinition } from '../ports/index.ts';

/** Số message DLQ tối đa một lần đọc. */
export const MAX_DEAD_LETTERS = 200;

/**
 * Đọc hàng đợi cho màn quản trị (ADR-0042) — chỉ những stream có consumer group đang khai trong code; stream khai tên mà
 * chưa ai xử lý không hiện (không có gì để vận hành).
 */
export class QueueQueries {
  private readonly deps: { admin: QueueAdmin; groups: readonly QueueGroupDefinition[] };

  constructor(deps: QueueQueries['deps']) {
    this.deps = deps;
  }

  async overview(): Promise<QueuesDto> {
    const { admin, groups } = this.deps;
    const [stats, usedMemoryBytes] = await Promise.all([
      Promise.all(groups.map((g) => admin.groupStats(g.stream, g.group))),
      admin.usedMemory(),
    ]);
    return {
      groups: groups.map((g, i) => ({ ...stats[i]!, pausable: g.pausable, options: g.options })),
      redis: { usedMemoryBytes },
    };
  }

  /** DLQ của một stream, hoặc của mọi stream (gộp, mới nhất trước) khi không chỉ định. */
  async deadLetters(input: { stream?: string | undefined; limit: number }): Promise<DeadLetterDto[]> {
    const streams = input.stream === undefined ? this.streams() : [this.requireStream(input.stream)];
    const lists = await Promise.all(streams.map((s) => this.deps.admin.deadLetters(s, input.limit)));
    return lists
      .flat()
      .sort((a, b) => b.deadLetteredAt.getTime() - a.deadLetteredAt.getTime() || b.id.localeCompare(a.id))
      .slice(0, input.limit)
      .map(toDeadLetterDto);
  }

  /** Stream có consumer group đang khai — thao tác trên stream khác là 404, không chạm Redis. */
  requireStream(stream: string): string {
    if (!this.streams().includes(stream)) throw new NotFoundError('stream', stream);
    return stream;
  }

  requireGroup(group: string): QueueGroupDefinition {
    const found = this.deps.groups.find((g) => g.group === group);
    if (!found) throw new NotFoundError('consumer group', group);
    return found;
  }

  private streams(): string[] {
    return [...new Set(this.deps.groups.map((g) => g.stream))];
  }
}
