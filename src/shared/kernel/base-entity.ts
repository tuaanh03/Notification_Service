/**
 * Thời gian là DEPENDENCY, không phải thứ domain tự lấy (`new Date()` ngầm = không test cố định
 * được và lệch giữa các bước của cùng một command). `createdAt` bắt buộc: entity mới thì
 * application truyền `clock.now()`, entity nạp từ DB thì mapper truyền giá trị trong bảng.
 */
export interface TimestampInput {
  createdAt: Date;
  /** Bỏ trống = bằng `createdAt` (entity vừa tạo). */
  updatedAt?: Date | undefined;
}

/**
 * Base cho mọi entity: chỉ giữ identity + timestamp.
 * Không biết Drizzle, MySQL hay HTTP tồn tại — mapper ở infrastructure lo việc đó.
 */
export abstract class BaseEntity<TId extends string> {
  readonly id: TId;
  readonly createdAt: Date;
  private mutableUpdatedAt: Date;

  protected constructor(id: TId, timestamps: TimestampInput) {
    this.id = id;
    this.createdAt = timestamps.createdAt;
    this.mutableUpdatedAt = timestamps.updatedAt ?? timestamps.createdAt;
  }

  get updatedAt(): Date {
    return this.mutableUpdatedAt;
  }

  /** Mọi thay đổi trạng thái gọi hàm này với thời điểm do caller truyền vào. */
  protected touch(at: Date): void {
    this.mutableUpdatedAt = at;
  }

  equals(other: BaseEntity<TId> | null | undefined): boolean {
    return other instanceof BaseEntity && this.id === other.id;
  }
}
