import type { AiChatMessage } from '../../domain/rules/ai-compose-prompt.ts';

/** Một lần hỏi nhà cung cấp AI. */
export interface AiCompletion {
  content: string;
  model: string;
  promptTokens: number | null;
  completionTokens: number | null;
}

/**
 * Nhà cung cấp AI (ADR-0020 §7). Hiện thực chuẩn tương thích OpenAI — đổi bên chỉ là đổi `.env`.
 * Lỗi (nhà cung cấp trả lỗi, quá giờ) -> ném `UpstreamError` 502; `configured = false` -> command trả 503.
 */
export interface TemplateAiWriter {
  readonly configured: boolean;
  complete(messages: readonly AiChatMessage[]): Promise<AiCompletion>;
}

/** Giới hạn số lần gọi AI của MỘT admin (đếm chung mọi process). false = hết lượt trong phút này. */
export interface AiComposeRateLimiter {
  tryAcquire(adminId: string): Promise<boolean>;
}
