import { NotFoundError, type AppId } from '../../../../shared/kernel/index.ts';
import { toUserDto, type UserDto } from '../dto.ts';
import type { UserEmailPort, UserRepository } from '../ports/index.ts';

/**
 * Tra user theo external_id TRONG app đang gọi — cũng là cửa công khai cho module khác (notifications
 * tra người nhận). User của app khác không bao giờ thấy được: tra theo cặp (app, external_id).
 */
export class FindUserByExternalId {
  private readonly deps: { users: UserRepository; emails: UserEmailPort };

  constructor(deps: FindUserByExternalId['deps']) {
    this.deps = deps;
  }

  /** Không có -> null (cho module khác tự quyết). */
  async find(input: { appId: AppId; externalId: string }): Promise<UserDto | null> {
    const user = await this.deps.users.findByExternalId(input.appId, input.externalId);
    if (!user) return null;
    return toUserDto(user, await this.deps.emails.find({ appId: input.appId, userId: user.id }));
  }

  /** Không có -> 404 (cho route). */
  async get(input: { appId: AppId; externalId: string }): Promise<UserDto> {
    const user = await this.find(input);
    if (!user) throw new NotFoundError('user', input.externalId);
    return user;
  }
}
