import { ValidationError, type UserId } from '../../../../shared/kernel/index.ts';

/**
 * Data Tag: trả lời "user là ai / làm gì" — dùng cho TARGETING và cá nhân hoá nội dung.
 *
 * KHÔNG dùng tag để kiểm tra quyền: `role: super_admin` chỉ là nhãn phân đoạn,
 * cấp quyền phải đi qua RBAC (admin_app_roles).
 * KHÔNG dùng tag để lưu consent: consent nằm ở user_topic_preferences.
 *
 * PK (user_id, key) -> ghi đè theo key, không nhân bản.
 */
export class UserTag {
  readonly userId: UserId;
  readonly key: string;
  value: string;
  updatedAt: Date;

  constructor(props: { userId: UserId; key: string; value: string; updatedAt: Date }) {
    const key = props.key.trim();
    if (!key) throw ValidationError.of('TAG_KEY_REQUIRED', 'tag key must not be empty', 'key');
    this.userId = props.userId;
    this.key = key;
    this.value = props.value;
    this.updatedAt = props.updatedAt;
  }

  overwrite(value: string, at: Date): void {
    this.value = value;
    this.updatedAt = at;
  }
}
