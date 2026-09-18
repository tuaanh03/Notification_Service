import { createHash, timingSafeEqual } from 'node:crypto';
import { AuthenticationError } from '../kernel/index.ts';
import type { AdminAuthenticator, AdminCaller } from './auth.ts';

/**
 * TẠM THỜI: một token quản trị duy nhất từ env `ADMIN_TOKEN`, cho tới khi có đăng nhập admin
 * (session) + RBAC theo `admin_app_roles`. Mọi thao tác được audit với actor `bootstrap-admin`.
 *
 * Không cấu hình token -> MỌI request `/admin/*` bị từ chối (đóng mặc định), không phải mở toang.
 */
export class BootstrapAdminAuthenticator implements AdminAuthenticator {
  private readonly tokenDigest: Buffer | null;

  constructor(options: { token: string | undefined }) {
    this.tokenDigest = options.token ? digest(options.token) : null;
  }

  get enabled(): boolean {
    return this.tokenDigest !== null;
  }

  async authenticate(input: { bearerToken: string | null }): Promise<AdminCaller> {
    if (this.tokenDigest === null) {
      throw new AuthenticationError('ADMIN_AUTH_DISABLED', 'admin API is disabled: ADMIN_TOKEN is not configured');
    }
    // So sánh digest độ dài cố định bằng timingSafeEqual: không lộ token qua thời gian phản hồi.
    if (input.bearerToken === null || !timingSafeEqual(digest(input.bearerToken), this.tokenDigest)) {
      throw new AuthenticationError('INVALID_ADMIN_TOKEN', 'invalid admin token');
    }
    return { kind: 'admin', adminId: 'bootstrap-admin', role: 'super_admin' };
  }
}

function digest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}
