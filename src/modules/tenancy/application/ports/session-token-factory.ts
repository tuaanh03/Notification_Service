/** Token phiên: bản gốc trả về một lần, bản băm để lưu. */
export interface IssuedSessionToken {
  /** Chuỗi gốc — chỉ đi vào cookie của trình duyệt. KHÔNG vào DB, log hay audit. */
  token: string;
  hash: string;
}

/** Sinh token phiên. Là PORT vì application không được chạm `node:crypto`. */
export interface SessionTokenFactory {
  create(): IssuedSessionToken;
  /** Băm token nhận từ request, để tra đúng một dòng trong `admin_sessions`. */
  hashOf(token: string): string;
}
