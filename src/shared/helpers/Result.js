/**
 * Result pattern: service trả về Result thay vì throw.
 *   Result.ok(value)     -> { isSuccess: true,  value }
 *   Result.fail(error)   -> { isSuccess: false, error }
 */
export class Result {
  #value;
  #error;

  constructor(isSuccess, value, error) {
    this.isSuccess = isSuccess;
    this.#value = value;
    this.#error = error;
    Object.freeze(this);
  }

  get isFailure() {
    return !this.isSuccess;
  }

  get value() {
    if (!this.isSuccess) throw new Error('Cannot get value of a failed Result');
    return this.#value;
  }

  get error() {
    return this.#error;
  }

  static ok(value) {
    return new Result(true, value, null);
  }

  static fail(error) {
    return new Result(false, null, error);
  }

  match({ ok, fail }) {
    return this.isSuccess ? ok(this.#value) : fail(this.#error);
  }
}
