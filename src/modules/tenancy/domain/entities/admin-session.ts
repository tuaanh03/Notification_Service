import { BaseEntity, type AdminId, type AdminSessionId, type TimestampInput } from '../../../../shared/kernel/index.ts';

export interface AdminSessionProps extends TimestampInput {
  id: AdminSessionId;
  adminId: AdminId;
  /**
   * BĂM của token, không phải token. Token gốc chỉ tồn tại trong response đăng nhập và trong
   * cookie của trình duyệt — rò bảng này không cho phép mạo danh ai (cùng lý do với API key,
   * ADR-0015 §3: token 256 bit ngẫu nhiên thì hash nhanh là đủ).
   */
  tokenHash: string;
  expiresAt: Date;
}

/**
 * Một lần đăng nhập của admin. Phiên là NGUỒN SỰ THẬT cho câu hỏi "còn được vào hay không":
 * đăng xuất xoá dòng này và request kế tiếp bị từ chối ngay, không phải chờ hết hạn.
 *
 * Đây là lý do không dùng token tự chứa (JWT): thu hồi được thì phải tra bảng, mà đã tra bảng
 * thì token mờ đơn giản hơn hẳn — một loại token, một chỗ thu hồi.
 */
export class AdminSession extends BaseEntity<AdminSessionId> {
  readonly adminId: AdminId;
  readonly tokenHash: string;
  readonly expiresAt: Date;

  constructor(props: AdminSessionProps) {
    super(props.id, props);
    this.adminId = props.adminId;
    this.tokenHash = props.tokenHash;
    this.expiresAt = props.expiresAt;
  }

  /** `at` truyền vào chứ không tự lấy giờ — domain không chạm đồng hồ hệ thống. */
  isExpired(at: Date): boolean {
    return this.expiresAt.getTime() <= at.getTime();
  }
}
