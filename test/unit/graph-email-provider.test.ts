import { describe, expect, it } from 'vitest';
import type { OutgoingEmail } from '../../src/modules/delivery/application/index.ts';
import { GraphEmailProvider, sendMailBody } from '../../src/modules/delivery/infrastructure/adapters/index.ts';
import type { Clock } from '../../src/shared/kernel/index.ts';
import type { Logger } from '../../src/shared/observability/logger.ts';

const silent: Logger = {
  trace: () => undefined,
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  fatal: () => undefined,
  child: () => silent,
};

const EMAIL: OutgoingEmail = {
  to: 'user@example.com',
  subject: 'Hello',
  html: '<p>Hi</p>',
  text: null,
  notificationId: '11111111-1111-4111-8111-111111111111',
};

const CONFIG = {
  tenantId: 'tenant-1',
  clientId: 'client-1',
  clientSecret: 'secret-1',
  sender: 'noreply@example.com',
  timeoutMs: 5_000,
};

type Reply = Response | Error;
interface Call {
  url: string;
  init: RequestInit;
}

/** fetch giả: request token luôn thành công (trừ khi kịch bản ghi đè), request sendMail lấy lần lượt từ `replies`. */
function harness(options: { replies?: Reply[]; tokenReplies?: Reply[]; startAt?: Date } = {}) {
  const replies = [...(options.replies ?? [])];
  const tokenReplies = [...(options.tokenReplies ?? [])];
  const calls: Call[] = [];
  let now = (options.startAt ?? new Date('2026-09-19T00:00:00Z')).getTime();
  const clock: Clock = { now: () => new Date(now) };
  const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init: init ?? {} });
    const isToken = url.startsWith('https://login.microsoftonline.com/');
    const reply = isToken ? (tokenReplies.shift() ?? tokenOk()) : replies.shift();
    if (!reply) throw new Error(`unexpected request ${url}`);
    if (reply instanceof Error) throw reply;
    return reply;
  }) as typeof fetch;
  const provider = new GraphEmailProvider({ config: CONFIG, clock, logger: silent, fetch: fakeFetch });
  return {
    provider,
    calls,
    tokenCalls: () => calls.filter((c) => c.url.includes('login.microsoftonline.com')),
    advance: (ms: number) => {
      now += ms;
    },
  };
}

function tokenOk(token = 'token-1', expiresIn = 3600): Response {
  return Response.json({ access_token: token, expires_in: expiresIn, token_type: 'Bearer' });
}

function graph(status: number, headers: Record<string, string> = {}, body?: unknown): Response {
  return body === undefined ? new Response(null, { status, headers }) : Response.json(body, { status, headers });
}

function networkError(code: string): Error {
  return new TypeError('fetch failed', { cause: Object.assign(new Error(code), { code }) });
}

describe('GraphEmailProvider — request', () => {
  it('lấy token client credentials rồi POST /users/{sender}/sendMail đúng định dạng', async () => {
    const h = harness({ replies: [graph(202, { 'request-id': 'req-1' })] });
    expect(await h.provider.send(EMAIL)).toEqual({ kind: 'accepted', providerMessageId: 'req-1' });

    const [token, send] = h.calls;
    expect(token?.url).toBe('https://login.microsoftonline.com/tenant-1/oauth2/v2.0/token');
    const form = new URLSearchParams(String(token?.init.body));
    expect(Object.fromEntries(form)).toEqual({
      client_id: 'client-1',
      client_secret: 'secret-1',
      scope: 'https://graph.microsoft.com/.default',
      grant_type: 'client_credentials',
    });

    expect(send?.url).toBe('https://graph.microsoft.com/v1.0/users/noreply%40example.com/sendMail');
    expect(send?.init.method).toBe('POST');
    const headers = send?.init.headers as Record<string, string>;
    expect(headers['authorization']).toBe('Bearer token-1');
    expect(headers['client-request-id']).toBe(EMAIL.notificationId);
    expect(JSON.parse(String(send?.init.body))).toEqual(sendMailBody(EMAIL));
    expect(send?.init.signal).toBeInstanceOf(AbortSignal);
  });

  it('body sendMail: HTML, một người nhận, header truy vết, không lưu Sent Items', () => {
    expect(sendMailBody(EMAIL)).toEqual({
      message: {
        subject: 'Hello',
        body: { contentType: 'HTML', content: '<p>Hi</p>' },
        toRecipients: [{ emailAddress: { address: 'user@example.com' } }],
        internetMessageHeaders: [{ name: 'X-EWS-Notification-Id', value: EMAIL.notificationId }],
      },
      saveToSentItems: false,
    });
  });
});

