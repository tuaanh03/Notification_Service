import type { AppId, IncomingHookId } from '../../../../shared/kernel/index.ts';
import type { IncomingCall } from '../../domain/entities/incoming-call.ts';
import type { IncomingHook } from '../../domain/entities/incoming-hook.ts';

export interface IncomingHookRepository {
  /** Chỗ `(app_id, slot)` đã có người giữ -> `IncomingSlotTakenError` (caller đọc lại rồi thử chỗ khác). */
  insert(hook: IncomingHook): Promise<void>;
  findById(id: IncomingHookId): Promise<IncomingHook | null>;
  findByTokenHash(hash: string): Promise<IncomingHook | null>;
  listByApp(appId: AppId): Promise<IncomingHook[]>;
  update(hook: IncomingHook): Promise<void>;
  delete(id: IncomingHookId): Promise<void>;
}

export interface IncomingCallRepository {
  insert(call: IncomingCall): Promise<void>;
  /** Mới nhất trước. */
  listRecent(hookId: IncomingHookId, limit: number): Promise<IncomingCall[]>;
  deleteByHook(hookId: IncomingHookId): Promise<void>;
  /** Xoá tối đa `limit` dòng cũ hơn `before`; trả số dòng đã xoá. */
  purgeOlderThan(before: Date, limit: number): Promise<number>;
}
