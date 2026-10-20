/**
 * Kiểm cấu trúc MJML mà `designToMjml` sinh (ADR-0037) — backend không có trình biên dịch MJML, nên test tự soát:
 * chỉ thẻ / thuộc tính MJML đã biết, lồng đúng cha-con, thẻ nào cũng đóng, giá trị thuộc tính không có `"` / `<`
 * thô, nội dung thẻ "kết thúc" (`mj-text`, `mj-button`, `mj-raw` — MJML coi là HTML thô) không chứa thẻ `mj-*`.
 * Bản biên dịch thật (mjml-browser, `validationLevel: 'strict'`) chạy ở `fixtures/compile-preset-html.ts`.
 * Trả danh sách vấn đề; rỗng = hợp lệ.
 */
const CHILDREN: Readonly<Record<string, readonly string[]>> = {
  '#root': ['mjml'],
  mjml: ['mj-head', 'mj-body'],
  'mj-head': ['mj-attributes'],
  'mj-attributes': ['mj-all'],
  'mj-all': [],
  'mj-body': ['mj-section'],
  'mj-section': ['mj-column'],
  'mj-column': ['mj-text', 'mj-button', 'mj-image', 'mj-divider', 'mj-spacer', 'mj-raw'],
  'mj-image': [],
  'mj-divider': [],
  'mj-spacer': [],
};
/** Nội dung là HTML thô — không đọc thẻ `mj-*` bên trong. */
const ENDING = new Set(['mj-text', 'mj-button', 'mj-raw']);
const ATTRIBUTES: Readonly<Record<string, readonly string[]>> = {
  mjml: [],
  'mj-head': [],
  'mj-attributes': [],
  'mj-all': ['font-family'],
  'mj-body': ['width', 'background-color'],
  'mj-section': ['background-color', 'padding'],
  'mj-column': [],
  'mj-text': ['align', 'color', 'font-family', 'font-size', 'font-weight', 'line-height', 'padding'],
  'mj-button': [
    'href',
    'align',
    'background-color',
    'color',
    'font-family',
    'font-size',
    'font-weight',
    'line-height',
    'border-radius',
    'inner-padding',
    'padding',
  ],
  'mj-image': ['src', 'alt', 'width', 'href', 'align', 'padding'],
  'mj-divider': ['border-width', 'border-style', 'border-color', 'padding'],
  'mj-spacer': ['height'],
  'mj-raw': [],
};

const OPEN_RE = /^<(mjml|mj-[a-z]+)((?:\s+[a-z-]+="[^"<]*")*)\s*>/;
const ATTR_RE = /\s+([a-z-]+)="([^"<]*)"/g;

export function mjmlProblems(mjml: string): string[] {
  const problems: string[] = [];
  const stack: string[] = ['#root'];
  let i = 0;
  while (i < mjml.length) {
    const lt = mjml.indexOf('<', i);
    if (lt === -1) {
      if (mjml.slice(i).trim()) problems.push(`text outside a tag: ${mjml.slice(i, i + 40)}`);
      break;
    }
    if (mjml.slice(i, lt).trim()) problems.push(`text outside a tag: ${mjml.slice(i, lt).trim().slice(0, 40)}`);
    const rest = mjml.slice(lt);
    const close = /^<\/(mjml|mj-[a-z]+)>/.exec(rest);
    if (close) {
      const top = stack.pop();
      if (top !== close[1]) problems.push(`</${close[1]}> closes <${top}>`);
      i = lt + close[0].length;
      continue;
    }
    const open = OPEN_RE.exec(rest);
    if (!open) {
      problems.push(`unreadable tag: ${rest.slice(0, 40)}`);
      break;
    }
    const name = open[1]!;
    const parent = stack.at(-1)!;
    if (!(CHILDREN[parent] ?? []).includes(name)) problems.push(`<${name}> not allowed inside <${parent}>`);
    for (const [, key] of (open[2] ?? '').matchAll(ATTR_RE)) {
      if (!(ATTRIBUTES[name] ?? []).includes(key!)) problems.push(`<${name}> has unknown attribute ${key}`);
    }
    i = lt + open[0].length;
    if (ENDING.has(name)) {
      const end = mjml.indexOf(`</${name}>`, i);
      if (end === -1) {
        problems.push(`<${name}> is not closed`);
        break;
      }
      if (/<\/?mj-/.test(mjml.slice(i, end))) problems.push(`<${name}> content contains an mj-* tag`);
      i = end + `</${name}>`.length;
      continue;
    }
    stack.push(name);
  }
  if (stack.length > 1) problems.push(`not closed: ${stack.slice(1).join(', ')}`);
  return problems;
}
