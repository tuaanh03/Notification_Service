import { describe, expect, it } from 'vitest';
import { buildHttpServer, redactUrl, type HttpRoutes } from '../../src/shared/http/index.ts';
import { NotFoundError } from '../../src/shared/kernel/index.ts';
import type { Logger } from '../../src/shared/observability/logger.ts';

/**
 * URL của incoming webhook là chìa khoá (ADR-0030) — server không được tự ghi nó ra log hay trả lại
 * nguyên văn trong lỗi.
 */
const TOKEN = `ewshk_${'A'.repeat(20)}secretpart${'z'.repeat(9)}WXYZ`;

describe('redactUrl', () => {
  it('chỉ giữ đoạn gợi nhớ của segment sau /hooks/, giữ phần còn lại của URL', () => {
    expect(redactUrl(`/hooks/${TOKEN}`)).toBe('/hooks/ewshk_AAAA…WXYZ');
    expect(redactUrl(`/hooks/${TOKEN}?debug=1`)).toBe('/hooks/ewshk_AAAA…WXYZ?debug=1');
    expect(redactUrl('/hooks/short')).toBe('/hooks/…');
    expect(redactUrl('/v1/notifications?x=1')).toBe('/v1/notifications?x=1');
  });
});

describe('server không lộ token incoming', { timeout: 20_000 }, () => {
  it('log mỗi request và `instance` / `detail` của lỗi chỉ có đoạn gợi nhớ', async () => {
    const lines: unknown[] = [];
    const logger: Logger = {
      trace() {},
      debug() {},
      info: (_msg: string, fields?: unknown) => void lines.push(fields),
      warn() {},
      error: (_msg: string, fields?: unknown) => void lines.push(fields),
      fatal() {},
      child: () => logger,
    };
    const hooks: HttpRoutes = (app) => {
      app.post('/hooks/:token', async () => {
        throw new NotFoundError('incoming webhook', 'for this token');
      });
    };
    const { app } = await buildHttpServer({
      logger,
      readiness: [],
      authenticators: {
        apiKey: { authenticate: () => Promise.reject(new Error('unused')) },
        admin: { authenticate: () => Promise.reject(new Error('unused')) },
      },
      adminAuthorizer: { authorize: () => Promise.reject(new Error('unused')) },
      surfaces: { public: [hooks] },
    });
    try {
      const known = await app.inject({ method: 'POST', url: `/hooks/${TOKEN}`, payload: {} });
      const unknown = await app.inject({ method: 'GET', url: `/hooks/${TOKEN}` });
      expect(known.statusCode).toBe(404);
      expect(unknown.statusCode).toBe(404);
      for (const text of [known.body, unknown.body, JSON.stringify(lines)]) {
        expect(text).not.toContain('secretpart');
        expect(text).toContain('ewshk_AAAA…WXYZ');
      }
    } finally {
      await app.close();
    }
  });
});
