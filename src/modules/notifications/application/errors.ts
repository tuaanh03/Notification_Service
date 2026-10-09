import { ConflictError } from '../../../shared/kernel/index.ts';

/** Hai lần phát cùng `idempotencyKey` đua nhau: bên thua trả lại lần phát của bên thắng (ADR-0028). */
export class PublicationKeyTakenError extends ConflictError {
  constructor(key: string) {
    super('IDEMPOTENCY_KEY_TAKEN', `idempotency key ${key} is already used by a publication in this app`);
  }
}

/** Hai request cùng `idempotencyKey` đua nhau: bên thua trả lại notification của bên thắng. */
export class IdempotencyKeyTakenError extends ConflictError {
  constructor(key: string) {
    super('IDEMPOTENCY_KEY_TAKEN', `idempotency key ${key} is already used in this app`);
  }
}
