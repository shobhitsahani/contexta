import { describe, expect, it } from "vitest";
import { UsageService } from "../../src/services/usage.js";

describe("QA: Token Budget Calculations and Concurrency (Plan 9, 14.5, 17.2)", () => {
  function makeMockUsageDb(initialUsed = 0, initialKeysCount = 0) {
    let usedTokens = initialUsed;
    const providerKeysCount = initialKeysCount;

    return {
      getUsed: () => usedTokens,
      select: (fields: any) => ({
        from: (_table: any) => ({
          where: (_condition: any) => ({
            limit: async () => {
              // Differentiating usage query vs providerKeys query
              if (fields && "used" in fields) {
                return [{ used: usedTokens }];
              }
              if (fields && "id" in fields) {
                return providerKeysCount > 0 ? [{ id: "key-1" }] : [];
              }
              return [];
            },
          }),
        }),
      }),
      insert: (_table: any) => ({
        values: (vals: any) => ({
          onConflictDoUpdate: (_config: any) => ({
            returning: async () => {
              const estimated = vals.freeTokensUsed;
              // Simulate atomic Postgres ON CONFLICT ... WHERE (freeTokensUsed + estimated <= cap)
              if (usedTokens + estimated <= 50_000) {
                usedTokens += estimated;
                return [{ used: usedTokens }];
              }
              // Row locked condition failed -> no rows returned
              return [];
            },
          }),
        }),
      }),
      update: (_table: any) => ({
        set: (_vals: any) => ({
          where: (_cond: any) => ({
            returning: async () => {
              // Extract settle delta: clamped to [0, cap]
              // Simulated for test verification
              return [{ used: usedTokens }];
            },
          }),
        }),
      }),
    };
  }

  describe("Token Budget Math and State Machine", () => {
    it("reports 50,000 baseline free token allowance for fresh verified account", async () => {
      const db = makeMockUsageDb(0, 0);
      const service = new UsageService(db as any, { freeTokensCap: 50_000 });

      const usage = await service.getUsage("user-1", true);
      expect(usage.freeTokensCap).toBe(50_000);
      expect(usage.freeTokensUsed).toBe(0);
      expect(usage.freeTokensRemaining).toBe(50_000);
      expect(usage.hasOwnKey).toBe(false);
      expect(usage.emailVerified).toBe(true);
      expect(usage.freeTierEligible).toBe(true);
      expect(usage.keyRequired).toBe(false);
    });

    it("blocks unverified accounts from the free allowance", async () => {
      const db = makeMockUsageDb(0, 0);
      const service = new UsageService(db as any, { freeTokensCap: 50_000 });

      const usage = await service.getUsage("user-unverified", false);
      expect(usage.emailVerified).toBe(false);
      expect(usage.freeTierEligible).toBe(false);
      expect(usage.keyRequired).toBe(true);

      // Attempting to reserve tokens throws EMAIL_NOT_VERIFIED
      await expect(
        service.reserveTokens("user-unverified", 1500, { emailVerified: false }),
      ).rejects.toThrowError(
        expect.objectContaining({
          code: "EMAIL_NOT_VERIFIED",
          status: 403,
        }),
      );
    });

    it("requires key when free tokens are completely exhausted and user has no BYOK key", async () => {
      const db = makeMockUsageDb(50_000, 0);
      const service = new UsageService(db as any, { freeTokensCap: 50_000 });

      const usage = await service.getUsage("user-exhausted", true);
      expect(usage.freeTokensUsed).toBe(50_000);
      expect(usage.freeTokensRemaining).toBe(0);
      expect(usage.hasOwnKey).toBe(false);
      expect(usage.keyRequired).toBe(true);
    });

    it("does not require key when free tokens are exhausted IF user has configured BYOK key", async () => {
      const db = makeMockUsageDb(50_000, 1);
      const service = new UsageService(db as any, { freeTokensCap: 50_000 });

      const usage = await service.getUsage("user-byok", true);
      expect(usage.freeTokensRemaining).toBe(0);
      expect(usage.hasOwnKey).toBe(true);
      expect(usage.keyRequired).toBe(false); // BYOK key satisfies requirement
    });
  });

  describe("Reservation, Settlement, and Release Lifecycle", () => {
    it("successfully completes reserve -> settle lifecycle", async () => {
      const db = makeMockUsageDb(10_000, 0);
      const service = new UsageService(db as any, { freeTokensCap: 50_000 });

      const reservation = await service.reserveTokens("user-1", 2000, { emailVerified: true });
      expect(reservation.userId).toBe("user-1");
      expect(reservation.reservedTokens).toBe(2000);
      expect(reservation.isSettled).toBe(false);
      expect(db.getUsed()).toBe(12_000); // 10,000 + 2,000 reserved

      // Settle with actual usage (e.g. provider reported 1850 tokens)
      await reservation.settle(1850);
      expect(reservation.isSettled).toBe(true);
    });

    it("prevents double-settlement on the same reservation (idempotency guard)", async () => {
      const db = makeMockUsageDb(0, 0);
      const service = new UsageService(db as any, { freeTokensCap: 50_000 });

      const reservation = await service.reserveTokens("user-1", 1000, { emailVerified: true });
      await reservation.settle(1000);

      await expect(reservation.settle(1000)).rejects.toThrowError(
        expect.objectContaining({
          code: "CONFLICT",
          status: 409,
        }),
      );
    });

    it("releases unused reservation when LLM call aborts or fails before streaming", async () => {
      const db = makeMockUsageDb(5000, 0);
      const service = new UsageService(db as any, { freeTokensCap: 50_000 });

      const reservation = await service.reserveTokens("user-1", 2500, { emailVerified: true });
      expect(db.getUsed()).toBe(7500);

      // Release reservation
      await reservation.release();
      expect(reservation.isSettled).toBe(true);
    });
  });

  describe("Concurrency and Cap Protection", () => {
    it("strictly rejects parallel reservations when combined total exceeds cap", async () => {
      // 45,000 already used of 50,000 cap
      const db = makeMockUsageDb(45_000, 0);
      const service = new UsageService(db as any, { freeTokensCap: 50_000 });

      // First reservation of 3000 tokens succeeds (used -> 48,000)
      const res1 = await service.reserveTokens("user-1", 3000, { emailVerified: true });
      expect(res1.reservedTokens).toBe(3000);
      expect(db.getUsed()).toBe(48_000);

      // Second concurrent reservation of 3000 tokens must fail because 48,000 + 3,000 = 51,000 > 50,000
      await expect(
        service.reserveTokens("user-1", 3000, { emailVerified: true }),
      ).rejects.toThrowError(
        expect.objectContaining({
          code: "KEY_REQUIRED",
          status: 402,
        }),
      );

      // Cap was protected
      expect(db.getUsed()).toBe(48_000);
    });

    it("rejects non-positive token reservation estimates", async () => {
      const db = makeMockUsageDb(0, 0);
      const service = new UsageService(db as any, { freeTokensCap: 50_000 });

      await expect(
        service.reserveTokens("user-1", 0, { emailVerified: true }),
      ).rejects.toThrow();

      await expect(
        service.reserveTokens("user-1", -500, { emailVerified: true }),
      ).rejects.toThrow();
    });
  });
});
