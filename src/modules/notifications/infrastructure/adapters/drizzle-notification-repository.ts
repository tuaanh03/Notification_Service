import { and, asc, count, desc, eq, lt, type SQL } from 'drizzle-orm';
import { duplicateKeyName, type TransactionContext } from '../../../../shared/db/index.ts';
import {
  AppId,
  ConcurrentTransitionError,
  NotificationId,
  SegmentId,
  TemplateVersionId,
  TopicId,
  TransitionId,
  UserId,
  type AppId as AppIdType,
  type NotificationId as NotificationIdType,
} from '../../../../shared/kernel/index.ts';
import { IdempotencyKeyTakenError } from '../../application/errors.ts';
import type { NotificationFilter, NotificationPage, NotificationRepository } from '../../application/ports/index.ts';
import { Notification } from '../../domain/entities/notification.ts';
import { emailContent } from '../../domain/types/email-content.ts';
import { notifications, notificationTransitions } from '../db/schema.ts';

type Row = typeof notifications.$inferSelect;
type WriteResult = [{ affectedRows: number }, unknown];

export class DrizzleNotificationRepository implements NotificationRepository {
  private readonly transactions: TransactionContext;

  constructor(deps: { transactions: TransactionContext }) {
    this.transactions = deps.transactions;
  }

  async insert(n: Notification): Promise<void> {
    try {
      await this.transactions.executor().insert(notifications).values({
        notificationId: n.id,
        appId: n.appId,
        topicId: n.topicId,
        origin: n.origin,
        status: n.status,
        isTest: n.isTest,
        templateVersionId: n.templateVersionId,
        payload: n.payload,
        includedSegments: [...n.includedSegments],
        excludedSegments: [...n.excludedSegments],
        idempotencyKey: n.idempotencyKey,
        collapseKey: n.collapseKey,
        occurrenceCount: n.occurrenceCount,
        staleDirectory: n.staleDirectory,
        parentNotificationId: n.parentNotificationId,
        scheduledAt: n.scheduledAt,
        createdBy: n.createdBy,
        approvedBy: n.approvedBy,
        previewRenderedAt: n.previewRenderedAt,
        counters: n.counters,
        createdAt: n.createdAt,
        updatedAt: n.updatedAt,
        queuedAt: n.queuedAt,
        sendingAt: n.sendingAt,
        finishedAt: n.finishedAt,
        targetUserId: n.targetUserId,
        subject: n.content?.subject ?? null,
        bodyHtml: n.content?.html ?? null,
        bodyText: n.content?.text ?? null,
      });
    } catch (err) {
      if (duplicateKeyName(err) === 'uq_notifications_app_idempotency') {
        throw new IdempotencyKeyTakenError(n.idempotencyKey ?? '');
      }
      throw err;
    }
  }

  async findById(id: NotificationIdType): Promise<Notification | null> {
    const [row] = await this.transactions.executor().select().from(notifications).where(eq(notifications.notificationId, id));
    return row ? toNotification(row) : null;
  }

  async findByIdempotencyKey(appId: AppIdType, key: string): Promise<Notification | null> {
    const [row] = await this.transactions
      .executor()
      .select()
      .from(notifications)
      .where(and(eq(notifications.appId, appId), eq(notifications.idempotencyKey, key)));
    return row ? toNotification(row) : null;
  }

  async listByApp(appId: AppIdType, filter: NotificationFilter, page: { limit: number; offset: number }): Promise<NotificationPage> {
    const conditions: SQL[] = [eq(notifications.appId, appId)];
    if (filter.status) conditions.push(eq(notifications.status, filter.status));
    if (filter.topicId) conditions.push(eq(notifications.topicId, filter.topicId));
    if (filter.targetUserId) conditions.push(eq(notifications.targetUserId, filter.targetUserId));
    const where = and(...conditions);
    const executor = this.transactions.executor();
    const [rows, [totals]] = await Promise.all([
      executor
        .select()
        .from(notifications)
        .where(where)
        // id phá hoà khi trùng mili giây — không có nó, một dòng có thể hiện ở hai trang liền nhau.
        .orderBy(desc(notifications.createdAt), desc(notifications.notificationId))
        .limit(page.limit)
        .offset(page.offset),
      executor.select({ value: count() }).from(notifications).where(where),
    ]);
    return { rows: rows.map(toNotification), total: totals?.value ?? 0 };
  }

  async saveTransition(n: Notification): Promise<void> {
    const step = n.pendingTransition;
    if (!step) throw new Error(`notification ${n.id} has no pending transition to save`);
    const executor = this.transactions.require('NotificationRepository.saveTransition');

    const [result] = (await executor
      .update(notifications)
      .set({
        status: n.status,
        counters: n.counters,
        updatedAt: n.updatedAt,
        queuedAt: n.queuedAt,
        sendingAt: n.sendingAt,
        finishedAt: n.finishedAt,
      })
      .where(and(eq(notifications.notificationId, n.id), eq(notifications.status, n.expectedStatus)))) as unknown as WriteResult;
    if (result.affectedRows === 0) throw new ConcurrentTransitionError('Notification', n.id, n.expectedStatus);

    // SM-9: dòng lịch sử ghi CÙNG transaction với lần đổi trạng thái — không bao giờ thiếu.
    await executor.insert(notificationTransitions).values({
      transitionId: TransitionId.create(),
      notificationId: n.id,
      fromStatus: step.from,
      toStatus: step.to,
      event: String(step.event),
      actor: step.actor.id,
      actorType: step.actor.type,
      reason: step.reason?.slice(0, 500) ?? null,
      at: step.at,
    });
    n.commitTransition();
  }

  async listStuckSending(before: Date, limit: number): Promise<Notification[]> {
    const rows = await this.transactions
      .executor()
      .select()
      .from(notifications)
      .where(and(eq(notifications.status, 'sending'), lt(notifications.sendingAt, before)))
      .orderBy(asc(notifications.sendingAt))
      .limit(limit);
    return rows.map(toNotification);
  }
}

function toNotification(row: Row): Notification {
  return new Notification({
    id: NotificationId.parse(row.notificationId),
    appId: AppId.parse(row.appId),
    topicId: TopicId.parse(row.topicId),
    origin: row.origin,
    status: row.status,
    isTest: row.isTest,
    templateVersionId: row.templateVersionId === null ? null : TemplateVersionId.parse(row.templateVersionId),
    payload: row.payload,
    includedSegments: row.includedSegments.map((id) => SegmentId.parse(id)),
    excludedSegments: row.excludedSegments.map((id) => SegmentId.parse(id)),
    idempotencyKey: row.idempotencyKey,
    collapseKey: row.collapseKey,
    occurrenceCount: row.occurrenceCount,
    staleDirectory: row.staleDirectory,
    parentNotificationId: row.parentNotificationId === null ? null : NotificationId.parse(row.parentNotificationId),
    scheduledAt: row.scheduledAt,
    createdBy: row.createdBy,
    approvedBy: row.approvedBy,
    previewRenderedAt: row.previewRenderedAt,
    counters: row.counters,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    queuedAt: row.queuedAt,
    sendingAt: row.sendingAt,
    finishedAt: row.finishedAt,
    targetUserId: row.targetUserId === null ? null : UserId.parse(row.targetUserId),
    content:
      row.subject !== null && row.bodyHtml !== null
        ? emailContent({ subject: row.subject, html: row.bodyHtml, text: row.bodyText })
        : null,
  });
}
