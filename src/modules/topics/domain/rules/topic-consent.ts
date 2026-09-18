import { ValidationError } from '../../../../shared/kernel/index.ts';
import type { Topic } from '../entities/topic.ts';
import type { UserTopicPreference } from '../entities/user-topic-preference.ts';

/**
 * Phần tối thiểu của topic mà rule consent cần. Entity `Topic` thoả sẵn interface này;
 * pipeline giải người nhận chỉ có view nên cũng truyền được — không ai phải dựng entity.
 */
export interface ConsentTopic {
  mandatory: boolean;
  /** Suy từ defaultMode: 'opt_out' -> true, 'opt_in' -> false. */
  defaultOptedIn: boolean;
}

/**
 * L3 — consent hiệu lực của một user với một topic. NƠI DUY NHẤT viết rule này:
 * pipeline giải người nhận gọi thẳng hàm này (ADR-0010).
 *
 * Ý muốn của user (consent) luôn thắng ý muốn của hệ thống (targeting) —
 * ngoại lệ duy nhất là topic mandatory.
 */
export function effectiveOptIn(
  topic: ConsentTopic,
  preference: Pick<UserTopicPreference, 'optedIn'> | null,
): boolean {
  if (topic.mandatory) return true;
  return preference ? preference.optedIn : topic.defaultOptedIn;
}

export function assertTopicIsTurnableOff(topic: Topic): void {
  if (topic.mandatory) {
    throw ValidationError.of('TOPIC_MANDATORY', `topic ${topic.key} is mandatory and cannot be turned off`);
  }
}
