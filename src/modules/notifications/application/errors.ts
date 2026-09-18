import { ConflictError } from '../../../shared/kernel/index.ts';

/** Hai request cùng `idempotencyKey` đua nhau: bên thua trả lại notification của bên thắng. */
export class IdempotencyKeyTakenError extends ConflictError {
  constructor(key: string) {
    super('IDEMPOTENCY_KEY_TAKEN', `idempotency key ${key} is already used in this app`);
  }
}
