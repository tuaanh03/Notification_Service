import {
  audited,
  type CommandContext,
  type EventOutbox,
  type IntegrationEvent,
  type UnitOfWork,
} from '../../../../shared/application/index.ts';
import { issue, NotFoundError, ValidationError, type AppId, type Clock, type Issue } from '../../../../shared/kernel/index.ts';
import type { Topic } from '../../domain/entities/topic.ts';
import { UserTopicPreference } from '../../domain/entities/user-topic-preference.ts';
import type { UserPreferencesDto } from '../dto.ts';
import { TOPIC_EVENTS, USER_AGGREGATE } from '../events.ts';
import type { OptionalEmailSetting, PreferenceRepository, TopicRepository, UserLookup } from '../ports/index.ts';
import type { GetUserPreferences } from '../queries/get-user-preferences.ts';

export interface SetUserPreferencesInput {
  appId: AppId;
  externalId: string;
  /** L1: tắt mọi email không bắt buộc. Không truyền = giữ nguyên. */
  optedOutOptional?: boolean | undefined;
  /** L3: bật/tắt theo từng topic, khoá là `topic.key`. Topic không nhắc tới = giữ nguyên. */
  topics?: Readonly<Record<string, boolean>> | undefined;
}

/**
 * App service ghi lựa chọn nhận email của user (người dùng bấm trong giao diện của app đó).
 *
 * Kiểm TẤT CẢ trước khi ghi bất cứ gì — một topic sai thì không topic nào được lưu:
 *   - key không phải topic `active` của app -> TOPIC_NOT_FOUND
 *   - tắt topic mandatory                   -> TOPIC_MANDATORY (bật topic mandatory: bỏ qua, vô nghĩa)
 * Lựa chọn không đổi thì không ghi, không phát event. Cả L1 lẫn L3 trong MỘT transaction.
 */
export class SetUserPreferences {
  private readonly deps: {
    uow: UnitOfWork;
    outbox: EventOutbox;
    clock: Clock;
    topics: TopicRepository;
    preferences: PreferenceRepository;
    users: UserLookup;
    emailSetting: OptionalEmailSetting;
    getUserPreferences: GetUserPreferences;
  };

  constructor(deps: SetUserPreferences['deps']) {
    this.deps = deps;
  }

  async execute(input: SetUserPreferencesInput, ctx: CommandContext): Promise<UserPreferencesDto> {
    const { uow, outbox, clock, topics, preferences, users, emailSetting, getUserPreferences } = this.deps;
    return uow.run(async () => {
      const user = await users.find(input);
      if (!user) throw new NotFoundError('user', input.externalId);

      const requested = Object.entries(input.topics ?? {});
      const active = new Map<string, Topic>(
        (await topics.listByApp(input.appId)).filter((t) => t.status === 'active').map((t) => [t.key, t]),
      );
      const issues: Issue[] = [];
      for (const [key, optedIn] of requested) {
        const topic = active.get(key);
        if (!topic) issues.push(issue('TOPIC_NOT_FOUND', `topic ${key} does not exist or is not active`, `topics.${key}`));
        else if (topic.mandatory && !optedIn) {
          issues.push(issue('TOPIC_MANDATORY', `topic ${key} is mandatory and cannot be turned off`, `topics.${key}`));
        }
      }
      if (issues.length) throw new ValidationError(issues);

      const now = clock.now();
      const existing = new Map((await preferences.listByUser(user.userId)).map((p) => [p.topicId, p]));
      const events: IntegrationEvent[] = [];
      for (const [key, optedIn] of requested) {
        const topic = active.get(key)!;
        if (topic.mandatory) continue; // bật topic bắt buộc: không cần lưu gì
        const current = existing.get(topic.id);
        if (current?.optedIn === optedIn) continue;

        const before = current?.optedIn ?? null;
        const preference =
          current ?? new UserTopicPreference({ userId: user.userId, topicId: topic.id, optedIn, source: 'user_explicit', updatedAt: now });
        preference.set(optedIn, 'user_explicit', now);
        await preferences.upsert(preference);
        events.push({
          aggregateType: USER_AGGREGATE,
          aggregateId: user.userId,
          eventType: TOPIC_EVENTS.preferenceChanged,
          payload: audited(ctx, { topicKey: key, before: { optedIn: before }, after: { optedIn } }),
        });
      }
      await outbox.append(events);

      if (input.optedOutOptional !== undefined) {
        await emailSetting.set({ appId: input.appId, userId: user.userId, optedOut: input.optedOutOptional }, ctx);
      }
      return getUserPreferences.execute(input);
    });
  }
}
