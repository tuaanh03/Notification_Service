import { describe, expect, it } from 'vitest';
import { buildAiComposeMessages, parseAiComposeOutput } from '../../src/modules/templates/domain/rules/ai-compose-prompt.ts';
import { OpenAiCompatibleTemplateWriter } from '../../src/modules/templates/infrastructure/adapters/openai-compatible-template-writer.ts';
import { ConfigError, loadEnv } from '../../src/shared/config/index.ts';
import { toProblem } from '../../src/shared/http/problem.ts';
import { RateLimitedError, UpstreamError } from '../../src/shared/kernel/index.ts';

const BASE_ENV = { DATABASE_URL: 'mysql://u:p@localhost:3306/db', REDIS_URL: 'redis://localhost:6379' };

describe('câu lệnh gửi AI — chỉ gửi thứ cần gửi', () => {
  const variables = [
    { name: 'payload.vm_name', required: true, description: 'Tên máy ảo' },
    { name: 'payload.owner', required: false },
  ];

  it('liệt kê ĐÚNG các biến đã khai, kèm bắt buộc / mô tả; luật cú pháp nằm ở system', () => {
    const [system, user] = buildAiComposeMessages({ instruction: 'Cảnh báo VM', mode: 'new', variables });
    expect(system?.content).toContain('{{ payload.<name> }}');
    expect(system?.content).toContain('Never invent new variables');
    expect(user?.content).toContain('- {{ payload.vm_name }} (required): Tên máy ảo');
    expect(user?.content).toContain('- {{ payload.owner }} (optional)');
    expect(user?.content).toContain('Write a new template.');
  });

  it('không có biến -> bảo AI viết nội dung tĩnh', () => {
    const [, user] = buildAiComposeMessages({ instruction: 'x', mode: 'new', variables: [] });
    expect(user?.content).toContain('(none — do not use placeholders)');
  });

  it('revise -> gửi kèm nội dung đang soạn; new -> không', () => {
    const current = { subject: 'Tiêu đề cũ', html: '<p>cũ</p>', text: 'cũ' };
    expect(buildAiComposeMessages({ instruction: 'rút gọn', mode: 'revise', variables, current })[1]?.content).toContain('<p>cũ</p>');
    expect(buildAiComposeMessages({ instruction: 'x', mode: 'new', variables, current })[1]?.content).not.toContain('<p>cũ</p>');
  });
});

describe('đọc câu trả lời của AI', () => {
  it('JSON trần, JSON trong khung ```json, JSON lẫn chữ thừa', () => {
    const json = '{"subject":"S","html":"<p>H</p>","text":"T"}';
    for (const raw of [json, '```json\n' + json + '\n```', 'Đây là template:\n' + json + '\nChúc vui']) {
      expect(parseAiComposeOutput(raw)).toEqual({ subject: 'S', html: '<p>H</p>', text: 'T' });
    }
  });

  it('thiếu text -> chuỗi rỗng; tiêu đề nhiều dòng -> gộp một dòng', () => {
    expect(parseAiComposeOutput('{"subject":"Dòng 1\\n  dòng 2","html":"<p>x</p>"}')).toEqual({
      subject: 'Dòng 1 dòng 2',
      html: '<p>x</p>',
      text: '',
    });
  });

  it.each(['không có JSON', '{"subject":"S"}', '{"subject":1,"html":"x"}', '{hỏng'])('%s -> null', (raw) => {
    expect(parseAiComposeOutput(raw)).toBeNull();
  });
});

describe('OpenAiCompatibleTemplateWriter', () => {
  const config = { url: 'http://localhost/v1/chat/completions', apiKey: 'test-key', model: 'm-1', timeoutMs: 50 };
  const writer = (fetchImpl: typeof fetch) => new OpenAiCompatibleTemplateWriter({ config, fetch: fetchImpl });
  const messages = [{ role: 'user' as const, content: 'x' }];

  it('gửi đúng model + messages + Bearer; đọc content, model, token', async () => {
    let sent: { url: string; init: RequestInit } | null = null;
    const result = await writer((async (url: string, init: RequestInit) => {
      sent = { url, init };
      return Response.json({ model: 'm-1-2026', choices: [{ message: { content: '{"a":1}' } }], usage: { prompt_tokens: 10, completion_tokens: 20 } });
    }) as unknown as typeof fetch).complete(messages);
    expect(result).toEqual({ content: '{"a":1}', model: 'm-1-2026', promptTokens: 10, completionTokens: 20 });
    expect(sent!.url).toBe(config.url);
    expect((sent!.init.headers as Record<string, string>)['authorization']).toBe('Bearer test-key');
    expect(JSON.parse(sent!.init.body as string)).toMatchObject({ model: 'm-1', messages });
  });

  it('nhà cung cấp trả 401 -> AI_PROVIDER_ERROR 502, message có mã HTTP, KHÔNG có khoá', async () => {
    const err = await writer((async () => new Response('{"error":"invalid key"}', { status: 401 })) as unknown as typeof fetch)
      .complete(messages)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UpstreamError);
    expect(err).toMatchObject({ code: 'AI_PROVIDER_ERROR', status: 502 });
    expect((err as Error).message).toContain('401');
    expect((err as Error).message).not.toContain('test-key');
  });

  it('quá giờ -> AI_PROVIDER_ERROR nói rõ đã chờ bao lâu', async () => {
    const hang = ((_: string, init: RequestInit) =>
      new Promise((_resolve, reject) => init.signal?.addEventListener('abort', () => reject(init.signal?.reason)))) as unknown as typeof fetch;
    await expect(writer(hang).complete(messages)).rejects.toMatchObject({ code: 'AI_PROVIDER_ERROR', message: expect.stringContaining('50 ms') });
  });

  it('không có content -> AI_PROVIDER_ERROR', async () => {
    await expect(writer((async () => Response.json({ choices: [] })) as unknown as typeof fetch).complete(messages)).rejects.toMatchObject({
      code: 'AI_PROVIDER_ERROR',
    });
  });
});

describe('lỗi mới -> HTTP', () => {
  it('UpstreamError mang status của nó; RateLimitedError -> 429', () => {
    expect(toProblem(new UpstreamError('AI_NOT_CONFIGURED', 'x', 503))).toMatchObject({ status: 503, code: 'AI_NOT_CONFIGURED' });
    expect(toProblem(new UpstreamError('AI_PROVIDER_ERROR', 'x'))).toMatchObject({ status: 502, code: 'AI_PROVIDER_ERROR' });
    expect(toProblem(new RateLimitedError('AI_RATE_LIMITED', 'x'))).toMatchObject({ status: 429, code: 'AI_RATE_LIMITED' });
  });
});

describe('env AI_*', () => {
  it('không khai gì -> AI tắt, khởi động bình thường', () => {
    expect(loadEnv(BASE_ENV).AI_API_KEY).toBeUndefined();
  });

  it('có khoá mà thiếu URL / model -> dừng khởi động, nêu tên biến', () => {
    const err = (() => {
      try {
        loadEnv({ ...BASE_ENV, AI_API_KEY: 'k' });
      } catch (e) {
        return e;
      }
      return null;
    })();
    expect(err).toBeInstanceOf(ConfigError);
    expect((err as ConfigError).issues.join('\n')).toMatch(/AI_API_URL[\s\S]*AI_MODEL/);
  });
});
