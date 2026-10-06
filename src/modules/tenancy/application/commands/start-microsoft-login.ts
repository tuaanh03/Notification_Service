import { UpstreamError } from '../../../../shared/kernel/index.ts';
import type { MicrosoftIdentity } from '../ports/index.ts';

/** Thông báo chung khi chưa cấu hình `M365_*` — cả hai use case Microsoft dùng. */
export const m365NotConfigured = (): UpstreamError =>
  new UpstreamError('M365_NOT_CONFIGURED', 'Microsoft 365 sign-in is not configured', 503);

/**
 * Bắt đầu đăng nhập Microsoft: trả link sang trang đăng nhập Microsoft + `state` để console buộc lượt
 * này vào trình duyệt đã bấm nút (ADR-0021). Chưa ghi gì vào DB — chưa biết là ai.
 */
export class StartMicrosoftLogin {
  private readonly deps: { identity: MicrosoftIdentity };

  constructor(deps: StartMicrosoftLogin['deps']) {
    this.deps = deps;
  }

  get configured(): boolean {
    return this.deps.identity.configured;
  }

  async execute(): Promise<{ authorizeUrl: string; state: string }> {
    if (!this.deps.identity.configured) throw m365NotConfigured();
    return this.deps.identity.begin();
  }
}
