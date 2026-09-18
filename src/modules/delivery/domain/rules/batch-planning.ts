/** Chia lô 50–200 người. UNIQUE (notification_id, batch_no) -> consumer idempotent. */
export const MIN_BATCH_SIZE = 50;
export const MAX_BATCH_SIZE = 200;

/** Chia danh sách người nhận thành các lô có kích thước hợp lệ. */
export function planBatches(total: number, size = MAX_BATCH_SIZE): number {
  if (total <= 0) return 0;
  const bounded = Math.min(Math.max(size, MIN_BATCH_SIZE), MAX_BATCH_SIZE);
  return Math.ceil(total / bounded);
}
