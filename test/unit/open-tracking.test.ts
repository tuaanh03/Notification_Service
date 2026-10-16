import { describe, expect, it } from 'vitest';
import { RecordEmailOpen } from '../../src/modules/notifications/application/commands/record-email-open.ts';
import { openPixelPath, withOpenPixel } from '../../src/modules/notifications/domain/rules/open-pixel.ts';
import { HmacOpenTrackingSigner } from '../../src/modules/notifications/infrastructure/adapters/hmac-open-tracking-signer.ts';
import { NotificationId, type NotificationId as NotificationIdType } from '../../src/shared/kernel/index.ts';

const KEY = 'k'.repeat(32);
const IMG = (url: string) =>
  `<img src="${url}" width="1" height="1" alt="" style="display:block;width:1px;height:1px;border:0;" />`;

describe('withOpenPixel — chèn ảnh đếm "đã mở" (ADR-0031)', () => {
  it('chèn ngay trước </body> CUỐI CÙNG, không phân biệt hoa thường', () => {
    const html = '<html><body><p>a</p><pre></body></pre></BODY></html>';
    expect(withOpenPixel(html, 'https://x/t.gif')).toBe(`<html><body><p>a</p><pre></body></pre>${IMG('https://x/t.gif')}</BODY></html>`);
  });

  it('không có </body> -> nối vào cuối', () => {
    expect(withOpenPixel('<p>a</p>', 'https://x/t.gif')).toBe(`<p>a</p>${IMG('https://x/t.gif')}`);
  });

  it('thoát & và " trong URL', () => {
    expect(withOpenPixel('', 'https://x/?a=1&b="2"')).toBe(IMG('https://x/?a=1&amp;b=&quot;2&quot;'));
  });

  it('đường ảnh có id và chữ ký', () => {
    expect(openPixelPath('id-1', 'sig')).toBe('/t/o/id-1/sig.gif');
  });
});

describe('HmacOpenTrackingSigner', () => {
  const id = NotificationId.create();

  it('ký ổn định 43 ký tự base64url, verify đúng chữ ký của CHÍNH notification đó', () => {
    const signer = new HmacOpenTrackingSigner({ signingKey: KEY });
    const sig = signer.sign(id);
    expect(sig).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(signer.sign(id)).toBe(sig);
    expect(signer.verify(id, sig)).toBe(true);
    expect(signer.verify(NotificationId.create(), sig)).toBe(false);
    expect(signer.verify(id, `${sig[0] === 'A' ? 'B' : 'A'}${sig.slice(1)}`)).toBe(false);
    expect(signer.verify(id, 'short')).toBe(false);
  });

  it('khác khoá -> khác chữ ký', () => {
    expect(new HmacOpenTrackingSigner({ signingKey: KEY }).sign(id)).not.toBe(new HmacOpenTrackingSigner({ signingKey: 'z'.repeat(32) }).sign(id));
  });

  it('thiếu khoá -> configured=false, verify luôn false', () => {
    const signer = new HmacOpenTrackingSigner({ signingKey: undefined });
    expect(signer.configured).toBe(false);
    expect(signer.verify(id, 'x'.repeat(43))).toBe(false);
  });
});

describe('RecordEmailOpen — chỉ ghi khi chữ ký đúng', () => {
  function harness(signingKey: string | undefined) {
    const recorded: NotificationIdType[] = [];
    const signer = new HmacOpenTrackingSigner({ signingKey });
    const useCase = new RecordEmailOpen({
      clock: { now: () => new Date('2026-10-16T00:00:00.000Z') },
      signer,
      recipients: {
        findByNotification: async () => null,
        findByNotifications: async () => new Map(),
        insert: async () => undefined,
        update: async () => undefined,
        recordOpen: async (notificationId) => {
          recorded.push(notificationId);
          return true;
        },
      },
    });
    return { useCase, recorded, signer };
  }

  it('chữ ký đúng -> ghi một lượt', async () => {
    const { useCase, recorded } = harness(KEY);
    const id = NotificationId.create();
    const signature = new HmacOpenTrackingSigner({ signingKey: KEY }).sign(id);
    expect(await useCase.execute({ notificationId: id, signature })).toBe(true);
    expect(recorded).toEqual([id]);
  });

  it.each([
    ['chữ ký sai', NotificationId.create(), 'x'.repeat(43)],
    ['id không phải UUID', 'not-a-uuid', 'x'.repeat(43)],
  ])('%s -> không ghi gì', async (_name, notificationId, signature) => {
    const { useCase, recorded } = harness(KEY);
    expect(await useCase.execute({ notificationId, signature })).toBe(false);
    expect(recorded).toEqual([]);
  });

  it('server thiếu khoá -> không ghi gì', async () => {
    const { useCase, recorded } = harness(undefined);
    expect(await useCase.execute({ notificationId: NotificationId.create(), signature: 'x'.repeat(43) })).toBe(false);
    expect(recorded).toEqual([]);
  });
});
