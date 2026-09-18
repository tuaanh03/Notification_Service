import {
  BaseEntity,
  ValidationError,
  type AppId,
  type Channel,
  type TemplateId,
  type TemplateStatus,
  type TimestampInput,
} from '../../../shared/kernel/index.ts';

export interface TemplateProps extends TimestampInput {
  id: TemplateId;
  appId: AppId;
  key: string;
  name: string;
  channel: Channel;
  status?: TemplateStatus | undefined;
}

export class Template extends BaseEntity<TemplateId> {
  readonly appId: AppId;
  readonly key: string;
  readonly channel: Channel;
  name: string;
  status: TemplateStatus;

  constructor(props: TemplateProps) {
    super(props.id, props);
    const key = props.key.trim();
    if (!key) throw new ValidationError(['template key không được rỗng']);
    this.appId = props.appId;
    this.key = key;
    this.name = props.name.trim();
    this.channel = props.channel;
    this.status = props.status ?? 'active';
  }

  archive(at: Date): void {
    this.status = 'archived';
    this.touch(at);
  }
}
