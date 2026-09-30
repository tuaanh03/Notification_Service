import { UpstreamError } from '../../../../shared/kernel/index.ts';
import type { AiCompletion, TemplateAiWriter } from '../../application/ports/index.ts';
import type { AiChatMessage } from '../../domain/rules/ai-compose-prompt.ts';

export interface OpenAiCompatibleConfig {
  /** Endpoint đầy đủ `…/chat/completions`. */
  url: string;
  apiKey: string;
  model: string;
  timeoutMs: number;
}

type Fetch = typeof fetch;

/**
 * Gọi `POST …/chat/completions` theo chuẩn tương thích OpenAI (OpenAI, OpenRouter, DeepSeek, Groq…).
 * Không gửi `response_format`: nhiều bên không hỗ trợ — câu lệnh yêu cầu JSON, domain tự bóc ra.
 *
 * Lỗi nào cũng thành `UpstreamError` 502 `AI_PROVIDER_ERROR`; message chỉ có mã HTTP + đoạn đầu lỗi
 * của nhà cung cấp, không bao giờ có khoá.
 */
export class OpenAiCompatibleTemplateWriter implements TemplateAiWriter {
  readonly configured = true;
  private readonly config: OpenAiCompatibleConfig;
  private readonly fetch: Fetch;

  constructor(deps: { config: OpenAiCompatibleConfig; fetch?: Fetch | undefined }) {
    this.config = deps.config;
    this.fetch = deps.fetch ?? fetch;
  }

  async complete(messages: readonly AiChatMessage[]): Promise<AiCompletion> {
    let response: Response;
    try {
      response = await this.fetch(this.config.url, {
        method: 'POST',
        headers: { authorization: `Bearer ${this.config.apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({ model: this.config.model, messages, temperature: 0.4 }),
        signal: AbortSignal.timeout(this.config.timeoutMs),
      });
    } catch (err) {
      const timedOut = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
      throw new UpstreamError(
        'AI_PROVIDER_ERROR',
        timedOut ? `AI provider did not answer within ${this.config.timeoutMs} ms` : `AI provider unreachable: ${describe(err)}`,
      );
    }
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new UpstreamError('AI_PROVIDER_ERROR', `AI provider returned ${response.status}: ${body.slice(0, 300)}`);
    }
    const data = (await response.json().catch(() => null)) as ChatCompletionResponse | null;
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) {
      throw new UpstreamError('AI_PROVIDER_ERROR', 'AI provider returned no message content');
    }
    return {
      content,
      model: typeof data?.model === 'string' ? data.model : this.config.model,
      promptTokens: data?.usage?.prompt_tokens ?? null,
      completionTokens: data?.usage?.completion_tokens ?? null,
    };
  }
}

interface ChatCompletionResponse {
  model?: unknown;
  choices?: { message?: { content?: unknown } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

const describe = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** `AI_API_KEY` trống: AI tắt — command trả 503 `AI_NOT_CONFIGURED`, không gọi ra ngoài. */
export class DisabledTemplateWriter implements TemplateAiWriter {
  readonly configured = false;

  complete(): Promise<AiCompletion> {
    return Promise.reject(new UpstreamError('AI_NOT_CONFIGURED', 'AI is not configured', 503));
  }
}
