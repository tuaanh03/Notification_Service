import type { TemplateVersionId } from '../../../../shared/kernel/index.ts';
import type { NotificationRepository, PublicationRepository } from '../ports/index.ts';

/**
 * Các version template này đã được gửi / phát bao nhiêu lần (mọi app, mọi trạng thái) — query công khai cho
 * lệnh dọn template của admin-cli (ADR-0037): còn thư / lần phát trỏ tới thì không xoá (lịch sử gửi giữ nguyên).
 */
export class CountTemplateUsage {
  private readonly deps: { notifications: NotificationRepository; publications: PublicationRepository };

  constructor(deps: CountTemplateUsage['deps']) {
    this.deps = deps;
  }

  async execute(versionIds: readonly TemplateVersionId[]): Promise<{ notifications: number; publications: number }> {
    const [notifications, publications] = await Promise.all([
      this.deps.notifications.countByTemplateVersions(versionIds),
      this.deps.publications.countByTemplateVersions(versionIds),
    ]);
    return { notifications, publications };
  }
}
