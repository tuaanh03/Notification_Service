import { issue, ValidationError, type Issue } from '../../../../shared/kernel/index.ts';
import type { TemplateContent } from '../entities/template-version.ts';
import { ALLOWED_LINK_RE, HREF_RE, parseVariables, VARIABLE_LINK_RE, VARIABLE_RE } from './template-variables.ts';

/** Dữ liệu của MỘT lần gửi để đổ vào template. */
export interface RenderInput {
  /** Body `payload` app gửi. Khoá không khai trong template bị bỏ qua (ADR-0020). */
  payload: Readonly<Record<string, unknown>>;
  /** `user.external_id` — lấy từ `to.externalId` của request. */
  externalId: string;
}

export interface RenderedContent {
  subject: string;
  html: string;
  text: string;
}

/**
 * Đổ biến vào bản ĐÃ XUẤT BẢN (đã qua `validate()`, nên mọi biến đều có nguồn và đã khai).
 *
 * - Một lượt duy nhất: giá trị chèn vào KHÔNG bị quét lại, `{{ ... }}` trong dữ liệu của app giữ nguyên chữ.
 * - html: giá trị được escape — payload không nhét được thẻ / thuộc tính vào thư. subject / text: giữ nguyên
 *   (xuống dòng trong subject do `emailContent()` chặn ở notifications).
 * - Thiếu biến bắt buộc, giá trị không phải chữ / số / true-false, link sau khi đổ không phải https / mailto:
 *   gom MỌI lỗi vào một `ValidationError` — app sửa một lần là đủ.
 */
export function renderTemplate(content: TemplateContent, input: RenderInput): RenderedContent {
  const issues: Issue[] = [];
  const values = new Map<string, string>();
  values.set('user.external_id', input.externalId);

  for (const spec of content.schema) {
    if (spec.source !== 'payload') continue;
    const key = spec.name.slice('payload.'.length);
    const value = Object.hasOwn(input.payload, key) ? input.payload[key] : undefined;
    if (value === undefined) {
      if (spec.required) {
        issues.push(issue('MISSING_VARIABLE', `payload.${key} is required by the template but missing`, spec.name));
      }
      continue;
    }
    if (typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) {
      values.set(spec.name, String(value));
      continue;
    }
    issues.push(
      issue('INVALID_PAYLOAD_VALUE', `payload.${key} must be a string, number or boolean`, spec.name),
    );
  }
  if (issues.length) throw new ValidationError(issues);

  const fill = (body: string, escape: boolean) =>
    body.replace(VARIABLE_RE, (match) => {
      const [variable] = parseVariables(match);
      const value = (variable && values.get(variable.path)) ?? variable?.defaultValue ?? null;
      if (value === null) {
        // Bản đã xuất bản không thể tới đây (biến tuỳ chọn bắt buộc có default) — vẫn chặn, không gửi thư thủng.
        issues.push(issue('MISSING_VARIABLE', `variable ${variable?.path ?? match} has no value`, variable?.path));
        return '';
      }
      return escape ? escapeHtml(value) : value;
    });

  // Link bắt đầu bằng biến: publish chưa biết giá trị (validateLinks bỏ qua) — kiểm ở đây, sau khi đổ.
  for (const match of content.html.matchAll(HREF_RE)) {
    const raw = (match[1] ?? match[2] ?? match[3] ?? '').trim();
    if (!VARIABLE_LINK_RE.test(raw)) continue;
    const link = fill(raw, false).trim();
    if (!ALLOWED_LINK_RE.test(link)) {
      issues.push(
        issue('LINK_SCHEME_NOT_ALLOWED', `link "${link}" is not allowed: only https:// and mailto: links are accepted`, 'payload'),
      );
    }
  }

  const rendered = { subject: fill(content.subject, false), html: fill(content.html, true), text: fill(content.text, false) };
  if (issues.length) throw new ValidationError(issues);
  return rendered;
}

const HTML_ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch] ?? ch);
}