describe('GraphEmailProvider — token cache', () => {
  it('dùng lại token cho tới 5 phút trước khi hết hạn, rồi lấy token mới', async () => {
    const h = harness({
      replies: [graph(202), graph(202), graph(202)],
      tokenReplies: [tokenOk('token-1', 3600), tokenOk('token-2', 3600)],
    });
    await h.provider.send(EMAIL);
    h.advance(54 * 60_000);
    await h.provider.send(EMAIL);
    expect(h.tokenCalls()).toHaveLength(1);

    h.advance(2 * 60_000); // còn < 5 phút
    await h.provider.send(EMAIL);
    expect(h.tokenCalls()).toHaveLength(2);
    const last = h.calls.at(-1)?.init.headers as Record<string, string>;
    expect(last['authorization']).toBe('Bearer token-2');
  });

  it('nhiều lần gửi đồng thời chỉ tạo MỘT request token', async () => {
    const h = harness({ replies: [graph(202), graph(202), graph(202)] });
    await Promise.all([h.provider.send(EMAIL), h.provider.send(EMAIL), h.provider.send(EMAIL)]);
    expect(h.tokenCalls()).toHaveLength(1);
  });

  it('401 từ Graph -> retryable ngay và bỏ token cache', async () => {
    const h = harness({ replies: [graph(401, {}, { error: { code: 'InvalidAuthenticationToken', message: 'expired' } }), graph(202)] });
    const first = await h.provider.send(EMAIL);
    expect(first).toMatchObject({ kind: 'retryable', retryAfterMs: 0 });
    await h.provider.send(EMAIL);
    expect(h.tokenCalls()).toHaveLength(2);
  });

  it('token bị Entra ID từ chối (400/401 — secret sai) -> rejected, không gọi sendMail', async () => {
    const h = harness({
      tokenReplies: [Response.json({ error: 'invalid_client', error_description: 'AADSTS7000215: Invalid client secret.\r\nTrace' }, { status: 401 })],
    });
    const result = await h.provider.send(EMAIL);
    expect(result).toMatchObject({ kind: 'rejected' });
    expect(result.kind === 'rejected' && result.reason).toContain('invalid_client');
    expect(result.kind === 'rejected' && result.reason).not.toContain('Trace');
    expect(h.calls).toHaveLength(1);
  });

  it('token endpoint lỗi tạm (503 / mất mạng) -> retryable: thư chắc chắn chưa đi', async () => {
    for (const reply of [Response.json({}, { status: 503 }), networkError('ETIMEDOUT')]) {
      const h = harness({ tokenReplies: [reply] });
      expect(await h.provider.send(EMAIL)).toMatchObject({ kind: 'retryable', retryAfterMs: null });
      expect(h.calls).toHaveLength(1);
    }
  });
});

describe('GraphEmailProvider — phân loại kết quả sendMail', () => {
  it.each([
    ['429 kèm Retry-After', graph(429, { 'retry-after': '7' }), { kind: 'retryable', retryAfterMs: 7_000 }],
    ['503 kèm Retry-After', graph(503, { 'retry-after': '2' }), { kind: 'retryable', retryAfterMs: 2_000 }],
    ['429 không có Retry-After', graph(429), { kind: 'retryable', retryAfterMs: null }],
    ['400 địa chỉ sai', graph(400, {}, { error: { code: 'ErrorInvalidRecipients', message: 'bad' } }), { kind: 'rejected' }],
    ['403 mailbox không có quyền', graph(403, {}, { error: { code: 'ErrorAccessDenied', message: 'denied' } }), { kind: 'rejected' }],
    ['404 sender không tồn tại', graph(404), { kind: 'rejected' }],
    ['500', graph(500), { kind: 'unknown' }],
    ['502', graph(502), { kind: 'unknown' }],
    ['504', graph(504), { kind: 'unknown' }],
  ] as const)('%s', async (_name, reply, expected) => {
    const h = harness({ replies: [reply] });
    expect(await h.provider.send(EMAIL)).toMatchObject(expected);
  });

  it('lý do từ chối mang code và message của Graph', async () => {
    const h = harness({ replies: [graph(400, {}, { error: { code: 'ErrorInvalidRecipients', message: 'bad address' } })] });
    expect(await h.provider.send(EMAIL)).toEqual({ kind: 'rejected', reason: 'HTTP 400 ErrorInvalidRecipients: bad address' });
  });

  it.each(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ENETUNREACH', 'EHOSTUNREACH'])(
    'không kết nối được (%s) -> retryable: request chưa từng đi',
    async (code) => {
      const h = harness({ replies: [networkError(code)] });
      expect(await h.provider.send(EMAIL)).toMatchObject({ kind: 'retryable' });
    },
  );

  it('timeout -> unknown: có thể Microsoft đã nhận', async () => {
    const h = harness({ replies: [new DOMException('The operation was aborted due to timeout', 'TimeoutError')] });
    expect(await h.provider.send(EMAIL)).toEqual({ kind: 'unknown', reason: 'network: timeout' });
  });

  it('đứt kết nối giữa chừng (ECONNRESET) -> unknown', async () => {
    const h = harness({ replies: [networkError('ECONNRESET')] });
    expect(await h.provider.send(EMAIL)).toMatchObject({ kind: 'unknown' });
  });
});
