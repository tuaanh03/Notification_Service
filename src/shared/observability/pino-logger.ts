import { pino, type DestinationStream, type Logger as PinoLogger } from 'pino';
import type { Logger, LogLevel } from './logger.ts';

export interface PinoLoggerOptions {
  level?: LogLevel | undefined;
  context?: string | undefined;
  /** Mặc định stdout. Test truyền stream riêng để đọc lại dòng log. */
  destination?: DestinationStream | undefined;
}

/** Hiện thực `Logger` bằng pino: JSON-line `{ level, time, context, msg, ...meta }`, time ISO UTC. */
export function createPinoLogger(options: PinoLoggerOptions = {}): Logger {
  const root = pino(
    {
      level: options.level ?? 'info',
      base: null,
      timestamp: pino.stdTimeFunctions.isoTime,
      formatters: { level: (label) => ({ level: label }) },
    },
    options.destination,
  );
  return wrap(root, options.context ?? 'app');
}

// Child tạo từ ROOT với context đã ghép, không lồng child của child: pino không khử trùng
// binding, lồng nhau sẽ ra hai khoá `context` trong cùng một dòng JSON.
function wrap(root: PinoLogger, context: string): Logger {
  const log = root.child({ context });
  const at =
    (level: LogLevel) =>
    (msg: string, meta?: Record<string, unknown>): void => {
      if (meta) log[level](meta, msg);
      else log[level](msg);
    };
  return {
    trace: at('trace'),
    debug: at('debug'),
    info: at('info'),
    warn: at('warn'),
    error: at('error'),
    fatal: at('fatal'),
    child: (childContext) => wrap(root, `${context}:${childContext}`),
  };
}
