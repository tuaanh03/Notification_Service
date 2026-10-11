/** Một dòng đã lưu. Khoá không có dòng = đang dùng mặc định. */
export interface StoredSetting {
  key: string;
  value: unknown;
  updatedBy: string | null;
  updatedAt: Date;
}

export interface SystemSettingRepository {
  listAll(): Promise<StoredSetting[]>;
  /** Ghi đè nếu đã có. */
  upsert(setting: StoredSetting): Promise<void>;
  /** Về mặc định. */
  delete(key: string): Promise<void>;
}
