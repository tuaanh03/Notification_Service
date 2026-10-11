import { and, desc, eq, inArray, lt } from 'drizzle-orm';
import { duplicateKeyName, type TransactionContext } from '../../../../shared/db/index.ts';
import {
  AppId,
  IncomingCallId,
  IncomingHookId,
  PublicationId,
  TemplateId,
  TopicId,
  type AppId as AppIdType,
  type IncomingHookId as IncomingHookIdType,
} from '../../../../shared/kernel/index.ts';
import { IncomingSlotTakenError } from '../../application/errors.ts';
import type { IncomingCallRepository, IncomingHookRepository } from '../../application/ports/index.ts';
import type { IncomingCall } from '../../domain/entities/incoming-call.ts';
import { IncomingHook } from '../../domain/entities/incoming-hook.ts';
import { incomingCalls, incomingHooks } from '../db/schema.ts';

type HookRow = typeof incomingHooks.$inferSelect;

export class DrizzleIncomingHookRepository implements IncomingHookRepository {
  private readonly transactions: TransactionContext;

  constructor(deps: { transactions: TransactionContext }) {
    this.transactions = deps.transactions;
  }

  async insert(h: IncomingHook): Promise<void> {
    try {
      await this.transactions.executor().insert(incomingHooks).values({
        hookId: h.id,
        appId: h.appId,
        slot: h.slot,
        name: h.name,
        topicId: h.topicId,
        templateId: h.templateId,
        mappings: [...h.mappings],
        dedupePath: h.dedupePath,
        condition: h.condition,
        tokenHash: h.tokenHash,
        tokenHint: h.tokenHint,
        status: h.status,
        createdBy: h.createdBy,
        createdAt: h.createdAt,
        updatedAt: h.updatedAt,
      });
    } catch (err) {
      if (duplicateKeyName(err) === 'uq_incoming_hooks_app_slot') throw new IncomingSlotTakenError();
      throw err;
    }
  }

  async findById(id: IncomingHookIdType): Promise<IncomingHook | null> {
    const [row] = await this.transactions.executor().select().from(incomingHooks).where(eq(incomingHooks.hookId, id));
    return row ? toHook(row) : null;
  }

  async findByTokenHash(hash: string): Promise<IncomingHook | null> {
    const [row] = await this.transactions.executor().select().from(incomingHooks).where(eq(incomingHooks.tokenHash, hash));
    return row ? toHook(row) : null;
  }

  async listByApp(appId: AppIdType): Promise<IncomingHook[]> {
    const rows = await this.transactions
      .executor()
      .select()
      .from(incomingHooks)
      .where(eq(incomingHooks.appId, appId))
      .orderBy(incomingHooks.slot);
    return rows.map(toHook);
  }

  async update(h: IncomingHook): Promise<void> {
    await this.transactions
      .executor()
      .update(incomingHooks)
      .set({
        name: h.name,
        topicId: h.topicId,
        templateId: h.templateId,
        mappings: [...h.mappings],
        dedupePath: h.dedupePath,
        condition: h.condition,
        tokenHash: h.tokenHash,
        tokenHint: h.tokenHint,
        status: h.status,
        updatedAt: h.updatedAt,
      })
      .where(eq(incomingHooks.hookId, h.id));
  }

  async delete(id: IncomingHookIdType): Promise<void> {
    await this.transactions.executor().delete(incomingHooks).where(eq(incomingHooks.hookId, id));
  }
}

export class DrizzleIncomingCallRepository implements IncomingCallRepository {
  private readonly transactions: TransactionContext;

  constructor(deps: { transactions: TransactionContext }) {
    this.transactions = deps.transactions;
  }

  async insert(c: IncomingCall): Promise<void> {
    await this.transactions.executor().insert(incomingCalls).values({
      callId: c.id,
      hookId: c.hookId,
      appId: c.appId,
      at: c.at,
      httpStatus: c.httpStatus,
      outcome: c.outcome,
      publicationId: c.publicationId,
      recipientCount: c.recipientCount,
      errorCode: c.errorCode,
    });
  }

  async listRecent(hookId: IncomingHookIdType, limit: number): Promise<IncomingCall[]> {
    const rows = await this.transactions
      .executor()
      .select()
      .from(incomingCalls)
      .where(eq(incomingCalls.hookId, hookId))
      .orderBy(desc(incomingCalls.at), desc(incomingCalls.callId))
      .limit(limit);
    return rows.map((r) => ({
      id: IncomingCallId.parse(r.callId),
      hookId: IncomingHookId.parse(r.hookId),
      appId: AppId.parse(r.appId),
      at: r.at,
      httpStatus: r.httpStatus,
      outcome: r.outcome,
      publicationId: r.publicationId === null ? null : PublicationId.parse(r.publicationId),
      recipientCount: r.recipientCount,
      errorCode: r.errorCode,
    }));
  }

  async deleteByHook(hookId: IncomingHookIdType): Promise<void> {
    await this.transactions.executor().delete(incomingCalls).where(eq(incomingCalls.hookId, hookId));
  }

  async purgeOlderThan(before: Date, limit: number): Promise<number> {
    const executor = this.transactions.executor();
    const ids = await executor.select({ id: incomingCalls.callId }).from(incomingCalls).where(lt(incomingCalls.at, before)).limit(limit);
    if (ids.length === 0) return 0;
    await executor.delete(incomingCalls).where(and(inArray(incomingCalls.callId, ids.map((r) => r.id)), lt(incomingCalls.at, before)));
    return ids.length;
  }
}

function toHook(row: HookRow): IncomingHook {
  return new IncomingHook({
    id: IncomingHookId.parse(row.hookId),
    appId: AppId.parse(row.appId),
    slot: row.slot,
    name: row.name,
    topicId: TopicId.parse(row.topicId),
    templateId: TemplateId.parse(row.templateId),
    mappings: row.mappings,
    dedupePath: row.dedupePath,
    condition: row.condition ?? null,
    tokenHash: row.tokenHash,
    tokenHint: row.tokenHint,
    status: row.status,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}
