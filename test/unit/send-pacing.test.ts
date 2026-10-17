import { describe, expect, it } from 'vitest';
import { AppId } from '../../src/shared/kernel/index.ts';
import { planSendTimes } from '../../src/modules/notifications/application/commands/send-timing.ts';
import type { SendPolicy } from '../../src/modules/notifications/application/ports/index.ts';
import { paceLimitPerMinute, paceSlotTime } from '../../src/modules/notifications/domain/rules/send-pacing.ts';
import { parseSendWindow } from '../../src/shared/kernel/index.ts';

/** Dàn đều (ADR-0032 GĐ 2). 2026-10-16 là thứ Sáu, giờ Việt Nam UTC+7. */
const vn = (iso: string) => new Date(`${iso}+07:00`);
const normal = { mandatory: false };
const mandatory = { mandatory: true };

describe('paceLimitPerMinute', () => {
  const policy = (perMinute: number | null, maxPerMinute: number | null, mandatoryBypassPacing = true) => ({
    perMinute,
    maxPerMinute,
    mandatoryBypassPacing,
  });

  it('không đặt gì -> không dàn', () => {
    expect(paceLimitPerMinute(policy(null, null), normal)).toBeNull();
  });
  it('thư thường: số nhỏ hơn giữa mức app và trần', () => {
    expect(paceLimitPerMinute(policy(10, null), normal)).toBe(10);
    expect(paceLimitPerMinute(policy(null, 20), normal)).toBe(20);
    expect(paceLimitPerMinute(policy(30, 20), normal)).toBe(20);
  });
  it('tin bắt buộc + bỏ qua: không theo mức app, VẪN theo trần Super Admin', () => {
    expect(paceLimitPerMinute(policy(10, null), mandatory)).toBeNull();
    expect(paceLimitPerMinute(policy(10, 20), mandatory)).toBe(20);
  });
  it('tắt bỏ qua -> tin bắt buộc dàn như thư thường', () => {
    expect(paceLimitPerMinute(policy(10, 20, false), mandatory)).toBe(10);
  });
});

describe('paceSlotTime', () => {
  it('chia đều trong phút', () => {
    const minute = Math.floor(vn('2026-10-16T10:00:00').getTime() / 60_000);
    expect(paceSlotTime({ minute, index: 0 }, 4)).toEqual(vn('2026-10-16T10:00:00'));
    expect(paceSlotTime({ minute, index: 3 }, 4)).toEqual(vn('2026-10-16T10:00:45'));
  });
});

describe('planSendTimes', () => {
  const app = AppId.create();
  /** Bộ giữ lượt giả trong bộ nhớ — cùng luật với script Redis: mỗi phút tối đa `limit`. */
  function fakeSlots() {
    const used = new Map<number, number>();
    return {
      async reserve(_app: unknown, limit: number, from: Date, count: number) {
        const out: { minute: number; index: number }[] = [];
        for (let m = Math.floor(from.getTime() / 60_000); out.length < count; m += 1) {
          for (let i = used.get(m) ?? 0; i < limit && out.length < count; i += 1) {
            out.push({ minute: m, index: i });
            used.set(m, i + 1);
          }
        }
        return out;
      },
    };
  }
  const base: SendPolicy = {
    window: null,
    mandatoryBypassWindow: true,
    perMinute: null,
    mandatoryBypassPacing: true,
    maxPerMinute: null,
  };
  const plan = (policy: Partial<SendPolicy>, topic: { mandatory: boolean }, now: Date, count: number, slots = fakeSlots()) =>
    planSendTimes({ policies: { forApp: async () => ({ ...base, ...policy }) }, slots }, app, topic, now, count);

  it('không giới hạn -> mọi thư gửi ngay', async () => {
    expect(await plan({}, normal, vn('2026-10-16T10:00:00'), 3)).toEqual([null, null, null]);
  });

  it('dàn 2 thư/phút: 5 thư -> 2 đi ngay, phần còn lại rải sang các phút sau', async () => {
    const times = await plan({ perMinute: 2 }, normal, vn('2026-10-16T10:00:00'), 5);
    expect(times).toEqual([
      null,
      { at: vn('2026-10-16T10:00:30'), reason: 'pacing' },
      { at: vn('2026-10-16T10:01:00'), reason: 'pacing' },
      { at: vn('2026-10-16T10:01:30'), reason: 'pacing' },
      { at: vn('2026-10-16T10:02:00'), reason: 'pacing' },
    ]);
  });

  it('lượt rơi vào lúc đã qua trong phút hiện tại -> gửi ngay', async () => {
    const times = await plan({ perMinute: 2 }, normal, vn('2026-10-16T10:00:40'), 3);
    expect(times).toEqual([null, null, { at: vn('2026-10-16T10:01:00'), reason: 'pacing' }]);
  });

  it('ngoài khung + dàn đều: bắt đầu từ lúc khung mở, không dồn cùng lúc', async () => {
    const window = parseSendWindow({ days: [1, 2, 3, 4, 5], start: '08:00', end: '18:00' });
    const times = await plan({ window, perMinute: 1 }, normal, vn('2026-10-16T22:00:00'), 3);
    expect(times).toEqual([
      { at: vn('2026-10-19T08:00:00'), reason: 'send_window' },
      { at: vn('2026-10-19T08:01:00'), reason: 'pacing' },
      { at: vn('2026-10-19T08:02:00'), reason: 'pacing' },
    ]);
  });

  it('tin bắt buộc chen vào phần trần còn trống trong khi thư thường đã xếp kín mức app', async () => {
    const slots = fakeSlots();
    const now = vn('2026-10-16T10:00:00');
    await plan({ perMinute: 2, maxPerMinute: 4 }, normal, now, 6, slots); // 10:00, 10:01, 10:02 kín 2/phút
    const urgent = await plan({ perMinute: 2, maxPerMinute: 4 }, mandatory, now, 2, slots);
    expect(urgent).toEqual([{ at: vn('2026-10-16T10:00:30'), reason: 'pacing' }, { at: vn('2026-10-16T10:00:45'), reason: 'pacing' }]);
  });
});
