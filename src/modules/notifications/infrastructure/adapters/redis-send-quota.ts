import type { AppId, UserId } from '../../../../shared/kernel/index.ts';
import type { DaySlotAllocator, WindowQuota } from '../../../../shared/rate-limit/index.ts';
import type { MailboxDayQuota, SendQuota } from '../../application/ports/index.ts';
import { hourWindow, vnDayWindow } from '../../domain/rules/send-limits.ts';

const MINUTE_MS = 60_000;

/**
 * Hạn mức GĐ 3 (ADR-0032) trên Redis: `quota:hour:<app>:<giờ>` và `quota:rcpt:<app>:<người>:<ngày VN>`; số lần gọi API gửi
 * mỗi phút (ADR-0041): `quota:call:<app>:<phút>`.
 */
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

  takeApiCall(appId: AppId, limit: number, now: Date): Promise<boolean> {
    const startMs = Math.floor(now.getTime() / MINUTE_MS) * MINUTE_MS;
    return this.quota.take(`call:${appId}`, { startMs, endMs: startMs + MINUTE_MS }, 1, limit, now.getTime());
  }
}

/** Trần ngày của hộp gửi chung (ADR-0041): `mailbox:day:<đầu ngày VN, ms>` — một bucket cho cả hệ thống. */
export class RedisMailboxDayQuota implements MailboxDayQuota {
  private readonly allocator: DaySlotAllocator;

  constructor(deps: { allocator: DaySlotAllocator }) {
    this.allocator = deps.allocator;
  }

  async reserve(from: Date, count: number, cap: number, force: boolean, now: Date): Promise<Date[]> {
    const days = await this.allocator.reserve('day', vnDayWindow(from).startMs, cap, count, force, now.getTime());
    return days.map((ms) => new Date(ms));
  }

  used(at: Date): Promise<number> {
    return this.allocator.used('day', vnDayWindow(at).startMs);
  }
}
