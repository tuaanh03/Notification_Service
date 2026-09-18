import { describe, expect, it } from 'vitest';
import {
  missingRequiredPayloadKeys,
  unresolvedVariables,
  validateBody,
  type VariableSpec,
} from '../../src/modules/templates/domain/template-variables.ts';

const schema: VariableSpec[] = [
  { name: 'payload.order_number', source: 'payload', required: true },
  { name: 'user.tags.first_name', source: 'user', required: false },
];

describe('biến template — hai nguồn, một cú pháp', () => {
  it('chấp nhận biến có prefix payload. và user.', () => {
    const body = 'Đơn {{ payload.order_number }} của {{ user.tags.first_name | default: "quý khách" }}';
    expect(validateBody(body, schema)).toEqual([]);
  });

  // Lỗi khó thấy nhất: cú pháp ngắn trỏ sang nguồn khác và render ra rỗng.
  it('từ chối cú pháp ngắn {{ order_number }}', () => {
    const issues = validateBody('Đơn {{ order_number }}', schema);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain('chưa khai nguồn');
  });

  it('từ chối biến không có trong schema của version', () => {
    const issues = validateBody('{{ payload.secret_code }}', schema);
    expect(issues[0]).toContain('không có trong schema');
  });

  it('biến không bắt buộc phải có | default:', () => {
    const issues = validateBody('{{ user.tags.first_name }}', schema);
    expect(issues[0]).toContain('| default:');
  });

  it('template không được tự viết footer hay link unsubscribe', () => {
    expect(validateBody('{{ footer }}', schema).join(' ')).toContain('footer');
    expect(validateBody('<a href="/unsubscribe">Huỷ</a>', schema).join(' ')).toContain('unsubscribe');
  });

  it('biến còn sót sau render bị bắt lại trước khi thư đi', () => {
    expect(unresolvedVariables('Xin chào {{ user.tags.first_name }}')).toEqual([
      'user.tags.first_name',
    ]);
    expect(unresolvedVariables('Xin chào Minh')).toEqual([]);
  });

  it('nhận gửi: thiếu biến required trong payload thì 422', () => {
    expect(missingRequiredPayloadKeys({}, schema)).toEqual(['order_number']);
    expect(missingRequiredPayloadKeys({ order_number: 'OS10527' }, schema)).toEqual([]);
  });
});
