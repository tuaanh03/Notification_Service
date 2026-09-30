import { describe, expect, it } from 'vitest';
import { TemplateId, TemplateVersionId, AppId } from '../../src/shared/kernel/index.ts';
import { TemplateVersion, type TemplateContent } from '../../src/modules/templates/domain/entities/template-version.ts';
import { Template } from '../../src/modules/templates/domain/entities/template.ts';
import {
  validateLinks,
  validateSchema,
  validateSupportedVariables,
} from '../../src/modules/templates/domain/rules/template-variables.ts';

const at = new Date('2026-09-30T03:00:00Z');
const codes = (issues: readonly { code: string }[]) => issues.map((i) => i.code);

const valid: TemplateContent = {
  subject: '{{ payload.vm_name }} vượt ngưỡng',
  html: '<p>{{ payload.vm_name }} — <a href="https://ews.example.com/vm">Xem</a></p>',
  text: '',
  schema: [{ name: 'payload.vm_name', source: 'payload', required: true }],
};
const draft = (content: Partial<TemplateContent> = {}) =>
  new TemplateVersion({
    id: TemplateVersionId.create(),
    templateId: TemplateId.create(),
    version: 1,
    ...valid,
    ...content,
    createdAt: at,
  });

describe('link trong thư — chỉ https:// và mailto:', () => {
  it('chấp nhận https, mailto và link là biến (kiểm lại lúc gửi)', () => {
    expect(
      validateLinks('<a href="https://a.vn">a</a><a href=\'mailto:x@a.vn\'>b</a><a href="{{ payload.action_url }}">c</a>'),
    ).toEqual([]);
  });

  it.each(['javascript:alert(1)', 'http://a.vn', 'data:text/html,x', '/relative', '#top'])('chặn %s', (href) => {
    expect(codes(validateLinks(`<a href="${href}">x</a>`))).toEqual(['LINK_SCHEME_NOT_ALLOWED']);
  });

  it('bắt được cả href không ngoặc và viết hoa', () => {
    expect(codes(validateLinks('<A HREF=javascript:x>y</A>'))).toEqual(['LINK_SCHEME_NOT_ALLOWED']);
  });
});

describe('schema biến', () => {
  it('payload.<key> một cấp; trùng tên, lệch nguồn đều bị bắt', () => {
    expect(validateSchema([{ name: 'payload.vm_name', source: 'payload', required: true }])).toEqual([]);
    expect(codes(validateSchema([{ name: 'payload.order.id', source: 'payload', required: true }]))).toEqual([
      'INVALID_VARIABLE_NAME',
    ]);
    expect(codes(validateSchema([{ name: 'user.external_id', source: 'payload', required: true }]))).toEqual([
      'VARIABLE_SOURCE_MISMATCH',
    ]);
    expect(
      codes(
        validateSchema([
          { name: 'payload.a', source: 'payload', required: true },
          { name: 'payload.a', source: 'payload', required: false },
        ]),
      ),
    ).toEqual(['DUPLICATE_VARIABLE']);
  });

  // user.tags chưa có đường ghi — lọt qua publish là thư gửi đi trống đúng chỗ đó.
  it('user.* chỉ nhận user.external_id; user.tags.* bị chặn cả trong schema lẫn nội dung', () => {
    expect(validateSchema([{ name: 'user.external_id', source: 'user', required: true }])).toEqual([]);
    expect(codes(validateSchema([{ name: 'user.tags.first_name', source: 'user', required: false }]))).toEqual([
      'USER_VARIABLE_NOT_SUPPORTED',
    ]);
    expect(codes(validateSupportedVariables('Chào {{ user.tags.first_name | default: "bạn" }}'))).toEqual([
      'USER_VARIABLE_NOT_SUPPORTED',
    ]);
  });
});

describe('TemplateVersion — nháp lỏng, xuất bản chặt', () => {
  it('nháp còn lỗi vẫn lưu được; xuất bản thì 422 kèm đủ lỗi, không đổi trạng thái', () => {
    const v = draft({ subject: '', html: '<a href="http://x.vn">{{ vm_name }}</a>' });
    expect(() => v.publish(at, 'admin-1')).toThrow(expect.objectContaining({ code: 'VALIDATION' }));
    expect(codes(v.validate()).sort()).toEqual(['LINK_SCHEME_NOT_ALLOWED', 'SUBJECT_REQUIRED', 'VARIABLE_MISSING_SOURCE']);
    expect(v.status).toBe('draft');
  });

  it('một biến sai dùng ở cả subject lẫn html chỉ báo một lần', () => {
    const v = draft({ subject: '{{ payload.x }}', html: '<p>{{ payload.x }}</p>' });
    expect(codes(v.validate())).toEqual(['VARIABLE_NOT_IN_SCHEMA']);
  });

  it('xuất bản ghi người + thời điểm; bản đã xuất bản không sửa được', () => {
    const v = draft();
    v.publish(at, 'admin-1');
    expect(v).toMatchObject({ status: 'published', publishedBy: 'admin-1', publishedAt: at });
    expect(() => v.edit(valid, at)).toThrow(expect.objectContaining({ code: 'VERSION_NOT_DRAFT' }));
  });

  it('bản đã bị thay thế không xuất bản lại được — phải tạo nháp mới', () => {
    const v = draft();
    v.publish(at, 'admin-1');
    v.supersede(at);
    expect(() => v.publish(at, 'admin-1')).toThrow(expect.objectContaining({ code: 'VALIDATION' }));
  });
});

describe('Template', () => {
  const template = () =>
    new Template({ id: TemplateId.create(), appId: AppId.create(), name: '  Cảnh báo VM  ', channel: 'email', createdAt: at });

  it('cắt khoảng trắng tên; tên rỗng -> TEMPLATE_NAME_REQUIRED', () => {
    expect(template().name).toBe('Cảnh báo VM');
    expect(() => template().rename('   ', at)).toThrow(expect.objectContaining({ issues: [expect.objectContaining({ code: 'TEMPLATE_NAME_REQUIRED' })] }));
  });

  it('đã lưu trữ thì không đổi tên được; lưu trữ lần hai không làm gì', () => {
    const t = template();
    t.archive(at);
    t.archive(new Date('2027-01-01T00:00:00Z'));
    expect(t.updatedAt).toEqual(at);
    expect(() => t.rename('Khác', at)).toThrow(expect.objectContaining({ code: 'TEMPLATE_ARCHIVED' }));
  });
});
