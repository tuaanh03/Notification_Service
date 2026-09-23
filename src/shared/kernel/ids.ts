import { randomUUID } from 'node:crypto';
import { InvalidIdError } from './errors.ts';

/**
 * Branded id: chặn ở compile time việc truyền nhầm org_id vào chỗ app_id.
 * Mô hình B cho mọi id là UUID nên compiler không tự phân biệt được — brand làm việc đó.
 */
declare const brand: unique symbol;
export type Brand<T, K extends string> = T & { readonly [brand]: K };
export type Uuid<K extends string> = Brand<string, K>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface IdFactory<K extends string> {
  /** Sinh id mới. ID sinh ở tầng application, không phải ở DB (MySQL không có gen_random_uuid()). */
  create(): Uuid<K>;
  /** Ép một string từ bên ngoài (DB, HTTP) thành id có brand; sai định dạng thì throw. */
  parse(value: string): Uuid<K>;
  is(value: string): value is Uuid<K>;
}

function idFactory<K extends string>(name: K): IdFactory<K> {
  return {
    create: () => randomUUID() as Uuid<K>,
    parse: (value: string) => {
      if (!UUID_RE.test(value)) throw new InvalidIdError(name, value);
      return value as Uuid<K>;
    },
    is: (value: string): value is Uuid<K> => UUID_RE.test(value),
  };
}

export type AccountId = Uuid<'AccountId'>;
export type OrgId = Uuid<'OrgId'>;
export type AppId = Uuid<'AppId'>;
export type AppSecretId = Uuid<'AppSecretId'>;
export type AdminId = Uuid<'AdminId'>;
export type AdminSessionId = Uuid<'AdminSessionId'>;
export type PersonId = Uuid<'PersonId'>;
export type UserId = Uuid<'UserId'>;
export type SubscriptionId = Uuid<'SubscriptionId'>;
export type TopicId = Uuid<'TopicId'>;
export type SegmentId = Uuid<'SegmentId'>;
export type TemplateId = Uuid<'TemplateId'>;
export type TemplateVersionId = Uuid<'TemplateVersionId'>;
export type NotificationId = Uuid<'NotificationId'>;
export type TransitionId = Uuid<'TransitionId'>;
export type DeliveryBatchId = Uuid<'DeliveryBatchId'>;
export type BounceEventId = Uuid<'BounceEventId'>;
export type AuditId = Uuid<'AuditId'>;
export type MergeLogId = Uuid<'MergeLogId'>;

export const AccountId = idFactory('AccountId');
export const OrgId = idFactory('OrgId');
export const AppId = idFactory('AppId');
export const AppSecretId = idFactory('AppSecretId');
export const AdminId = idFactory('AdminId');
export const AdminSessionId = idFactory('AdminSessionId');
export const PersonId = idFactory('PersonId');
export const UserId = idFactory('UserId');
export const SubscriptionId = idFactory('SubscriptionId');
export const TopicId = idFactory('TopicId');
export const SegmentId = idFactory('SegmentId');
export const TemplateId = idFactory('TemplateId');
export const TemplateVersionId = idFactory('TemplateVersionId');
export const NotificationId = idFactory('NotificationId');
export const TransitionId = idFactory('TransitionId');
export const DeliveryBatchId = idFactory('DeliveryBatchId');
export const BounceEventId = idFactory('BounceEventId');
export const AuditId = idFactory('AuditId');
export const MergeLogId = idFactory('MergeLogId');
