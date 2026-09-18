import type { ActorType, NotificationStatus } from '../../../../shared/kernel/index.ts';
import type { TransitionEvent } from '../rules/transitions.ts';

/** Một dòng của notification_transitions — nguồn của LifecycleTimeline và AuditTrail. */
export interface Actor {
  id: string;
  type: ActorType;
}

export interface TransitionRecord {
  from: NotificationStatus;
  to: NotificationStatus;
  event: TransitionEvent;
  actor: Actor;
  reason: string | null;
  at: Date;
}
