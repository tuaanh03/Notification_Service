import type { AppId, UserId } from '../../../../shared/kernel/index.ts';
import type { WindowQuota } from '../../../../shared/rate-limit/index.ts';
import type { SendQuota } from '../../application/ports/index.ts';
import { hourWindow, vnDayWindow } from '../../domain/rules/send-limits.ts';

/** Hạn mức GĐ 3 (ADR-0032) trên Redis: `quota:hour:<app>:<giờ>` và `quota:rcpt:<app>:<người>:<ngày VN>`. */
export class RedisSendQuota implements SendQuota {
  private readonly quota: WindowQuota;

  constructor(deps: { quota: WindowQuota }) {
    this.quota = deps.quota;
  }

  takeHourly(appId: AppId, count: number, limit: number, now: Date): Promise<boolean> {
    return this.quota.take(`hour:${appId}`, hourWindow(now), count, limit, now.getTime());
  }

  takeRecipientDay(appId: AppId, userId: UserId, limit: number, now: Date): Promise<boolean> {
    return this.quota.take(`rcpt:${appId}:${userId}`, vnDayWindow(now), 1, limit, now.getTime());
  }
}
