import { audited, type CommandContext, type EventOutbox, type UnitOfWork } from '../../../../shared/application/index.ts';
import type { TemplateId } from '../../../../shared/kernel/index.ts';
import type { TemplateVersion } from '../../domain/entities/template-version.ts';
import type { Template } from '../../domain/entities/template.ts';
import { TEMPLATE_AGGREGATE, TEMPLATE_EVENTS } from '../events.ts';
import type { TemplateReferences, TemplateRepository, TemplateUsageLookup } from '../ports/index.ts';

/**
 * Một template kiểu kéo-thả và số phận của nó trong lệnh dọn:
 *   `would_delete` — chạy thử, sẽ xoá khi `--apply` · `deleted` — đã xoá · `refused` — không xoá (`reason`).
 */
export interface BlocksTemplateCandidate {
  appId: string;
  templateId: string;
  name: string;
  status: string;
  /** Mọi version của template (không chỉ version kiểu blocks). */
  versions: { version: number; status: string; editor: string }[];
  references: TemplateReferences;
  outcome: 'would_delete' | 'deleted' | 'refused';
  /** `referenced` = còn thư / lần phát / incoming hook trỏ tới · `mixed_editors` = có version kiểu khác blocks. */
  reason: 'referenced' | 'mixed_editors' | null;
}

/**
 * Dọn template kiểu kéo-thả trước khi gỡ `blocks` khỏi ENUM (ADR-0037, migration 0027). CHỈ admin-cli gọi.
 *
 * Mặc định CHẠY THỬ (`apply: false`): chỉ đọc, liệt kê. `apply: true` mới xoá — mỗi template trong MỘT transaction
 * (khoá dòng `templates`, đọc lại version + chỗ dùng, xoá mọi `template_versions` rồi `templates`, ghi audit
 * `TemplatePurged` với `before` = tên / app / version). Từ chối từng template:
 *   - còn notification / publication / incoming hook trỏ tới -> `referenced` (lịch sử gửi không được mất);
 *   - có version kiểu khác `blocks` (vd nháp đã "Chuyển sang HTML") -> `mixed_editors` — xoá là mất bản đang dùng,
 *     người vận hành tự quyết.
 * Template bị từ chối thì migration 0027 sẽ dừng (còn dòng `blocks`) — đó là chủ ý: không có đường âm thầm.
 */
export class PurgeBlocksTemplates {
  private readonly deps: { uow: UnitOfWork; outbox: EventOutbox; templates: TemplateRepository; usage: TemplateUsageLookup };

  constructor(deps: PurgeBlocksTemplates['deps']) {
    this.deps = deps;
  }

  async execute(input: { apply: boolean }, ctx: CommandContext): Promise<BlocksTemplateCandidate[]> {
    const { templates } = this.deps;
    const rows = await templates.versionsByEditor('blocks');
    const unique = new Map<TemplateId, Template>();
    for (const { template } of rows) unique.set(template.id, template);

    const result: BlocksTemplateCandidate[] = [];
    for (const template of unique.values()) {
      const candidate = await this.inspect(template, await templates.versionsOf(template.id));
      if (!input.apply || candidate.reason !== null) {
        result.push(candidate);
        continue;
      }
      result.push(await this.purge(template, ctx));
    }
    return result;
  }

  private async inspect(template: Template, versions: readonly TemplateVersion[]): Promise<BlocksTemplateCandidate> {
    const references = await this.deps.usage.referencesOf(template.id, versions.map((v) => v.id));
    const used = references.notifications + references.publications + references.incomingHooks > 0;
    const mixed = versions.some((v) => v.editor !== 'blocks');
    const reason = used ? 'referenced' : mixed ? 'mixed_editors' : null;
    return {
      appId: template.appId,
      templateId: template.id,
      name: template.name,
      status: template.status,
      versions: versions.map((v) => ({ version: v.version, status: v.status, editor: v.editor })),
      references,
      outcome: reason === null ? 'would_delete' : 'refused',
      reason,
    };
  }

  /** Kiểm lại TRONG transaction sau khi khoá: giữa lần chạy thử và lúc xoá có thể đã có ai gửi bằng nó. */
  private async purge(template: Template, ctx: CommandContext): Promise<BlocksTemplateCandidate> {
    const { uow, outbox, templates } = this.deps;
    return uow.run(async () => {
      await templates.lockForUpdate(template.appId, template.id);
      const candidate = await this.inspect(template, await templates.versionsOf(template.id));
      if (candidate.reason !== null) return candidate;
      await templates.deleteWithVersions(template.id);
      await outbox.append([
        {
          aggregateType: TEMPLATE_AGGREGATE,
          aggregateId: template.id,
          eventType: TEMPLATE_EVENTS.purged,
          payload: audited(ctx, {
            before: { appId: template.appId, name: template.name, category: template.category, versions: candidate.versions },
            after: { purgedBlocksEditor: true },
          }),
        },
      ]);
      return { ...candidate, outcome: 'deleted' };
    });
  }
}
