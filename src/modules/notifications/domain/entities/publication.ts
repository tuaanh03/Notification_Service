import {
  BaseEntity,
  ValidationError,
  type AppId,
  type PublicationId,
  type TemplateVersionId,
  type TimestampInput,
  type TopicId,
} from '../../../../shared/kernel/index.ts';

/**
 * Trần số người nhận của MỘT lần phát (ADR-0028). Topic dự kiến ≤ 50 người; để gấp đôi cho topic lớn dần
 * chưa hỏng ngay. Vượt trần là 422 — phát cho nhiều hơn cần chia lô và chạy nền, chưa làm.
 */
export const MAX_PUBLICATION_RECIPIENTS = 100;

export interface PublicationProps extends TimestampInput {
  id: PublicationId;
  appId: AppId;
  topicId: TopicId;
  /** Bắt buộc với lần phát: gọi lặp mà phát hai lần là nhiều người nhận trùng thư. */
  idempotencyKey: string;
  /** Số thông báo con đã tạo — chốt lúc phát, không đổi. */
  recipientCount: number;
  /** Bản template đã dùng; null = nội dung viết thẳng. */
  templateVersionId?: TemplateVersionId | null | undefined;
  createdBy?: string | null | undefined;
}

/**
 * MỘT LẦN PHÁT tin vào topic (ADR-0028). Chỉ là bản ghi gom nhóm: mỗi người nhận là một notification
 * con (`publication_id`) đi đúng vòng đời gửi lẻ — trạng thái, kết quả, thử lại đều nằm ở con.
 * Lần phát không có trạng thái riêng; tiến độ tính từ các con lúc đọc.
 */
export class Publication extends BaseEntity<PublicationId> {
  readonly appId: AppId;
  readonly topicId: TopicId;
  readonly idempotencyKey: string;
  readonly recipientCount: number;
  readonly templateVersionId: TemplateVersionId | null;
  readonly createdBy: string | null;

  constructor(props: PublicationProps) {
    super(props.id, props);
    if (props.idempotencyKey.length === 0) {
      throw ValidationError.of('IDEMPOTENCY_KEY_REQUIRED', 'a publication requires an idempotencyKey', 'idempotencyKey');
    }
    if (!Number.isInteger(props.recipientCount) || props.recipientCount < 0) {
      throw new Error(`invalid publication recipient count: ${props.recipientCount}`);
    }
    this.appId = props.appId;
    this.topicId = props.topicId;
    this.idempotencyKey = props.idempotencyKey;
    this.recipientCount = props.recipientCount;
    this.templateVersionId = props.templateVersionId ?? null;
    this.createdBy = props.createdBy ?? null;
  }
}

/**
 * Trần chỉ kiểm lúc PHÁT, không kiểm lúc nạp từ DB — hạ trần về sau không làm lần phát cũ đọc lỗi.
 */
export function assertPublicationSize(count: number): void {
  if (count > MAX_PUBLICATION_RECIPIENTS) {
    throw ValidationError.of(
      'PUBLICATION_TOO_LARGE',
      `topic has ${count} recipients; a publication allows at most ${MAX_PUBLICATION_RECIPIENTS}`,
      'topic',
    );
  }
}
