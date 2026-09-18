import { lt } from 'drizzle-orm';
import type { Executor } from './client.ts';
import { outbox, processedMessages } from './schema.ts';

/** Thời gian giữ lại (tài liệu kiến trúc §9: outbox 7 ngày sau publish, processed_messages 14 ngày). */
export const OUTBOX_RETENTION_DAYS = 7;
export const PROCESSED_MESSAGES_RETENTION_DAYS = 14;

/** Xoá theo lô nhỏ để mỗi câu DELETE giữ khoá ngắn — không chặn relay/consumer đang chạy. */
const PURGE_BATCH = 5_000;

type DeleteResult = [{ affectedRows: number }, unknown];

/**
 * Xoá dòng outbox đã publish trước `before`. Dòng CHƯA publish (published_at NULL) không bao giờ bị
 * xoá — `<` với NULL luôn sai. Trả tổng số dòng đã xoá.
 */
export async function purgePublishedOutbox(db: Executor, before: Date): Promise<number> {
  return purgeInBatches(async () => {
    const [result] = (await db.delete(outbox).where(lt(outbox.publishedAt, before)).limit(PURGE_BATCH)) as unknown as DeleteResult;
    return result.affectedRows;
  });
}

/**
 * Xoá dấu idempotency cũ. Sau 14 ngày message trùng không còn tới nữa (stream đã bị MAXLEN cắt,
 * PEL đã ACK hoặc vào DLQ) — giữ lâu hơn chỉ tốn chỗ.
 */
export async function purgeProcessedMessages(db: Executor, before: Date): Promise<number> {
  return purgeInBatches(async () => {
    const [result] = (await db
      .delete(processedMessages)
      .where(lt(processedMessages.at, before))
      .limit(PURGE_BATCH)) as unknown as DeleteResult;
    return result.affectedRows;
  });
}

async function purgeInBatches(deleteBatch: () => Promise<number>): Promise<number> {
  let total = 0;
  for (;;) {
    const deleted = await deleteBatch();
    total += deleted;
    if (deleted < PURGE_BATCH) return total;
  }
}

export function daysBefore(now: Date, days: number): Date {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}
