import type { AdminId, PersonalAccessTokenId } from '../../../../shared/kernel/index.ts';
import type { PersonalAccessToken } from '../../domain/entities/personal-access-token.ts';

/** Kho personal access token (ADR-0044). */
export interface PersonalAccessTokenRepository {
  insert(token: PersonalAccessToken): Promise<void>;
  /** Tra theo BĂM — chạy ở mọi request `/admin` mang PAT, một dòng theo unique index. */
  findByTokenHash(tokenHash: string): Promise<PersonalAccessToken | null>;
  findById(id: PersonalAccessTokenId): Promise<PersonalAccessToken | null>;
  /** Token của một người, mới nhất trước; token đã thu hồi / hết hạn trước `since` bị bỏ khỏi danh sách. */
  listByAdmin(adminId: AdminId, since: Date): Promise<PersonalAccessToken[]>;
  /** Mọi token, mới nhất trước. `activeAt` = chỉ token còn hiệu lực ở thời điểm đó; `since` như `listByAdmin`. */
  listAll(filter: { activeAt?: Date | undefined; since: Date; limit: number }): Promise<PersonalAccessToken[]>;
  /** Số token còn hiệu lực của một người — gọi SAU khi khoá dòng admin (ADR-0009). */
  countActive(adminId: AdminId, at: Date): Promise<number>;
  /** Chỉ ghi `revoked_at` + `updated_at`. */
  updateRevoked(token: PersonalAccessToken): Promise<void>;
  /** Chỉ ghi `last_used_at` + `last_used_ip` (không đổi `updated_at` — dùng không phải sửa). */
  updateLastUsed(token: PersonalAccessToken): Promise<void>;
}

/** Token PAT vừa sinh: bản gốc trả một lần, băm + đoạn gợi nhớ để lưu. */
export interface IssuedPersonalAccessToken {
  token: string;
  hash: string;
  hint: string;
}

/** Sinh / băm PAT. Là PORT vì application không được chạm `node:crypto`. */
export interface PersonalAccessTokenFactory {
  /** Tiền tố nhận dạng PAT — xác thực `/admin` rẽ nhánh theo nó. */
  readonly prefix: string;
  create(): IssuedPersonalAccessToken;
  hashOf(token: string): string;
}

/** Giới hạn PAT đang hiệu lực — đọc từ cài đặt hệ thống `pat.*` (module settings), đệm ngắn. */
export interface PersonalAccessTokenPolicySource {
  current(): Promise<{ maxPerAdmin: number; maxLifetimeDays: number }>;
}
