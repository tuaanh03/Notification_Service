import { BaseEntity, type AdminId, type PatScope, type PersonalAccessTokenId, type TimestampInput } from '../../../../shared/kernel/index.ts';

export type PersonalAccessTokenStatus = 'active' | 'expired' | 'revoked';

export interface PersonalAccessTokenProps extends TimestampInput {
  id: PersonalAccessTokenId;
  adminId: AdminId;
  name: string;
  /** BĂM của token (sha256 hex) — token gốc không bao giờ vào DB. */
  tokenHash: string;
  hint: string;
  scope: PatScope;
  expiresAt: Date;
  lastUsedAt?: Date | null | undefined;
  lastUsedIp?: string | null | undefined;
  revokedAt?: Date | null | undefined;
}

/** Ghi "dùng lần cuối" tối đa mỗi chừng này — mỗi request `/admin` mà ghi DB thì PAT thành đường chậm nhất. */
const TOUCH_INTERVAL_MS = 60_000;

/**
 * Personal access token (ADR-0044). Không có quyền riêng: request mang PAT chạy với ĐÚNG vai của admin tạo
 * ra nó (RBAC ADR-0022), `scope` chỉ chặn thêm lệnh ghi. Hết hạn bắt buộc; thu hồi là trạng thái kết thúc.
 */
export class PersonalAccessToken extends BaseEntity<PersonalAccessTokenId> {
  readonly adminId: AdminId;
  readonly name: string;
  readonly tokenHash: string;
  readonly hint: string;
  readonly scope: PatScope;
  readonly expiresAt: Date;
  private mutableLastUsedAt: Date | null;
  private mutableLastUsedIp: string | null;
  private mutableRevokedAt: Date | null;

  constructor(props: PersonalAccessTokenProps) {
    super(props.id, props);
    this.adminId = props.adminId;
    this.name = props.name;
    this.tokenHash = props.tokenHash;
    this.hint = props.hint;
    this.scope = props.scope;
    this.expiresAt = props.expiresAt;
    this.mutableLastUsedAt = props.lastUsedAt ?? null;
    this.mutableLastUsedIp = props.lastUsedIp ?? null;
    this.mutableRevokedAt = props.revokedAt ?? null;
  }

  get lastUsedAt(): Date | null {
    return this.mutableLastUsedAt;
  }

  get lastUsedIp(): string | null {
    return this.mutableLastUsedIp;
  }

  get revokedAt(): Date | null {
    return this.mutableRevokedAt;
  }

  /** Thu hồi thắng hết hạn: token đã thu hồi luôn là `revoked`, kể cả khi sau đó nó cũng quá hạn. */
  statusAt(at: Date): PersonalAccessTokenStatus {
    if (this.mutableRevokedAt !== null) return 'revoked';
    return this.expiresAt.getTime() <= at.getTime() ? 'expired' : 'active';
  }

  isUsableAt(at: Date): boolean {
    return this.statusAt(at) === 'active';
  }

  /** `false` = đã thu hồi từ trước (lặp lại an toàn, không ghi thêm event). */
  revoke(at: Date): boolean {
    if (this.mutableRevokedAt !== null) return false;
    this.mutableRevokedAt = at;
    this.touch(at);
    return true;
  }

  /** `true` = lần dùng này đáng ghi xuống DB (lần đầu, đổi IP, hoặc đã quá một phút từ lần ghi trước). */
  recordUse(at: Date, ip: string | null): boolean {
    const last = this.mutableLastUsedAt;
    const due = last === null || at.getTime() - last.getTime() >= TOUCH_INTERVAL_MS || ip !== this.mutableLastUsedIp;
    if (!due) return false;
    this.mutableLastUsedAt = at;
    this.mutableLastUsedIp = ip;
    return true;
  }
}
