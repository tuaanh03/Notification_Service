/**
 * Lỗi của domain: ném ra khi vi phạm invariant.
 * Ở biên service, application bắt lại và chuyển thành Result.fail — xem result.ts.
 */
export class DomainError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = new.target.name;
    this.code = code;
  }
}

export class InvalidIdError extends DomainError {
  constructor(kind: string, value: string) {
    super('INVALID_ID', `${kind} không phải UUID hợp lệ: ${value}`);
  }
}

export class ValidationError extends DomainError {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super('VALIDATION', issues.join('; '));
    this.issues = issues;
  }
}

/**
 * Nối một bản ghi sang org khác — thứ mà composite FK trong DB chặn ở tầng cuối.
 * Domain chặn trước, để lỗi lộ ra ở unit test thay vì ở production.
 */
export class CrossOrgViolationError extends DomainError {
  constructor(what: string, expectedOrg: string, actualOrg: string) {
    super('CROSS_ORG', `${what} thuộc org ${actualOrg}, không phải ${expectedOrg}`);
  }
}

/** Chuyển trạng thái không có trong bảng transitions. */
export class InvalidTransitionError extends DomainError {
  constructor(aggregate: string, from: string, event: string) {
    super('INVALID_TRANSITION', `${aggregate}: không có đường ${from} --${event}-->`);
  }
}

/** Trạng thái trong DB đã khác lúc đọc — bên kia thắng race. */
export class ConcurrentTransitionError extends DomainError {
  constructor(aggregate: string, id: string, expected: string) {
    super('CONCURRENT_TRANSITION', `${aggregate} ${id} không còn ở trạng thái ${expected}`);
  }
}
