import { describe, expect, it } from 'vitest';
import { nextSendOpening, parseSendWindow, ValidationError } from '../../src/shared/kernel/index.ts';
import { sendHoldUntil } from '../../src/modules/notifications/domain/rules/send-window-hold.ts';

/** Khung giờ gửi (ADR-0032) — giờ Việt Nam UTC+7. 2026-10-16 là thứ Sáu. */
const officeHours = parseSendWindow({ days: [5, 1, 2, 3, 4, 4], start: '08:00', end: '18:00' });
const vn = (iso: string) => new Date(`${iso}+07:00`);

describe('parseSendWindow', () => {
  it('chuẩn hoá ngày: bỏ trùng, sắp tăng', () => {
    expect(officeHours).toEqual({ days: [1, 2, 3, 4, 5], start: '08:00', end: '18:00' });
  });

  it.each([
    [{ days: [], start: '08:00', end: '18:00' }, 'SEND_WINDOW_DAYS_REQUIRED'],
    [{ days: [0], start: '08:00', end: '18:00' }, 'SEND_WINDOW_DAY_INVALID'],
    [{ days: [1], start: '8:00', end: '18:00' }, 'SEND_WINDOW_TIME_INVALID'],
    [{ days: [1], start: '08:00', end: '24:01' }, 'SEND_WINDOW_TIME_INVALID'],
    [{ days: [1], start: '24:00', end: '24:00' }, 'SEND_WINDOW_TIME_INVALID'],
    [{ days: [1], start: '18:00', end: '18:00' }, 'SEND_WINDOW_EMPTY'],
    [{ days: [1], start: '22:00', end: '06:00' }, 'SEND_WINDOW_EMPTY'],
  ])('%j -> %s', (input, code) => {
    try {
      parseSendWindow(input);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      expect((err as ValidationError).issues[0]!.code).toBe(code);
    }
  });
});

describe('nextSendOpening', () => {
  it('trong khung -> chính lúc đó', () => {
    const now = vn('2026-10-16T10:00:00');
    expect(nextSendOpening(officeHours, now)).toEqual(now);
  });

  it('trước giờ mở cùng ngày -> giờ mở hôm đó', () => {
    expect(nextSendOpening(officeHours, vn('2026-10-16T07:59:00'))).toEqual(vn('2026-10-16T08:00:00'));
  });

  it('đúng giờ đóng (không thuộc khung) -> sáng thứ Hai', () => {
    expect(nextSendOpening(officeHours, vn('2026-10-16T18:00:00'))).toEqual(vn('2026-10-19T08:00:00'));
  });

  it('cuối tuần -> sáng thứ Hai', () => {
    expect(nextSendOpening(officeHours, vn('2026-10-17T12:00:00'))).toEqual(vn('2026-10-19T08:00:00'));
    expect(nextSendOpening(officeHours, vn('2026-10-18T23:30:00'))).toEqual(vn('2026-10-19T08:00:00'));
  });

  it('ngày giờ Việt Nam khác ngày UTC (06:00 VN = 23:00 UTC hôm trước) vẫn tính theo giờ Việt Nam', () => {
    expect(nextSendOpening(officeHours, new Date('2026-10-19T23:00:00Z'))).toEqual(vn('2026-10-20T08:00:00'));
  });

  it('24:00 = tới hết ngày; chỉ Chủ nhật -> tuần sau', () => {
    const sunday = parseSendWindow({ days: [7], start: '00:00', end: '24:00' });
    const lateSunday = vn('2026-10-18T23:59:00');
    expect(nextSendOpening(sunday, lateSunday)).toEqual(lateSunday);
    expect(nextSendOpening(sunday, vn('2026-10-19T00:00:00'))).toEqual(vn('2026-10-25T00:00:00'));
  });
});

describe('sendHoldUntil', () => {
  const night = vn('2026-10-16T22:00:00');
  const monday = vn('2026-10-19T08:00:00');

  it('không đặt khung -> gửi ngay', () => {
    expect(sendHoldUntil({ window: null, mandatoryBypass: false }, { mandatory: false }, night)).toBeNull();
  });

  it('ngoài khung -> chờ tới giờ mở; trong khung -> gửi ngay', () => {
    const policy = { window: officeHours, mandatoryBypass: true };
    expect(sendHoldUntil(policy, { mandatory: false }, night)).toEqual(monday);
    expect(sendHoldUntil(policy, { mandatory: false }, vn('2026-10-16T09:00:00'))).toBeNull();
  });

  it('tin bắt buộc: bỏ qua khung khi app cho phép, không thì chờ như thường', () => {
    expect(sendHoldUntil({ window: officeHours, mandatoryBypass: true }, { mandatory: true }, night)).toBeNull();
    expect(sendHoldUntil({ window: officeHours, mandatoryBypass: false }, { mandatory: true }, night)).toEqual(monday);
  });
});
