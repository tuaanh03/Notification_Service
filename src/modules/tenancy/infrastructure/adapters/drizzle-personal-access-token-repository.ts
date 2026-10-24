import { and, count, desc, eq, gt, isNull, or, type SQL } from 'drizzle-orm';
import type { TransactionContext } from '../../../../shared/db/index.ts';
import {
  AdminId,
  PersonalAccessTokenId,
  type AdminId as AdminIdType,
  type PersonalAccessTokenId as PersonalAccessTokenIdType,
} from '../../../../shared/kernel/index.ts';
import type { PersonalAccessTokenRepository } from '../../application/ports/index.ts';
import { PersonalAccessToken } from '../../domain/entities/personal-access-token.ts';
import { personalAccessTokens as pat } from '../db/schema.ts';

export class DrizzlePersonalAccessTokenRepository implements PersonalAccessTokenRepository {
  private readonly transactions: TransactionContext;

  constructor(deps: { transactions: TransactionContext }) {
    this.transactions = deps.transactions;
  }

  async insert(token: PersonalAccessToken): Promise<void> {
    await this.transactions.executor().insert(pat).values({
      tokenId: token.id,
      adminId: token.adminId,
      name: token.name,
      tokenHash: token.tokenHash,
      hint: token.hint,
      scope: token.scope,
      expiresAt: token.expiresAt,
      lastUsedAt: token.lastUsedAt,
      lastUsedIp: token.lastUsedIp,
      revokedAt: token.revokedAt,
      createdAt: token.createdAt,
      updatedAt: token.updatedAt,
    });
  }

  async findByTokenHash(tokenHash: string): Promise<PersonalAccessToken | null> {
    const [row] = await this.transactions.executor().select().from(pat).where(eq(pat.tokenHash, tokenHash));
    return row ? toEntity(row) : null;
  }

  async findById(id: PersonalAccessTokenIdType): Promise<PersonalAccessToken | null> {
    const [row] = await this.transactions.executor().select().from(pat).where(eq(pat.tokenId, id));
    return row ? toEntity(row) : null;
  }

  async listByAdmin(adminId: AdminIdType, since: Date): Promise<PersonalAccessToken[]> {
    const rows = await this.transactions
      .executor()
      .select()
      .from(pat)
      .where(and(eq(pat.adminId, adminId), recentlyRelevant(since)))
      .orderBy(desc(pat.createdAt), desc(pat.tokenId));
    return rows.map(toEntity);
  }

  async listAll(filter: { activeAt?: Date | undefined; since: Date; limit: number }): Promise<PersonalAccessToken[]> {
    const where = filter.activeAt === undefined ? recentlyRelevant(filter.since) : activeAt(filter.activeAt);
    const rows = await this.transactions
      .executor()
      .select()
      .from(pat)
      .where(where)
      .orderBy(desc(pat.createdAt), desc(pat.tokenId))
      .limit(filter.limit);
    return rows.map(toEntity);
  }

  async countActive(adminId: AdminIdType, at: Date): Promise<number> {
    const [row] = await this.transactions
      .executor()
      .select({ n: count() })
      .from(pat)
      .where(and(eq(pat.adminId, adminId), activeAt(at)));
    return row?.n ?? 0;
  }

  async updateRevoked(token: PersonalAccessToken): Promise<void> {
    await this.transactions
      .executor()
      .update(pat)
      .set({ revokedAt: token.revokedAt, updatedAt: token.updatedAt })
      .where(eq(pat.tokenId, token.id));
  }

  async updateLastUsed(token: PersonalAccessToken): Promise<void> {
    await this.transactions
      .executor()
      .update(pat)
      .set({ lastUsedAt: token.lastUsedAt, lastUsedIp: token.lastUsedIp })
      .where(eq(pat.tokenId, token.id));
  }
}

/** Chưa thu hồi và chưa hết hạn ở thời điểm `at`. */
function activeAt(at: Date): SQL {
  return and(isNull(pat.revokedAt), gt(pat.expiresAt, at))!;
}

/** Còn hiệu lực, hoặc mới thu hồi / mới hết hạn sau `since` — token chết lâu rồi thì thôi hiện. */
function recentlyRelevant(since: Date): SQL {
  return or(and(isNull(pat.revokedAt), gt(pat.expiresAt, since)), gt(pat.revokedAt, since))!;
}

function toEntity(row: typeof pat.$inferSelect): PersonalAccessToken {
  return new PersonalAccessToken({
    id: PersonalAccessTokenId.parse(row.tokenId),
    adminId: AdminId.parse(row.adminId),
    name: row.name,
    tokenHash: row.tokenHash,
    hint: row.hint,
    scope: row.scope,
    expiresAt: row.expiresAt,
    lastUsedAt: row.lastUsedAt,
    lastUsedIp: row.lastUsedIp,
    revokedAt: row.revokedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}
