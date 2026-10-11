import type {
  AppId,
  IncomingCallId,
  IncomingCallOutcome,
  IncomingHookId,
  PublicationId,
} from '../../../../shared/kernel/index.ts';

/** Một dòng nhật ký gọi của hook. KHÔNG có body gốc — body có thể chứa dữ liệu nội bộ không liên quan. */
export interface IncomingCall {
  id: IncomingCallId;
  hookId: IncomingHookId;
  appId: AppId;
  at: Date;
  httpStatus: number;
  outcome: IncomingCallOutcome;
  publicationId: PublicationId | null;
  recipientCount: number | null;
  /** Mã lỗi ổn định (MISSING_VARIABLE, INCOMING_HOOK_RATE_LIMITED…) hoặc lý do bỏ qua (`condition_not_met`). */
  errorCode: string | null;
  /** Tên trường của body gắn với `errorCode` (thiếu / sai kiểu) — chỉ tên, không giá trị. */
  errorFields: string[] | null;
}
