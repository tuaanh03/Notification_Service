const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

/**
 * Logger tối giản, thoả ILogger. Thay bằng pino/winston sau nếu cần.
 */
export function createLogger({ level = process.env.LOG_LEVEL ?? 'info', context = 'app' } = {}) {
  const threshold = LEVELS[level] ?? LEVELS.info;

  const write = (lvl, msg, meta) => {
    if (LEVELS[lvl] < threshold) return;
    const line = {
      ts: new Date().toISOString(),
      level: lvl,
      context,
      msg,
      ...(meta ? { meta } : {}),
    };
    const out = lvl === 'error' || lvl === 'warn' ? console.error : console.log;
    out(JSON.stringify(line));
  };

  return {
    debug: (msg, meta) => write('debug', msg, meta),
    info: (msg, meta) => write('info', msg, meta),
    warn: (msg, meta) => write('warn', msg, meta),
    error: (msg, meta) => write('error', msg, meta),
    child: (childContext) => createLogger({ level, context: `${context}:${childContext}` }),
  };
}
