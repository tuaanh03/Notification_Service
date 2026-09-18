import {
  AuthenticationError,
  ConcurrentTransitionError,
  ConflictError,
  CrossAccountViolationError,
  CrossOrgViolationError,
  DomainError,
  InvalidIdError,
  InvalidTransitionError,
  NotFoundError,
  PermissionDeniedError,
  ValidationError,
  type Issue,
} from '../kernel/errors.ts';

/**
 * Body lỗi theo RFC 9457 (`application/problem+json`). `code` là hợp đồng với frontend —
 * cùng `code` với `DomainError`/`Issue`, frontend map sang câu tiếng Việt theo nó.
 */
export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  code: string;
  detail: string;
  issues?: readonly Issue[];
  instance?: string;
}

export const PROBLEM_CONTENT_TYPE = 'application/problem+json; charset=utf-8';

const HTTP_TITLES: Readonly<Record<number, string>> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  409: 'Conflict',
  413: 'Payload Too Large',
  415: 'Unsupported Media Type',
  422: 'Unprocessable Content',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
  503: 'Service Unavailable',
};

/** Lỗi của domain -> HTTP status. Thứ tự quan trọng: lớp con trước lớp cha. */
function statusOfDomainError(err: DomainError): number {
  if (err instanceof InvalidIdError) return 400;
  if (err instanceof AuthenticationError) return 401;
  if (err instanceof PermissionDeniedError) return 403;
  if (err instanceof CrossOrgViolationError || err instanceof CrossAccountViolationError) return 403;
  if (err instanceof NotFoundError) return 404;
  if (err instanceof ConflictError) return 409;
  if (err instanceof InvalidTransitionError || err instanceof ConcurrentTransitionError) return 409;
  return 422; // ValidationError và mọi invariant khác: request đúng cú pháp nhưng vi phạm nghiệp vụ
}

/** Lỗi do Fastify ném (JSON hỏng, body quá lớn...) mang sẵn `statusCode` 4xx. */
function httpStatusOf(err: unknown): number | null {
  if (typeof err !== 'object' || err === null || !('statusCode' in err)) return null;
  const status = Number(err.statusCode);
  return status >= 400 && status < 500 ? status : null;
}

export function problem(status: number, code: string, detail: string, extra: Partial<ProblemDetails> = {}): ProblemDetails {
  return {
    type: `urn:ews:problem:${code.toLowerCase()}`,
    title: HTTP_TITLES[status] ?? 'Error',
    status,
    code,
    detail,
    ...extra,
  };
}

/**
 * Mọi lỗi -> ProblemDetails. Lỗi không nhận ra -> 500 với câu chung chung: chi tiết lỗi nội bộ
 * (SQL, stack) chỉ vào log, KHÔNG bao giờ vào response.
 */
export function toProblem(err: unknown, instance?: string): ProblemDetails {
  const at = instance === undefined ? {} : { instance };
  if (err instanceof ValidationError) {
    return problem(422, err.code, err.message, { issues: err.issues, ...at });
  }
  if (err instanceof DomainError) {
    return problem(statusOfDomainError(err), err.code, err.message, at);
  }
  const httpStatus = httpStatusOf(err);
  if (httpStatus !== null) {
    const detail = err instanceof Error ? err.message : 'invalid request';
    // Mã riêng của ta (MALFORMED_JSON) giữ nguyên; mã nội bộ của Fastify (FST_ERR_...) không lộ ra.
    const own = typeof err === 'object' && err !== null && 'code' in err ? String(err.code) : '';
    const code = /^[A-Z][A-Z_]+$/.test(own) && !own.startsWith('FST_') ? own : `HTTP_${httpStatus}`;
    return problem(httpStatus, code, detail, at);
  }
  return problem(500, 'INTERNAL', 'internal server error', at);
}
