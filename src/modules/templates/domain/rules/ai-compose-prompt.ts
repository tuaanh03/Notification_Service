import type { TemplateContent } from '../entities/template-version.ts';

/**
 * AI soạn template (ADR-0020 §7) — phần THUẦN: dựng câu lệnh gửi AI và đọc câu trả lời.
 *
 * Gửi ra ngoài CHỈ: mô tả của người soạn, tên + mô tả các biến ĐÃ KHAI, nội dung đang soạn (khi sửa).
 * KHÔNG gửi giá trị mẫu, không gửi dữ liệu người nhận. AI chỉ được dùng biến đã khai — dùng biến lạ
 * thì không xoá âm thầm, `validate()` báo `VARIABLE_NOT_IN_SCHEMA` để người soạn thấy.
 */

export type AiComposeMode = 'new' | 'revise';

export interface AiComposeVariable {
  name: string;
  required: boolean;
  description?: string | undefined;
}

export interface AiComposeRequest {
  instruction: string;
  mode: AiComposeMode;
  variables: readonly AiComposeVariable[];
  /** Nội dung đang soạn — bắt buộc khi `revise`. */
  current?: Pick<TemplateContent, 'subject' | 'html' | 'text'> | undefined;
}

export interface AiChatMessage {
  role: 'system' | 'user';
  content: string;
}

export type AiComposedContent = Pick<TemplateContent, 'subject' | 'html' | 'text'>;

const SYSTEM_RULES = [
  'You write transactional email templates for an internal notification service.',
  'Reply with ONE JSON object and nothing else: {"subject": string, "html": string, "text": string}.',
  '- subject: one line, no line breaks, at most 200 characters.',
  '- html: a complete, responsive email body using inline CSS that works in email clients.',
  '- text: the same message as plain text for clients that cannot show HTML.',
  'Placeholders MUST use the exact syntax {{ payload.<name> }} and ONLY the variables listed by the user.',
  'Never invent new variables. If no variables are listed, write static content without placeholders.',
  'An optional variable must carry a default: {{ payload.<name> | default: "..." }}.',
  'Links must start with https:// or mailto: (a listed variable may be used as the link).',
  'Do NOT write any unsubscribe link, the word "unsubscribe", or a {{ footer }} placeholder: the system appends the footer.',
  'Write in the same language as the user instruction.',
].join('\n');

export function buildAiComposeMessages(request: AiComposeRequest): AiChatMessage[] {
  const variables = request.variables.length
    ? request.variables
        .map((v) => `- {{ ${v.name} }} (${v.required ? 'required' : 'optional'})${v.description ? `: ${v.description}` : ''}`)
        .join('\n')
    : '(none — do not use placeholders)';
  const parts = [`Instruction:\n${request.instruction}`, `Variables you may use:\n${variables}`];
  if (request.mode === 'revise' && request.current) {
    parts.push(
      'Revise this existing template according to the instruction. Keep what the instruction does not ask to change.',
      `Current subject:\n${request.current.subject}`,
      `Current html:\n${request.current.html}`,
      `Current text:\n${request.current.text}`,
    );
  } else {
    parts.push('Write a new template.');
  }
  return [
    { role: 'system', content: SYSTEM_RULES },
    { role: 'user', content: parts.join('\n\n') },
  ];
}

/**
 * Đọc câu trả lời của AI. Không ép JSON phía nhà cung cấp (nhiều bên không hỗ trợ) nên chịu được
 * khung ```json và chữ thừa quanh object. Sai định dạng / thiếu trường -> null.
 */
export function parseAiComposeOutput(raw: string): AiComposedContent | null {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const { subject, html, text } = parsed as Record<string, unknown>;
  if (typeof subject !== 'string' || typeof html !== 'string') return null;
  return {
    // Xuống dòng trong tiêu đề = không gửi được (EMAIL_SUBJECT_INVALID) — gộp thành một dòng.
    subject: subject.replace(/\s*[\r\n]+\s*/g, ' ').trim(),
    html,
    text: typeof text === 'string' ? text : '',
  };
}
