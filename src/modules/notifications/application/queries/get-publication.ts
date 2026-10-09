import { NotFoundError, type AppId, type PublicationId, type UserId } from '../../../../shared/kernel/index.ts';
import type { Publication } from '../../domain/entities/publication.ts';
import { toPublicationDto, type PublicationDto } from '../dto.ts';
import type { NotificationRepository, RecipientLookup, TemplateLabels, TopicConsentLookup } from '../ports/index.ts';
import { templateLabelOf } from './get-notification.ts';

export interface PublicationReaders {
  notifications: NotificationRepository;
  users: RecipientLookup;
  topics: TopicConsentLookup;
  templates: TemplateLabels;
}

/** `GET /v1/publications/:id` (ADR-0028). Lần phát của app khác trả 404 — không để lộ id đó tồn tại. */
export class GetPublication {
  private readonly deps: PublicationReaders & {
    publications: { findById(id: PublicationId): Promise<Publication | null> };
  };

  constructor(deps: GetPublication['deps']) {
    this.deps = deps;
  }

  async execute(input: { appId: AppId; id: PublicationId }): Promise<PublicationDto> {
    const publication = await this.deps.publications.findById(input.id);
    if (!publication || publication.appId !== input.appId) throw new NotFoundError('publication', input.id);
    return describePublication(this.deps, publication);
  }
}

/** Lần phát + tiến độ tính từ các thư con. 4 truy vấn, không phụ thuộc số người nhận. */
export async function describePublication(deps: PublicationReaders, publication: Publication): Promise<PublicationDto> {
  const children = await deps.notifications.listByPublication(publication.id);
  const userIds = children.flatMap((child): UserId[] => (child.targetUserId === null ? [] : [child.targetUserId]));
  const [topic, template, externalIds] = await Promise.all([
    deps.topics.topicById(publication.topicId),
    templateLabelOf(deps.templates, publication.templateVersionId),
    deps.users.externalIds(publication.appId, userIds),
  ]);
  return toPublicationDto(publication, { topicKey: topic?.key ?? '', template, children, externalIds });
}
