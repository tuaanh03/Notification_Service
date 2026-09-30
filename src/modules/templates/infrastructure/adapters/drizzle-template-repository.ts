import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { duplicateKeyName, type TransactionContext } from '../../../../shared/db/index.ts';
import {
  AppId,
  ConcurrentTransitionError,
  ConflictError,
  TemplateId,
  TemplateVersionId,
  type AppId as AppIdType,
  type TemplateId as TemplateIdType,
  type TemplateVersionStatus,
} from '../../../../shared/kernel/index.ts';
import type { TemplateRepository } from '../../application/ports/index.ts';
import { TemplateVersion } from '../../domain/entities/template-version.ts';
import { Template } from '../../domain/entities/template.ts';
import { templates, templateVersions } from '../db/schema.ts';

type TemplateRow = typeof templates.$inferSelect;
type VersionRow = typeof templateVersions.$inferSelect;
type WriteResult = [{ affectedRows: number }, unknown];

export class DrizzleTemplateRepository implements TemplateRepository {
  private readonly transactions: TransactionContext;

  constructor(deps: { transactions: TransactionContext }) {
    this.transactions = deps.transactions;
  }

  async lockForUpdate(appId: AppIdType, id: TemplateIdType): Promise<boolean> {
    // Không dùng lockParentRow: phải lọc thêm theo app để app này không khoá được template của app khác.
    const rows = await this.transactions
      .require('TemplateRepository.lockForUpdate')
      .select({ id: templates.templateId })
      .from(templates)
      .where(and(eq(templates.templateId, id), eq(templates.appId, appId)))
      .for('update');
    return rows.length > 0;
  }

  async findById(appId: AppIdType, id: TemplateIdType): Promise<Template | null> {
    const [row] = await this.transactions
      .executor()
      .select()
      .from(templates)
      .where(and(eq(templates.templateId, id), eq(templates.appId, appId)));
    return row ? toTemplate(row) : null;
  }

  async listByApp(appId: AppIdType): Promise<Template[]> {
    const rows = await this.transactions
      .executor()
      .select()
      .from(templates)
      .where(eq(templates.appId, appId))
      .orderBy(asc(templates.name));
    return rows.map(toTemplate);
  }

  async insert(template: Template): Promise<void> {
    await this.withNameConflict(template, () =>
      this.transactions.executor().insert(templates).values({
        templateId: template.id,
        appId: template.appId,
        name: template.name,
        channel: template.channel,
        status: template.status,
        createdAt: template.createdAt,
        updatedAt: template.updatedAt,
      }),
    );
  }

  async update(template: Template): Promise<void> {
    await this.withNameConflict(template, () =>
      this.transactions
        .executor()
        .update(templates)
        .set({ name: template.name, status: template.status, updatedAt: template.updatedAt })
        .where(eq(templates.templateId, template.id)),
    );
  }

  async versionsOf(templateId: TemplateIdType): Promise<TemplateVersion[]> {
    const rows = await this.transactions
      .executor()
      .select()
      .from(templateVersions)
      .where(eq(templateVersions.templateId, templateId))
      .orderBy(desc(templateVersions.version));
    return rows.map(toVersion);
  }

  async currentVersionsOf(templateIds: readonly TemplateIdType[]): Promise<TemplateVersion[]> {
    if (templateIds.length === 0) return [];
    const rows = await this.transactions
      .executor()
      .select()
      .from(templateVersions)
      .where(
        and(
          inArray(templateVersions.templateId, [...templateIds]),
          inArray(templateVersions.status, ['draft', 'published']),
        ),
      );
    return rows.map(toVersion);
  }

  async insertVersion(version: TemplateVersion): Promise<void> {
    await this.transactions
      .executor()
      .insert(templateVersions)
      .values({
        templateVersionId: version.id,
        templateId: version.templateId,
        version: version.version,
        status: version.status,
        ...contentColumns(version),
        aiGenerated: version.aiGenerated,
        createdBy: version.createdBy,
        publishedBy: version.publishedBy,
        publishedAt: version.publishedAt,
        createdAt: version.createdAt,
        updatedAt: version.updatedAt,
      });
  }

  async updateVersion(version: TemplateVersion, expectedStatus: TemplateVersionStatus): Promise<void> {
    const [result] = (await this.transactions
      .executor()
      .update(templateVersions)
      .set({
        status: version.status,
        ...contentColumns(version),
        publishedBy: version.publishedBy,
        publishedAt: version.publishedAt,
        updatedAt: version.updatedAt,
      })
      .where(
        and(eq(templateVersions.templateVersionId, version.id), eq(templateVersions.status, expectedStatus)),
      )) as unknown as WriteResult;
    if (result.affectedRows === 0) throw new ConcurrentTransitionError('TemplateVersion', version.id, expectedStatus);
  }

  private async withNameConflict(template: Template, write: () => Promise<unknown>): Promise<void> {
    try {
      await write();
    } catch (err) {
      if (duplicateKeyName(err) === 'uq_templates_app_name') {
        throw new ConflictError('TEMPLATE_NAME_TAKEN', `template name "${template.name}" is already used in this app`);
      }
      throw err;
    }
  }
}

const contentColumns = (v: TemplateVersion) => ({
  subject: v.subject,
  html: v.html,
  text: v.text,
  schema: [...v.schema],
});

function toTemplate(row: TemplateRow): Template {
  return new Template({
    id: TemplateId.parse(row.templateId),
    appId: AppId.parse(row.appId),
    name: row.name,
    channel: row.channel,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

function toVersion(row: VersionRow): TemplateVersion {
  return new TemplateVersion({
    id: TemplateVersionId.parse(row.templateVersionId),
    templateId: TemplateId.parse(row.templateId),
    version: row.version,
    status: row.status,
    subject: row.subject,
    html: row.html,
    text: row.text,
    schema: row.schema,
    aiGenerated: row.aiGenerated,
    createdBy: row.createdBy,
    publishedBy: row.publishedBy,
    publishedAt: row.publishedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}
