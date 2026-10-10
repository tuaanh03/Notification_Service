import type { GetNotificationOutcome } from '../../../notifications/application/index.ts';
import type { NotificationId } from '../../../../shared/kernel/index.ts';
import type { NotificationOutcome, NotificationOutcomes } from '../../application/ports/index.ts';

/** webhooks -> notifications (query công khai `GetNotificationOutcome`). */
export class NotificationsOutcomeLookup implements NotificationOutcomes {
  private readonly query: GetNotificationOutcome;

  constructor(deps: { notificationOutcomes: GetNotificationOutcome }) {
    this.query = deps.notificationOutcomes;
  }

  get(id: NotificationId): Promise<NotificationOutcome | null> {
    return this.query.execute(id);
  }
}
