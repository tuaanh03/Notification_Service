import { describe, expect, it } from 'vitest';
import { vnDate, vnDayRange } from '../../src/modules/notifications/application/queries/template-stats.ts';

describe('Khoảng ngày giờ Việt Nam cho số liệu template (UX-24)', () => {
  it('30 ngày tính tới hôm nay: bắt đầu 00:00 giờ VN của ngày đầu, kết thúc là bây giờ', () => {
    const now = new Date('2026-10-23T03:15:00Z'); // 10:15 ngày 23/10 ở VN
    const range = vnDayRange(now, 30);
    expect(range.to).toBe(now);
    expect(range.from.toISOString()).toBe('2026-09-23T17:00:00.000Z'); // 00:00 ngày 24/09 giờ VN
    expect(vnDate(range.firstDay)).toBe('2026-09-24');
    expect(vnDate(range.firstDay + 29)).toBe('2026-10-23');
  });

  it('sau 17:00 UTC đã là ngày hôm sau ở VN', () => {
    const range = vnDayRange(new Date('2026-10-22T17:30:00Z'), 7);
    expect(vnDate(range.firstDay + 6)).toBe('2026-10-23');
    expect(range.from.toISOString()).toBe('2026-10-16T17:00:00.000Z');
  });
});
