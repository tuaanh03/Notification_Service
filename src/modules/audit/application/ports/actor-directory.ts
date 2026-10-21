/** Tên + email của người làm (tài khoản EWS) theo id — nhật ký chỉ lưu id. */
export interface ActorDirectory {
  /** Theo LÔ. Id không có tài khoản (`admin-cli`, `system`, id app…) thì không có trong kết quả. */
  describe(ids: readonly string[]): Promise<Map<string, { email: string; displayName: string | null }>>;
}
