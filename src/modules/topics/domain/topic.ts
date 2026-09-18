import {
  BaseEntity,
  ValidationError,
  type AppId,
  type Channel,
  type TimestampInput,
  type TopicDefaultMode,
  type TopicId,
  type TopicStatus,
} from '../../../shared/kernel/index.ts';

export interface TopicProps extends TimestampInput {
  id: TopicId;
  appId: AppId;
  /** 'promo', 'order_update', ... — UNIQUE (app_id, key). */
  key: string;
  name: string;
  status?: TopicStatus | undefined;
  defaultMode?: TopicDefaultMode | undefined;
  /** Topic thiết yếu, user không tắt được — bất kể thuộc lĩnh vực nào. */
  mandatory?: boolean | undefined;
  defaultChannels?: readonly Channel[] | undefined;
}

/**
 * Topic = kho CONSENT: trả lời "user muốn nhận gì".
 * Tách hẳn khỏi tag (targeting) và subscription (compliance) — trộn ba kho này
 * sẽ khiến segment lọc nhầm theo preference và opt-out bị hiểu sai.
 *
 * Topic scope theo app nên mỗi App Service tự nhiên có tập topic riêng:
 * tắt topic của Seller Service không đụng tới topic của Shop Service.
 */
export class Topic extends BaseEntity<TopicId> {
  readonly appId: AppId;
  readonly key: string;
  name: string;
  status: TopicStatus;
  defaultMode: TopicDefaultMode;
  readonly mandatory: boolean;
  defaultChannels: readonly Channel[];

  constructor(props: TopicProps) {
    super(props.id, props);
    const key = props.key.trim();
    if (!key) throw new ValidationError(['topic key không được rỗng']);
    this.appId = props.appId;
    this.key = key;
    this.name = props.name.trim();
    this.status = props.status ?? 'draft';
    this.defaultMode = props.defaultMode ?? 'opt_out';
    this.mandatory = props.mandatory ?? false;
    this.defaultChannels = props.defaultChannels ?? [];
  }

  /**
   * User có nhận topic này không, khi CHƯA có dòng preference nào.
   * `opt_out` = mặc định nhận (user phải chủ động tắt); `opt_in` = mặc định không nhận.
   */
  get defaultOptedIn(): boolean {
    return this.defaultMode === 'opt_out';
  }

  /** Topic mandatory thì bỏ qua lớp preference — nhưng KHÔNG BAO GIỜ bỏ qua lớp kênh chết. */
  get bypassesPreference(): boolean {
    return this.mandatory;
  }

  get canSend(): boolean {
    return this.status === 'active';
  }
}
