const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 } as const;
export type LogLevel = keyof typeof LEVELS;

export interface Logger {
  debug(msg: string, meta?: Record<string, unknown>): void;
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
  child(context: string): Logger;
}

/** Logger JSON-line tối giản. Thay bằng pino ở phase 1, giữ nguyên interface. */
export function createLogger(options: { level?: LogLevel; context?: string } = {}): Logger {
  const level = options.level ?? ((process.env['LOG_LEVEL'] as LogLevel | undefined) ?? 'info');
  const context = options.context ?? 'app';
  const threshold = LEVELS[level] ?? LEVELS.info;

  const write = (lvl: LogLevel, msg: string, meta?: Record<string, unknown>): void => {
    if (LEVELS[lvl] < threshold) return;
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      level: lvl,
      context,
      msg,
      ...(meta ? { meta } : {}),
    });
    if (lvl === 'error' || lvl === 'warn') console.error(line);
    else console.log(line);
  };

  return {
    debug: (msg, meta) => write('debug', msg, meta),
    info: (msg, meta) => write('info', msg, meta),
    warn: (msg, meta) => write('warn', msg, meta),
    error: (msg, meta) => write('error', msg, meta),
    child: (childContext) => createLogger({ level, context: `${context}:${childContext}` }),
  };
}
