import { ValidationError, type AppId, type UserId } from '../../../shared/kernel/index.ts';

/**
 * Alias để app service trỏ tới user bằng khoá của chính họ.
 * PK (user_id, label); UNIQUE (app_id, label, value) — tránh hai user cùng alias trong một app.
 */
export class UserAlias {
  readonly userId: UserId;
  readonly appId: AppId;
  readonly label: string;
  readonly value: string;

  constructor(props: { userId: UserId; appId: AppId; label: string; value: string }) {
    const label = props.label.trim();
    const value = props.value.trim();
    if (!label || !value) throw new ValidationError(['alias label và value không được rỗng']);
    this.userId = props.userId;
    this.appId = props.appId;
    this.label = label;
    this.value = value;
  }
}
