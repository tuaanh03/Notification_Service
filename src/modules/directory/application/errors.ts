import { ConflictError } from '../../../shared/kernel/index.ts';

/** Hai request tạo cùng một user đua nhau: bên thua nhận lỗi này và thử lại một lần. */
export class UserAlreadyExistsError extends ConflictError {
  constructor(externalId: string) {
    super('USER_ALREADY_EXISTS', `user ${externalId} already exists in this app`);
  }
}
