/**
 * Service trả Result thay vì throw. Dạng union (không phải class) để TypeScript
 * narrow được `value` / `error` sau khi kiểm tra `isSuccess`.
 */
export interface Failure {
  readonly code: string;
  readonly message: string;
  readonly details?: unknown;
}

export interface Ok<T> {
  readonly isSuccess: true;
  readonly value: T;
}

export interface Fail<E> {
  readonly isSuccess: false;
  readonly error: E;
}

export type Result<T, E = Failure> = Ok<T> | Fail<E>;

export function ok<T>(value: T): Ok<T> {
  return { isSuccess: true, value };
}

export function fail<E = Failure>(error: E): Fail<E> {
  return { isSuccess: false, error };
}

export function isOk<T, E>(result: Result<T, E>): result is Ok<T> {
  return result.isSuccess;
}

export function isFail<T, E>(result: Result<T, E>): result is Fail<E> {
  return !result.isSuccess;
}

export function match<T, E, R>(
  result: Result<T, E>,
  handlers: { ok: (value: T) => R; fail: (error: E) => R },
): R {
  return result.isSuccess ? handlers.ok(result.value) : handlers.fail(result.error);
}
