import { and, eq, sql } from 'drizzle-orm';
import type { UsageResponse } from '@contexta/shared';
import type { Db } from '../db/client.js';
import { providerKeys, usage } from '../db/schema.js';
import { AppError } from '../lib/errors.js';

export interface UsageServiceOptions {
  freeTokensCap: number;
}

/**
 * A reservation is charged optimistically before an LLM call. Settlement
 * replaces the estimate with actual provider-reported tokens; release restores
 * the whole estimate when the call never happened.
 */
export class TokenReservation {
  private settled = false;

  constructor(
    private readonly service: UsageService,
    readonly userId: string,
    readonly reservedTokens: number,
  ) {}

  get isSettled(): boolean {
    return this.settled;
  }

  async settle(actualTokens: number): Promise<number> {
    if (this.settled) {
      throw AppError.conflict('CONFLICT', 'Token reservation already settled.');
    }
    this.settled = true;
    return this.service.settle(this.userId, this.reservedTokens, actualTokens);
  }

  async release(): Promise<number> {
    return this.settle(0);
  }
}

/**
 * Server-side free-tier budget. All mutations are single SQL statements so
 * parallel requests cannot overshoot the cap.
 */
export class UsageService {
  readonly cap: number;

  constructor(
    private readonly db: Db,
    options: UsageServiceOptions,
  ) {
    if (!Number.isInteger(options.freeTokensCap) || options.freeTokensCap <= 0) {
      throw new Error('FREE_TOKEN_CAP must be a positive integer.');
    }
    this.cap = options.freeTokensCap;
  }

  async getUsage(
    userId: string,
    emailVerified: boolean,
  ): Promise<UsageResponse> {
    const [usageRows, keyRows] = await Promise.all([
      this.db
        .select({ used: usage.freeTokensUsed })
        .from(usage)
        .where(eq(usage.userId, userId))
        .limit(1),
      this.db
        .select({ id: providerKeys.id })
        .from(providerKeys)
        .where(eq(providerKeys.userId, userId))
        .limit(1),
    ]);
    const used = usageRows[0]?.used ?? 0;
    const hasOwnKey = keyRows.length > 0;
    const remaining = Math.max(0, this.cap - used);
    return {
      freeTokensUsed: used,
      freeTokensCap: this.cap,
      freeTokensRemaining: remaining,
      hasOwnKey,
      emailVerified,
      freeTierEligible: emailVerified,
      keyRequired: !hasOwnKey && (!emailVerified || remaining === 0),
    };
  }

  async hasProviderKey(userId: string): Promise<boolean> {
    const rows = await this.db
      .select({ id: providerKeys.id })
      .from(providerKeys)
      .where(eq(providerKeys.userId, userId))
      .limit(1);
    return rows.length > 0;
  }

  /**
   * Atomically reserves tokens. The INSERT...ON CONFLICT...WHERE form makes the
   * cap check and increment one row-locked statement.
   */
  async reserveTokens(
    userId: string,
    estimatedTokens: number,
    options: { emailVerified: boolean },
  ): Promise<TokenReservation> {
    if (!options.emailVerified) {
      throw AppError.emailNotVerified();
    }
    if (!Number.isInteger(estimatedTokens) || estimatedTokens <= 0) {
      throw AppError.badRequest(
        'Token estimate must be a positive integer.',
        'BAD_REQUEST',
      );
    }
    if (estimatedTokens > this.cap) {
      throw AppError.keyRequired();
    }

    const rows = await this.db
      .insert(usage)
      .values({
        userId,
        freeTokensUsed: estimatedTokens,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: usage.userId,
        set: {
          freeTokensUsed: sql`${usage.freeTokensUsed} + ${estimatedTokens}`,
          updatedAt: new Date(),
        },
        setWhere: sql`${usage.freeTokensUsed} + ${estimatedTokens} <= ${this.cap}`,
      })
      .returning({ used: usage.freeTokensUsed });

    if (rows.length === 0) {
      throw AppError.keyRequired();
    }

    return new TokenReservation(this, userId, estimatedTokens);
  }

  /** Applies actual usage, clamping to [0, cap]. */
  async settle(
    userId: string,
    reservedTokens: number,
    actualTokens: number,
  ): Promise<number> {
    if (!Number.isInteger(actualTokens) || actualTokens < 0) {
      throw AppError.badRequest(
        'Actual token usage must be non-negative.',
        'BAD_REQUEST',
      );
    }
    const delta = actualTokens - reservedTokens;
    const rows = await this.db
      .update(usage)
      .set({
        freeTokensUsed: sql`LEAST(${this.cap}, GREATEST(0, ${usage.freeTokensUsed} + ${delta}))`,
        updatedAt: new Date(),
      })
      .where(eq(usage.userId, userId))
      .returning({ used: usage.freeTokensUsed });
    return rows[0]?.used ?? 0;
  }

  /** Compatibility helper for the messages stream's UsageDB contract. */
  async getFreeTokensUsed(userId: string): Promise<number> {
    const rows = await this.db
      .select({ used: usage.freeTokensUsed })
      .from(usage)
      .where(eq(usage.userId, userId))
      .limit(1);
    return rows[0]?.used ?? 0;
  }

  /** Non-atomic compatibility path; prefer reserve/settle for new code. */
  async addFreeTokensUsed(userId: string, tokens: number): Promise<number> {
    if (!Number.isInteger(tokens) || tokens < 0) {
      throw AppError.badRequest(
        'Token usage must be non-negative.',
        'BAD_REQUEST',
      );
    }
    const rows = await this.db
      .insert(usage)
      .values({ userId, freeTokensUsed: Math.min(tokens, this.cap) })
      .onConflictDoUpdate({
        target: usage.userId,
        set: {
          freeTokensUsed: sql`LEAST(${this.cap}, ${usage.freeTokensUsed} + ${tokens})`,
          updatedAt: new Date(),
        },
      })
      .returning({ used: usage.freeTokensUsed });
    return rows[0]?.used ?? 0;
  }

  async isFreeTierExhausted(userId: string): Promise<boolean> {
    return (await this.getFreeTokensUsed(userId)) >= this.cap;
  }

  async getProviderKeyConfigured(
    userId: string,
    provider: string,
  ): Promise<boolean> {
    const rows = await this.db
      .select({ id: providerKeys.id })
      .from(providerKeys)
      .where(
        and(
          eq(providerKeys.userId, userId),
          eq(providerKeys.provider, provider),
        ),
      )
      .limit(1);
    return rows.length > 0;
  }
}

const DEFAULT_OUTPUT_RESERVE = 1_500;

/** Cheap conservative estimate used for reservations (4 chars ~ 1 token). */
export function estimateTokens(
  text: string,
  outputReserve = DEFAULT_OUTPUT_RESERVE,
): number {
  return Math.ceil(text.length / 4) + outputReserve;
}
