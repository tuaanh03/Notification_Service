import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { createPinoLogger, type PinoLoggerOptions } from '../../src/shared/observability/pino-logger.ts';

function capture(options: Omit<PinoLoggerOptions, 'destination'> = {}) {
  const lines: string[] = [];
  const destination = new Writable({
    write(chunk, _enc, done) {
      lines.push(...String(chunk).trim().split('\n'));
      done();
    },
  });
  const logger = createPinoLogger({ ...options, destination });
  const records = () => lines.map((line) => JSON.parse(line) as Record<string, unknown>);
  return { logger, records };
}

describe('logger (pino)', () => {
  it('ghi JSON-line: level dạng chữ, time ISO UTC, context, msg, meta trộn top-level', () => {
    const { logger, records } = capture({ context: 'api' });
    logger.info('notification queued', { notification_id: 'n-1' });
    const [record] = records();
    expect(record).toMatchObject({
      level: 'info',
      context: 'api',
      msg: 'notification queued',
      notification_id: 'n-1',
    });
    expect(String(record!['time'])).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
  });

  it('child ghép context và chỉ có MỘT khoá context trong dòng log', () => {
    const { logger, records } = capture({ context: 'worker' });
    logger.child('resolver').child('batch').warn('slow');
    const [record] = records();
    expect(record!['context']).toBe('worker:resolver:batch');
    expect(JSON.stringify(record).match(/"context"/g)).toHaveLength(1);
  });

  it('lọc theo level', () => {
    const { logger, records } = capture({ level: 'warn' });
    logger.info('dropped');
    logger.error('kept');
    expect(records().map((r) => r['msg'])).toEqual(['kept']);
  });
});
