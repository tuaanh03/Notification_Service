import { NotFoundError, type AppId, type UserId } from '../../../../shared/kernel/index.ts';
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

  /**
   * `external_id` của nhiều user trong MỘT truy vấn — cho màn danh sách của module khác (lịch sử gửi).
   * Chỉ trả mã, không kèm email: phía gọi cần biết "ai", không cần địa chỉ. User không còn hoặc
   * không có `external_id` thì vắng mặt trong Map.
   */
  async externalIdsOf(input: { appId: AppId; userIds: readonly UserId[] }): Promise<Map<UserId, string>> {
    const users = await this.deps.users.findManyByIds(input.appId, input.userIds);
    return new Map(users.flatMap((user) => (user.externalId === null ? [] : [[user.id, user.externalId] as const])));
  }

  /** Tổng số người nhận của app — cho màn Tổng quan của module khác. */
  countOf(input: { appId: AppId }): Promise<number> {
    return this.deps.users.countByApp(input.appId);
  }

  /** Không có -> 404 (cho route). */
  async get(input: { appId: AppId; externalId: string }): Promise<UserDto> {
    const user = await this.find(input);
    if (!user) throw new NotFoundError('user', input.externalId);
    return user;
  }
}
