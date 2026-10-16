import type { CommandContext } from '../../../../shared/application/index.ts';
import { ValidationError, type AppId, type TemplateId } from '../../../../shared/kernel/index.ts';
import type { PublicationDto } from '../dto.ts';
import type { AppSendingLookup } from '../ports/index.ts';
import type { AcceptEmailNotification } from './accept-email-notification.ts';
import type { PublishToTopic } from './publish-to-topic.ts';

/** Một lần bấm Gửi trên console tới tối đa chừng này người cụ thể. Gửi nhiều hơn: phát vào chủ đề. */
export const MAX_CONSOLE_RECIPIENTS = 20;

export interface ConsoleSendContent {
  subject?: string | undefined;
  html?: string | undefined;
  text?: string | undefined;
  templateId?: TemplateId | undefined;
  payload?: Record<string, unknown> | undefined;
}

export interface ConsoleSendResult {
  queued: number;
  /** Mỗi người một dòng, đúng thứ tự gửi lên. `code` = vì sao không xếp hàng được (RECIPIENT_NOT_FOUND). */
  results: { externalId: string; notificationId: string | null; code: string | null }[];
}

/**
 * Màn Soạn thông báo của console — gửi đi ĐÚNG đường của `/v1` (`AcceptEmailNotification` /
 * `PublishToTopic`): cùng kiểm chủ đề, template, nội dung, cùng worker và gate consent. Chỉ khác:
 * `origin = 'dashboard'`, actor là admin, và app phải tự tra (không có `AppCaller`).
 *
 * Bấm Gửi hai lần không thành hai thư: console gửi kèm `requestId` của lần soạn, khoá chống trùng là
 * `console:<requestId>:<externalId>` (gửi lẻ) / `console:<requestId>` (phát vào chủ đề).
 */
export class SendFromConsole {
  private readonly deps: { accept: AcceptEmailNotification; publish: PublishToTopic; apps: AppSendingLookup };

  constructor(deps: SendFromConsole['deps']) {
    this.deps = deps;
  }

  async toPeople(
    input: ConsoleSendContent & { appId: AppId; topic: string; externalIds: readonly string[]; requestId: string },
    ctx: CommandContext,
  ): Promise<ConsoleSendResult> {
    const externalIds = [...new Set(input.externalIds)];
    if (externalIds.length === 0) throw ValidationError.of('RECIPIENTS_REQUIRED', 'choose at least one recipient', 'externalIds');
    if (externalIds.length > MAX_CONSOLE_RECIPIENTS) {
      throw ValidationError.of('TOO_MANY_RECIPIENTS', `at most ${MAX_CONSOLE_RECIPIENTS} recipients per send`, 'externalIds');
    }
    const { appId, topic, requestId, externalIds: _ids, ...content } = input;
    const grantedChannels = await this.sendable(appId);
    const results: ConsoleSendResult['results'] = [];
    for (const externalId of externalIds) {
      try {
        const { notification } = await this.deps.accept.execute(
          { ...content, appId, topic, externalId, grantedChannels, origin: 'dashboard', idempotencyKey: `console:${requestId}:${externalId}` },
          ctx,
        );
        results.push({ externalId, notificationId: notification.id, code: null });
      } catch (err) {
        // Chỉ lỗi RIÊNG của người này mới ghi vào dòng; lỗi chủ đề / nội dung giống nhau cho mọi người -> ném ra.
        const code = err instanceof ValidationError && err.issues.length === 1 ? err.issues[0]?.code : undefined;
        if (code !== 'RECIPIENT_NOT_FOUND') throw err;
        results.push({ externalId, notificationId: null, code });
      }
    }
    return { queued: results.filter((r) => r.notificationId !== null).length, results };
  }

  async toTopic(
    input: ConsoleSendContent & { appId: AppId; topic: string; requestId: string },
    ctx: CommandContext,
  ): Promise<PublicationDto> {
    const { appId, topic, requestId, ...content } = input;
    const grantedChannels = await this.sendable(appId);
    const { publication } = await this.deps.publish.execute(
      { ...content, appId, topic, grantedChannels, origin: 'dashboard', idempotencyKey: `console:${requestId}` },
      ctx,
    );
    return publication;
  }

  private async sendable(appId: AppId) {
    const app = await this.deps.apps.sendingOf(appId);
    if (!app.active) throw ValidationError.of('APP_NOT_ACTIVE', 'this app is not active and cannot send');
    return app.grantedChannels;
  }
}
