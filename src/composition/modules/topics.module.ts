import type { AppQueries } from '../../modules/apps/application/index.ts';
import type { FindUserByExternalId } from '../../modules/directory/application/index.ts';
import type { SetOptedOutOptional } from '../../modules/subscriptions/application/index.ts';
import {
  ConsentQueries,
  CreateTopic,
  GetUserPreferences,
  SetUserPreferences,
  TopicQueries,
  TransitionTopic,
} from '../../modules/topics/application/index.ts';
import {
  AppsAppLookup,
  DirectoryUserLookup,
  DrizzlePreferenceRepository,
  DrizzleTopicRepository,
  SubscriptionsOptionalEmailSetting,
} from '../../modules/topics/infrastructure/adapters/index.ts';
import { adminTopicsRoutes, v1TopicsRoutes } from '../../modules/topics/interface/index.ts';
import type { Container } from '../container.ts';
import type { ModuleDefinition } from '../module-definition.ts';

/** Ghép module topics: topic (admin) + preference của user (v1). Hỏi apps / directory / subscriptions qua adapter. */
export function topicsModule(
  container: Container,
  dependencies: { appQueries: AppQueries; findUser: FindUserByExternalId; setOptedOutOptional: SetOptedOutOptional },
): { definition: ModuleDefinition; consentQueries: ConsentQueries } {
  const { uow, outbox, clock } = container.ports;
  const { transactions } = container.infra;

  const topics = new DrizzleTopicRepository({ transactions });
  const preferences = new DrizzlePreferenceRepository({ transactions });
  const users = new DirectoryUserLookup({ findUser: dependencies.findUser });
  const queries = new TopicQueries({ topics });
  const getUserPreferences = new GetUserPreferences({ topics, preferences, users });

  return {
    consentQueries: new ConsentQueries({ topics, preferences }),
    definition: {
      name: 'topics',
      http: {
        admin: [
          adminTopicsRoutes({
            createTopic: new CreateTopic({ uow, outbox, clock, topics, apps: new AppsAppLookup(dependencies) }),
            transitionTopic: new TransitionTopic({ uow, outbox, clock, topics }),
            queries,
            getUserPreferences,
          }),
        ],
        v1: [
          v1TopicsRoutes({
            queries,
            getUserPreferences,
            setUserPreferences: new SetUserPreferences({
              uow,
              outbox,
              clock,
              topics,
              preferences,
              users,
              emailSetting: new SubscriptionsOptionalEmailSetting(dependencies),
              getUserPreferences,
            }),
          }),
        ],
      },
    },
  };
}
