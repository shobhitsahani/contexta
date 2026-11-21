import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppError } from '../../src/lib/errors.js';
import { UsageService } from '../../src/services/usage.js';
import { seedProviderKey, seedUser } from '../helpers/seed.js';
import {
  createTestDatabase,
  type TestDatabase,
} from '../helpers/testDb.js';

describe('UsageService', () => {
  let database: TestDatabase;
  let service: UsageService;
  let userId: string;

  beforeEach(async () => {
    database = await createTestDatabase();
    const user = await seedUser(database.db, { emailVerified: true });
    userId = user.id;
    service = new UsageService(database.db, { freeTokensCap: 1_000 });
  });

  afterEach(async () => {
    await database.close();
  });

  it('starts with the full allowance', async () => {
    const snapshot = await service.getUsage(userId, true);
    expect(snapshot).toMatchObject({
      freeTokensUsed: 0,
      freeTokensCap: 1_000,
      freeTokensRemaining: 1_000,
      hasOwnKey: false,
      emailVerified: true,
      freeTierEligible: true,
      keyRequired: false,
    });
  });

  it('reserves and settles atomically', async () => {
    const reservation = await service.reserveTokens(userId, 300, {
      emailVerified: true,
    });
    expect((await service.getUsage(userId, true)).freeTokensUsed).toBe(300);

    const used = await reservation.settle(200);
    expect(used).toBe(200);
    expect((await service.getUsage(userId, true)).freeTokensRemaining).toBe(800);
  });

  it('releases a reservation when the upstream call fails', async () => {
    const reservation = await service.reserveTokens(userId, 400, {
      emailVerified: true,
    });
    await reservation.release();
    expect(await service.getFreeTokensUsed(userId)).toBe(0);
  });

  it('rejects a reservation that would pass the cap', async () => {
    await service.reserveTokens(userId, 800, { emailVerified: true });
    await expect(
      service.reserveTokens(userId, 201, { emailVerified: true }),
    ).rejects.toMatchObject({ status: 402, code: 'KEY_REQUIRED' });
    expect(await service.getFreeTokensUsed(userId)).toBe(800);
  });

  it('allows the exact remaining amount and then blocks', async () => {
    const reservation = await service.reserveTokens(userId, 1_000, {
      emailVerified: true,
    });
    expect(reservation.reservedTokens).toBe(1_000);
    await expect(
      service.reserveTokens(userId, 1, { emailVerified: true }),
    ).rejects.toMatchObject({ code: 'KEY_REQUIRED' });
  });

  it('never overshoots under parallel reservations', async () => {
    const attempts = Array.from({ length: 10 }, () =>
      service.reserveTokens(userId, 200, { emailVerified: true }),
    );
    const results = await Promise.allSettled(attempts);
    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    const rejected = results.filter((result) => result.status === 'rejected');

    expect(fulfilled).toHaveLength(5);
    expect(rejected).toHaveLength(5);
    expect(await service.getFreeTokensUsed(userId)).toBe(1_000);
  });

  it('clamps settlement to the cap', async () => {
    const reservation = await service.reserveTokens(userId, 900, {
      emailVerified: true,
    });
    const used = await reservation.settle(50_000);
    expect(used).toBe(1_000);
  });

  it('blocks unverified users from the free tier', async () => {
    await expect(
      service.reserveTokens(userId, 100, { emailVerified: false }),
    ).rejects.toMatchObject({ code: 'EMAIL_NOT_VERIFIED' });
    await expect(
      service.reserveTokens(userId, 100, { emailVerified: false }),
    ).rejects.toBeInstanceOf(AppError);
  });

  it('rejects invalid estimates and double settlement', async () => {
    await expect(
      service.reserveTokens(userId, 0, { emailVerified: true }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    const reservation = await service.reserveTokens(userId, 100, {
      emailVerified: true,
    });
    await reservation.settle(50);
    await expect(reservation.settle(60)).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });

  it('reports key ownership and key-required state', async () => {
    await service.addFreeTokensUsed(userId, 0);
    await database.db
      .update((await import('../../src/db/schema.js')).usage)
      .set({ freeTokensUsed: 1_000 });
    let snapshot = await service.getUsage(userId, true);
    expect(snapshot.keyRequired).toBe(true);

    await seedProviderKey(database.db, userId, 'openai');
    snapshot = await service.getUsage(userId, true);
    expect(snapshot.hasOwnKey).toBe(true);
    expect(snapshot.keyRequired).toBe(false);
    expect(await service.hasProviderKey(userId)).toBe(true);
    expect(await service.getProviderKeyConfigured(userId, 'openai')).toBe(true);
    expect(await service.getProviderKeyConfigured(userId, 'gemini')).toBe(false);
  });

  it('reports unverified users as ineligible', async () => {
    const snapshot = await service.getUsage(userId, false);
    expect(snapshot.emailVerified).toBe(false);
    expect(snapshot.freeTierEligible).toBe(false);
    expect(snapshot.keyRequired).toBe(true);
  });

  it('supports the compatibility add path with clamping', async () => {
    expect(await service.addFreeTokensUsed(userId, 400)).toBe(400);
    expect(await service.addFreeTokensUsed(userId, 5_000)).toBe(1_000);
    expect(await service.isFreeTierExhausted(userId)).toBe(true);
  });
});
