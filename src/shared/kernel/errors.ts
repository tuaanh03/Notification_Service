/**
 * Lỗi của domain: ném ra khi vi phạm invariant.
 * Ở biên service, application bắt lại và chuyển thành Result.fail — xem result.ts.
 *
 * Quy ước: `code` là hợp đồng ổn định (test, frontend, problem+json map theo nó);
 * `message` viết tiếng Anh, chỉ dành cho log và dev — không ai được so khớp theo chữ.
 */
export class DomainError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = new.target.name;
    this.code = code;
  }
}

/** Một vi phạm cụ thể. `path` trỏ tới field gây lỗi, để frontend biết ô nào sai. */
export interface Issue {
  readonly code: string;
  readonly message: string;
  readonly path?: string | undefined;
}

export function issue(code: string, message: string, path?: string): Issue {
  return path === undefined ? { code, message } : { code, message, path };
}

export class InvalidIdError extends DomainError {
  constructor(kind: string, value: string) {
    super('INVALID_ID', `${kind} is not a valid UUID: ${value}`);
  }
}

export class ValidationError extends DomainError {
  readonly issues: readonly Issue[];

  constructor(issues: readonly Issue[]) {
    super('VALIDATION', issues.map((i) => i.message).join('; '));
    this.issues = issues;
  }

  /** Tiện dụng cho trường hợp chỉ có một vi phạm. */
  static of(code: string, message: string, path?: string): ValidationError {
    return new ValidationError([issue(code, message, path)]);
  }
}

/**
 * Nối một bản ghi sang org khác — thứ mà composite FK trong DB chặn ở tầng cuối.
 * Domain chặn trước, để lỗi lộ ra ở unit test thay vì ở production.
 */
export class CrossOrgViolationError extends DomainError {
  constructor(what: string, expectedOrg: string, actualOrg: string) {
    super('CROSS_ORG', `${what} belongs to org ${actualOrg}, not ${expectedOrg}`);
  }
}

/** Cùng loại với CrossOrgViolationError nhưng ở tầng account (RBAC) — xem ADR-0011. */
export class CrossAccountViolationError extends DomainError {
  constructor(what: string, expectedAccount: string, actualAccount: string) {
    super('CROSS_ACCOUNT', `${what} belongs to account ${actualAccount}, not ${expectedAccount}`);
  }
}

/** Chuyển trạng thái không có trong bảng transitions. */
export class InvalidTransitionError extends DomainError {
  constructor(aggregate: string, from: string, event: string) {
    super('INVALID_TRANSITION', `${aggregate}: no transition ${from} --${event}-->`);
  }
}

/** Trạng thái trong DB đã khác lúc đọc — bên kia thắng race. */
export class ConcurrentTransitionError extends DomainError {
  constructor(aggregate: string, id: string, expected: string) {
    super('CONCURRENT_TRANSITION', `${aggregate} ${id} is no longer in status ${expected}`);
  }
}
