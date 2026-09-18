import { describe, expect, it } from 'vitest';
import { Notification } from '../../src/modules/notifications/domain/entities/notification.ts';
import {
  emailContent,
  MAX_EMAIL_BODY_BYTES,
  MAX_EMAIL_SUBJECT_LENGTH,
} from '../../src/modules/notifications/domain/types/email-content.ts';
import { AppId, NotificationId, TopicId, UserId, ValidationError } from '../../src/shared/kernel/index.ts';

const codes = (fn: () => unknown): string[] => {
  try {
    fn();
    return [];
  } catch (err) {
    return (err as ValidationError).issues.map((i) => i.code);
  }
};

describe('EmailContent — nội dung email gửi trực tiếp (ADR-0016)', () => {
  it('hợp lệ: trim subject, text rỗng -> null, bất biến', () => {
    const c = emailContent({ subject: '  Đơn OS10527 đã giao  ', html: '<p>Xin chào</p>', text: '   ' });
    expect(c).toEqual({ subject: 'Đơn OS10527 đã giao', html: '<p>Xin chào</p>', text: null });
    expect(Object.isFrozen(c)).toBe(true);
  });

  it('thiếu subject / html -> gom đủ lỗi', () => {
    expect(codes(() => emailContent({ subject: ' ', html: '' }))).toEqual(['EMAIL_SUBJECT_REQUIRED', 'EMAIL_HTML_REQUIRED']);
  });

  // Xuống dòng trong Subject là chèn header vào thư.
  it('subject có xuống dòng -> chặn (header injection)', () => {
    expect(codes(() => emailContent({ subject: 'Hi\r\nBcc: attacker@evil.test', html: 'x' }))).toContain('EMAIL_SUBJECT_INVALID');
  });

  it('subject quá 998 ký tự / body quá 256 KB (đếm theo byte UTF-8) -> chặn', () => {
    expect(codes(() => emailContent({ subject: 'a'.repeat(MAX_EMAIL_SUBJECT_LENGTH + 1), html: 'x' }))).toEqual([
      'EMAIL_SUBJECT_TOO_LONG',
    ]);
    // 'đ' là 2 byte UTF-8: đếm ký tự thì lọt, đếm byte thì vượt.
    const big = 'đ'.repeat(MAX_EMAIL_BODY_BYTES / 2 + 1);
    expect(codes(() => emailContent({ subject: 's', html: big }))).toEqual(['EMAIL_BODY_TOO_LARGE']);
    expect(codes(() => emailContent({ subject: 's', html: 'x', text: big }))).toEqual(['EMAIL_BODY_TOO_LARGE']);
  });

  it('Notification mang người nhận + nội dung; không khai thì là null (gửi theo segment / template)', () => {
    const base = {
      id: NotificationId.create(),
      appId: AppId.create(),
      topicId: TopicId.create(),
      origin: 'api' as const,
      createdAt: new Date('2026-09-19T00:00:00.000Z'),
    };
    const userId = UserId.create();
    const direct = new Notification({ ...base, targetUserId: userId, content: emailContent({ subject: 's', html: 'h' }) });
    expect(direct.targetUserId).toBe(userId);
    expect(direct.content?.subject).toBe('s');
    expect(direct.status).toBe('queued');

    const plain = new Notification(base);
    expect(plain.targetUserId).toBeNull();
    expect(plain.content).toBeNull();
  });
});
