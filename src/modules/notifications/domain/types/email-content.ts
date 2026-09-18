import { issue, ValidationError, type Issue } from '../../../../shared/kernel/index.ts';

/** Giới hạn độ dài một dòng header theo RFC 5322 — Subject là một header. */
export const MAX_EMAIL_SUBJECT_LENGTH = 998;
/** Mỗi phần thân (html / text). Route gửi email nới bodyLimit tương ứng (ADR-0016). */
export const MAX_EMAIL_BODY_BYTES = 256 * 1024;

/**
 * Nội dung một email gửi trực tiếp (MVP chưa có template — ADR-0016 D4). Value object: chỉ tạo qua
 * `emailContent()`, đã hợp lệ thì bất biến.
 */
export interface EmailContent {
  readonly subject: string;
  readonly html: string;
  /** Bản thuần văn bản cho trình đọc mail không hiển thị HTML. Không có -> null. */
  readonly text: string | null;
}

const UTF8 = new TextEncoder();

export function emailContent(input: { subject: string; html: string; text?: string | null | undefined }): EmailContent {
  const subject = input.subject.trim();
  const text = input.text?.trim() ? input.text : null;
  const issues: Issue[] = [];

  if (!subject) issues.push(issue('EMAIL_SUBJECT_REQUIRED', 'email subject must not be empty', 'subject'));
  if (subject.length > MAX_EMAIL_SUBJECT_LENGTH) {
    issues.push(issue('EMAIL_SUBJECT_TOO_LONG', `email subject exceeds ${MAX_EMAIL_SUBJECT_LENGTH} characters`, 'subject'));
  }
  // Xuống dòng trong Subject = chèn thêm header vào thư (header injection).
  if (/[\r\n]/.test(subject)) {
    issues.push(issue('EMAIL_SUBJECT_INVALID', 'email subject must not contain line breaks', 'subject'));
  }
  if (!input.html.trim()) issues.push(issue('EMAIL_HTML_REQUIRED', 'email html body must not be empty', 'html'));
  for (const [path, body] of [['html', input.html], ['text', text]] as const) {
    if (body !== null && UTF8.encode(body).length > MAX_EMAIL_BODY_BYTES) {
      issues.push(issue('EMAIL_BODY_TOO_LARGE', `email ${path} body exceeds ${MAX_EMAIL_BODY_BYTES} bytes`, path));
    }
  }
  if (issues.length) throw new ValidationError(issues);

  return Object.freeze({ subject, html: input.html, text });
}
