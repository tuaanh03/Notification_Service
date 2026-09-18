/**
 * PORT của logging — thuần interface, không biết pino tồn tại.
 * Mọi tầng (application, adapter, consumer) phụ thuộc vào file này; chỉ composition root
 * import `pino-logger.ts` để dựng bản hiện thực.
 */

/** Nguồn duy nhất cho danh sách level — `shared/config` validate LOG_LEVEL theo mảng này. */
export const LOG_LEVELS = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

/**
 * `meta` được trộn thẳng vào dòng log (không lồng), để `notification_id` nằm ở top-level
 * và truy vết được xuyên api -> worker.
 */
export interface Logger {
  trace(msg: string, meta?: Record<string, unknown>): void;
  debug(msg: string, meta?: Record<string, unknown>): void;
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
  fatal(msg: string, meta?: Record<string, unknown>): void;
  child(context: string): Logger;
}
