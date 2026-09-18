/**
 * Chạy `n` lệnh THẬT SỰ song song để chứng minh một ràng buộc chịu được race (ADR-0009:
 * ràng buộc không ép được ở DB phải có test chạy song song, không dựa vào kỷ luật người viết).
 *
 * Mọi lệnh chờ ở cùng một barrier rồi mới khởi động, để không lệnh nào kịp commit trước khi
 * lệnh khác bắt đầu. Pool phải có ít nhất `n` connection, nếu không các lệnh sẽ xếp hàng
 * chờ connection và race không còn là race.
 */
export async function race<T>(
  n: number,
  fn: (index: number) => Promise<T>,
): Promise<PromiseSettledResult<T>[]> {
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  const runs = Array.from({ length: n }, async (_, index) => {
    await barrier;
    return fn(index);
  });
  release();
  return Promise.allSettled(runs);
}

export function fulfilled<T>(results: PromiseSettledResult<T>[]): T[] {
  return results.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
}

export function rejected<T>(results: PromiseSettledResult<T>[]): unknown[] {
  return results.flatMap((r) => (r.status === 'rejected' ? [r.reason as unknown] : []));
}
