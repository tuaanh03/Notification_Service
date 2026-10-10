import { createHmac, timingSafeEqual } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { AppId, WebhookDeliveryId, WebhookEndpointId } from '../../src/shared/kernel/index.ts';
import {
  isPrivateAddress,
  nextAttemptAt,
  parseWebhookUrl,
  WEBHOOK_MAX_ATTEMPTS,
  WebhookDelivery,
  WebhookEndpoint,
} from '../../src/modules/webhooks/domain/index.ts';
import { HmacWebhookSecrets, HttpsWebhookTransport } from '../../src/modules/webhooks/infrastructure/adapters/index.ts';

const codeOf = (fn: () => unknown): string | undefined => {
  try {
    fn();
  } catch (err) {
    return (err as { issues?: { code: string }[] }).issues?.[0]?.code;
  }
  return undefined;
};

describe('isPrivateAddress — chặn webhook gọi vào mạng nội bộ (ADR-0029 §7b)', () => {
  it.each([
    '10.36.67.52', '127.0.0.1', '0.0.0.0', '169.254.169.254', '172.16.0.1', '172.31.255.255', '192.168.1.1',
    '100.64.0.1', '224.0.0.1', '::1', '::', 'fd12::1', 'fe80::1', '::ffff:10.0.0.1', '[::1]', 'không-phải-ip', '999.1.1.1',
  ])('%s -> chặn', (ip) => expect(isPrivateAddress(ip)).toBe(true));

  it.each(['8.8.8.8', '172.32.0.1', '172.15.0.1', '100.128.0.1', '2606:4700::1111', '::ffff:8.8.8.8'])('%s -> cho qua', (ip) =>
    expect(isPrivateAddress(ip)).toBe(false),
  );
});

describe('parseWebhookUrl', () => {
  it('https công khai -> giữ nguyên (chuẩn hoá)', () => {
    expect(parseWebhookUrl('https://alert.company.com/ews-hook?x=1')).toBe('https://alert.company.com/ews-hook?x=1');
  });

  it.each([
    'http://alert.company.com/hook',
    'https://user:pass@alert.company.com/hook',
    'https://alert.company.com/hook#frag',
    'https://localhost/hook',
    'https://10.36.67.52:4002/hook',
    'https://[::1]/hook',
    'không phải url',
    `https://a.com/${'x'.repeat(2048)}`,
  ])('%s -> WEBHOOK_URL_INVALID', (url) => expect(codeOf(() => parseWebhookUrl(url))).toBe('WEBHOOK_URL_INVALID'));
});

describe('WebhookEndpoint', () => {
  const make = (events: string[]) =>
    new WebhookEndpoint({
      id: WebhookEndpointId.create(),
      appId: AppId.create(),
      slot: 1,
      url: 'https://a.com/h',
      events: events as never,
      createdAt: new Date(),
    });

  it('sự kiện: bỏ trùng, theo thứ tự cố định; rỗng / lạ là lỗi', () => {
    expect(make(['notification.no_recipient', 'notification.sent', 'notification.sent']).events).toEqual([
      'notification.sent',
      'notification.no_recipient',
    ]);
    expect(codeOf(() => make([]))).toBe('WEBHOOK_EVENTS_REQUIRED');
    expect(codeOf(() => make(['ping']))).toBe('WEBHOOK_EVENT_UNKNOWN');
  });

  it('tối đa 2 chỗ mỗi app', () => {
    expect(WebhookEndpoint.freeSlot([])).toBe(1);
    expect(WebhookEndpoint.freeSlot([1])).toBe(2);
    expect(WebhookEndpoint.freeSlot([2])).toBe(1);
    expect(WebhookEndpoint.freeSlot([1, 2])).toBeNull();
    expect(codeOf(() => WebhookEndpoint.assertHasFreeSlot(null))).toBe('WEBHOOK_LIMIT_REACHED');
  });

  it('URL tắt thì không nhận sự kiện nào', () => {
    const endpoint = make(['notification.sent']);
    expect(endpoint.subscribesTo('notification.sent')).toBe(true);
    expect(endpoint.subscribesTo('notification.failed')).toBe(false);
    endpoint.setStatus('disabled', new Date());
    expect(endpoint.subscribesTo('notification.sent')).toBe(false);
  });
});

