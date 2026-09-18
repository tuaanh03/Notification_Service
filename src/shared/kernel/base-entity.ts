/** Cột nullable của DB mô hình bằng `null`; `undefined` chỉ dùng cho tiện dụng lúc dựng. */
export interface TimestampInput {
  createdAt?: Date | undefined;
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

  protected constructor(id: TId, timestamps?: TimestampInput) {
    this.id = id;
    this.createdAt = timestamps?.createdAt ?? new Date();
    this.mutableUpdatedAt = timestamps?.updatedAt ?? this.createdAt;
  }

  get updatedAt(): Date {
    return this.mutableUpdatedAt;
  }

  protected touch(at?: Date): void {
    this.mutableUpdatedAt = at ?? new Date();
  }

  equals(other: BaseEntity<TId> | null | undefined): boolean {
    return other instanceof BaseEntity && this.id === other.id;
  }
}
