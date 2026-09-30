import type { CommandContext } from '../../../../shared/application/index.ts';
import {
  NotFoundError,
  RateLimitedError,
  TemplateVersionId,
  UpstreamError,
  type AppId,
  type Clock,
  type Issue,
  type TemplateId,
} from '../../../../shared/kernel/index.ts';
import type { Logger } from '../../../../shared/observability/logger.ts';
import { TemplateVersion } from '../../domain/entities/template-version.ts';
import {
  buildAiComposeMessages,
  parseAiComposeOutput,
  type AiComposeMode,
  type AiComposeVariable,
  type AiComposedContent,
} from '../../domain/rules/ai-compose-prompt.ts';
import type { AiComposeRateLimiter, TemplateAiWriter, TemplateRepository } from '../ports/index.ts';

export interface ComposeTemplateDraftInput {
  appId: AppId;
  templateId: TemplateId;
  instruction: string;
  mode: AiComposeMode;
  /** Biến ĐÃ KHAI trên màn soạn (có thể chưa lưu) — AI chỉ được dùng các biến này. */
  variables: readonly AiComposeVariable[];
  current?: AiComposedContent | undefined;
}

/** Đề xuất của AI — CHƯA lưu gì. `issues` = kết quả kiểm tra y như lúc Xuất bản. */
export interface AiComposeResultDto extends AiComposedContent {
  issues: Issue[];
}

/**
 * "Nhờ AI soạn" (ADR-0020 §7): hỏi AI rồi trả ĐỀ XUẤT — không ghi DB, không tạo nháp. Người soạn
 * bấm "Dùng bản này" mới điền vào khung soạn, rồi tự Lưu nháp / Xuất bản như mọi nội dung khác.
 *
 * Log mỗi lần gọi (admin, model, thời gian, token, kết cục) — KHÔNG log nội dung.
 */
export class ComposeTemplateDraft {
  private readonly deps: {
    templates: TemplateRepository;
    writer: TemplateAiWriter;
    limiter: AiComposeRateLimiter;
    clock: Clock;
    logger: Logger;
  };

  constructor(deps: ComposeTemplateDraft['deps']) {
    this.deps = deps;
  }

  async execute(input: ComposeTemplateDraftInput, ctx: CommandContext): Promise<AiComposeResultDto> {
    const { templates, writer, limiter, clock } = this.deps;
    const logger = this.deps.logger.child('ai-compose');
    if (!writer.configured) {
      throw new UpstreamError('AI_NOT_CONFIGURED', 'AI is not configured: set AI_API_URL, AI_API_KEY and AI_MODEL', 503);
    }
    const template = await templates.findById(input.appId, input.templateId);
    if (!template) throw new NotFoundError('template', input.templateId);
    template.assertActive();
    if (!(await limiter.tryAcquire(ctx.actor.id))) {
      throw new RateLimitedError('AI_RATE_LIMITED', 'too many AI requests, try again in a minute');
    }

    const startedAt = clock.now().getTime();
    const meta = { adminId: ctx.actor.id, templateId: template.id, mode: input.mode };
    let completion;
    try {
      completion = await writer.complete(buildAiComposeMessages(input));
    } catch (err) {
      logger.warn('ai compose failed', { ...meta, durationMs: clock.now().getTime() - startedAt, error: String(err) });
      throw err;
    }
    const usage = {
      model: completion.model,
      durationMs: clock.now().getTime() - startedAt,
      promptTokens: completion.promptTokens,
      completionTokens: completion.completionTokens,
    };
    const content = parseAiComposeOutput(completion.content);
    if (!content) {
      logger.warn('ai compose returned invalid output', { ...meta, ...usage });
      throw new UpstreamError('AI_PROVIDER_ERROR', 'AI returned an invalid answer (expected JSON with subject and html)');
    }

    // Kiểm tra bằng CHÍNH luật lúc xuất bản — dựng tạm một version, không lưu.
    const issues = new TemplateVersion({
      id: TemplateVersionId.create(),
      templateId: template.id,
      version: 0,
      ...content,
      schema: input.variables.map((v) => ({
        name: v.name,
        source: v.name.startsWith('user.') ? ('user' as const) : ('payload' as const),
        required: v.required,
      })),
      createdAt: clock.now(),
    }).validate();
    logger.info('ai compose done', { ...meta, ...usage, issueCount: issues.length });
    return { ...content, issues };
  }
}