describe('lịch gọi lại', () => {
  const at = new Date('2026-10-10T00:00:00.000Z');
  const minutesAfter = (attempts: number) => {
    const next = nextAttemptAt(attempts, at);
    return next === null ? null : (next.getTime() - at.getTime()) / 60_000;
  };

  it('1 phút · 5 phút · 30 phút · 2 giờ · 6 giờ, rồi hết lượt (tổng 6 lần gọi)', () => {
    expect([1, 2, 3, 4, 5, 6].map(minutesAfter)).toEqual([1, 5, 30, 120, 360, null]);
    expect(WEBHOOK_MAX_ATTEMPTS).toBe(6);
  });

  it('WebhookDelivery: lỗi 5 lần còn pending, lần 6 thành failed; thành công thì delivered', () => {
    const delivery = new WebhookDelivery({
      id: WebhookDeliveryId.create(),
      endpointId: WebhookEndpointId.create(),
      appId: AppId.create(),
      eventId: 'e1',
      eventType: 'notification.sent',
      body: '{}',
      createdAt: at,
    });
    expect(delivery.nextAttemptAt).toEqual(at);
    for (let i = 1; i <= 5; i++) {
      delivery.recordFailure({ statusCode: 500, error: 'http_500' }, at);
      expect([delivery.status, delivery.attempts]).toEqual(['pending', i]);
    }
    delivery.recordFailure({ statusCode: null, error: 'timeout' }, at);
    expect([delivery.status, delivery.attempts, delivery.nextAttemptAt]).toEqual(['failed', 6, null]);

    const ok = new WebhookDelivery({ ...delivery, id: WebhookDeliveryId.create(), status: 'pending', attempts: 0, nextAttemptAt: at, createdAt: at });
    ok.recordSuccess(204, at);
    expect([ok.status, ok.attempts, ok.lastStatusCode, ok.deliveredAt]).toEqual(['delivered', 1, 204, at]);
  });

  it('gửi thử (retry = false): lỗi là failed ngay', () => {
    const delivery = new WebhookDelivery({
      id: WebhookDeliveryId.create(),
      endpointId: WebhookEndpointId.create(),
      appId: AppId.create(),
      eventId: 'e1',
      eventType: 'ping',
      body: '{}',
      createdAt: at,
    });
    delivery.recordFailure({ statusCode: 404, error: 'http_404' }, at, false);
    expect(delivery.status).toBe('failed');
  });
});

describe('HmacWebhookSecrets — secret không lưu, tính lại từ khoá chủ', () => {
  const key = 'k'.repeat(32);
  const endpointId = WebhookEndpointId.create();

  it('cùng (khoá, URL, phiên bản) -> cùng secret; đổi phiên bản / khoá / URL -> secret khác', () => {
    const secrets = new HmacWebhookSecrets({ signingKey: key });
    const s1 = secrets.secretFor(endpointId, 1);
    expect(s1).toMatch(/^whsec_[A-Za-z0-9_-]{43}$/);
    expect(secrets.secretFor(endpointId, 1)).toBe(s1);
    expect(secrets.secretFor(endpointId, 2)).not.toBe(s1);
    expect(new HmacWebhookSecrets({ signingKey: 'x'.repeat(32) }).secretFor(endpointId, 1)).not.toBe(s1);
    expect(secrets.secretFor(WebhookEndpointId.create(), 1)).not.toBe(s1);
  });

  it('chữ ký kiểm được bằng đúng đoạn code mẫu trong tài liệu cho đội app', () => {
    const secrets = new HmacWebhookSecrets({ signingKey: key });
    const body = '{"id":"evt","type":"notification.sent"}';
    const header = secrets.signatureHeader(endpointId, 1, body, new Date('2026-10-10T09:40:13.411Z'));
    expect(header).toMatch(/^t=1791625213,v1=[0-9a-f]{64}$/);

    // Code phía app (docs/huong-dan-tich-hop-cho-doi-app.md) — không biết gì về EWS ngoài secret.
    const verify = (rawBody: string, signature: string, secret: string) => {
      const { t, v1 } = Object.fromEntries(signature.split(',').map((p) => p.split('='))) as { t: string; v1: string };
      const expected = createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex');
      return timingSafeEqual(Buffer.from(expected), Buffer.from(v1));
    };
    expect(verify(body, header, secrets.secretFor(endpointId, 1))).toBe(true);
    expect(verify(`${body} `, header, secrets.secretFor(endpointId, 1))).toBe(false);
    expect(verify(body, header, secrets.secretFor(endpointId, 2))).toBe(false);
  });
});

describe('HttpsWebhookTransport', () => {
  it('URL là IP nội bộ -> không kết nối, failed / blocked_private_address', async () => {
    const transport = new HttpsWebhookTransport({ timeoutMs: 1_000 });
    await expect(transport.post({ url: 'https://127.0.0.1/hook', body: '{}', headers: {} })).resolves.toEqual({
      kind: 'failed',
      statusCode: null,
      error: 'blocked_private_address',
    });
  });

  it('tên miền phân giải ra IP nội bộ -> chặn ở bước phân giải', async () => {
    const transport = new HttpsWebhookTransport({ timeoutMs: 2_000 });
    // `localhost` luôn phân giải ra 127.0.0.1 / ::1 — không cần mạng ngoài.
    await expect(transport.post({ url: 'https://localhost:9/hook', body: '{}', headers: {} })).resolves.toMatchObject({
      kind: 'failed',
      error: 'blocked_private_address',
    });
  });
});
