import { and, eq } from 'drizzle-orm';
import { duplicateKeyName, type TransactionContext } from '../../../../shared/db/index.ts';
import {
  AppId,
  PublicationId,
  TemplateVersionId,
  TopicId,
  type AppId as AppIdType,
  type PublicationId as PublicationIdType,
} from '../../../../shared/kernel/index.ts';
import { PublicationKeyTakenError } from '../../application/errors.ts';
import type { PublicationRepository } from '../../application/ports/index.ts';
import { Publication } from '../../domain/entities/publication.ts';
import { publications } from '../db/schema.ts';

type Row = typeof publications.$inferSelect;

export class DrizzlePublicationRepository implements PublicationRepository {
  private readonly transactions: TransactionContext;

  constructor(deps: { transactions: TransactionContext }) {
    this.transactions = deps.transactions;
  }

  async insert(p: Publication): Promise<void> {
    try {
      await this.transactions.executor().insert(publications).values({
        publicationId: p.id,
        appId: p.appId,
        topicId: p.topicId,
        idempotencyKey: p.idempotencyKey,
        recipientCount: p.recipientCount,
        templateVersionId: p.templateVersionId,
        createdBy: p.createdBy,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
      });
    } catch (err) {
      if (duplicateKeyName(err) === 'uq_publications_app_idempotency') throw new PublicationKeyTakenError(p.idempotencyKey);
      throw err;
    }
  }

  async findById(id: PublicationIdType): Promise<Publication | null> {
    const [row] = await this.transactions.executor().select().from(publications).where(eq(publications.publicationId, id));
    return row ? toPublication(row) : null;
  }

  async findByIdempotencyKey(appId: AppIdType, key: string): Promise<Publication | null> {
    const [row] = await this.transactions
      .executor()
      .select()
      .from(publications)
      .where(and(eq(publications.appId, appId), eq(publications.idempotencyKey, key)));
    return row ? toPublication(row) : null;
  }
}

function toPublication(row: Row): Publication {
  return new Publication({
    id: PublicationId.parse(row.publicationId),
    appId: AppId.parse(row.appId),
    topicId: TopicId.parse(row.topicId),
    idempotencyKey: row.idempotencyKey,
    recipientCount: row.recipientCount,
    templateVersionId: row.templateVersionId === null ? null : TemplateVersionId.parse(row.templateVersionId),
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}
