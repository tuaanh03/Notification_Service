import type { AppId } from '../../../../shared/kernel/index.ts';
import type { OpenTrackingDto } from '../dto.ts';
import type { OpenTrackingConfig, OpenTrackingSigner } from '../ports/index.ts';

/**
 * Trạng thái đếm "đã mở" của một app cho console (ADR-0031): cờ của app + server đủ điều kiện chèn ảnh
 * chưa (khoá ký + domain công khai). Cùng điều kiện worker dùng, để màn hình không nói khác thực tế.
 */
export class GetOpenTracking {
  private readonly deps: { tracking: OpenTrackingConfig; signer: OpenTrackingSigner };

  constructor(deps: GetOpenTracking['deps']) {
    this.deps = deps;
  }

  async execute(input: { appId: AppId }): Promise<OpenTrackingDto> {
    const { enabled, publicBaseUrl } = await this.deps.tracking.forApp(input.appId);
    return { enabled, ready: this.deps.signer.configured && publicBaseUrl !== null };
  }
}
