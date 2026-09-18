import { NotFoundError, type AppId, type TopicId } from '../../../../shared/kernel/index.ts';
import type { UserTopicPreference } from '../../domain/entities/user-topic-preference.ts';
import { effectiveOptIn } from '../../domain/rules/topic-consent.ts';
import { toPublicTopicDto, type UserPreferencesDto } from '../dto.ts';
import type { PreferenceRepository, TopicRepository, UserLookup } from '../ports/index.ts';

/**
 * Bảng cài đặt nhận email của một user: mọi topic `active` của app + lựa chọn của user + kết quả L3.
 * `effectiveOptIn` tính bằng CHÍNH rule mà worker dùng lúc gửi — không viết lại (ADR-0010).
 */
export class GetUserPreferences {
  private readonly deps: { topics: TopicRepository; preferences: PreferenceRepository; users: UserLookup };

  constructor(deps: GetUserPreferences['deps']) {
    this.deps = deps;
  }

  async execute(input: { appId: AppId; externalId: string }): Promise<UserPreferencesDto> {
    const { topics, preferences, users } = this.deps;
    const user = await users.find(input);
    if (!user) throw new NotFoundError('user', input.externalId);

    const active = (await topics.listByApp(input.appId)).filter((t) => t.status === 'active');
    const byTopic = new Map<TopicId, UserTopicPreference>(
      (await preferences.listByUser(user.userId)).map((p) => [p.topicId, p]),
    );

    return {
      externalId: input.externalId,
      email: user.email,
      topics: active.map((topic) => {
        const preference = byTopic.get(topic.id) ?? null;
        return {
          ...toPublicTopicDto(topic),
          optedIn: preference?.optedIn ?? null,
          effectiveOptIn: effectiveOptIn(topic, preference),
        };
      }),
    };
  }
}
