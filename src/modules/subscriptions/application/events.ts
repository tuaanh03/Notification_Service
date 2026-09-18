export const SUBSCRIPTION_AGGREGATE = 'Subscription';

export const SUBSCRIPTION_EVENTS = {
  created: 'SubscriptionCreated',
  addressChanged: 'SubscriptionAddressChanged',
  resubscribed: 'SubscriptionResubscribed',
  unsubscribed: 'SubscriptionUnsubscribed',
} as const;
