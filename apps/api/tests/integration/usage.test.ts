import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { usage } from '../../src/db/schema.js';
import {
  authHeader,
  seedProviderKey,
  seedUser,
} from '../helpers/seed.js';
import {
  HIGH_RATE_LIMITS,
  createTestApp,
} from '../helpers/app.js';
import {
  createTestDatabase,
  type TestDatabase,
} from '../helpers/testDb.js';

describe('GET /usage', () => {
  let database: TestDatabase;
  let alice: Awaited<ReturnType<typeof seedUser>>;
  let bob: Awaited<ReturnType<typeof seedUser>>;

  beforeEach(async () => {
    database = await createTestDatabase();
    alice = await seedUser(database.db, { emailVerified: true });
    bob = await seedUser(database.db, { emailVerified: false });
  });

  afterEach(async () => {
    await database.close();
  });

  it('requires authentication', async () => {
    const { app } = createTestApp({ db: database.db });
    await request(app).get('/api/usage').expect(401);
  });

  it('returns the remaining free allowance', async () => {
    const { app } = createTestApp({
      db: database.db,
      env: { FREE_TOKEN_CAP: 5_000 },
    });
    const response = await request(app)
      .get('/api/usage')
      .set(authHeader(alice.id));

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      freeTokensUsed: 0,
      freeTokensCap: 5_000,
      freeTokensRemaining: 5_000,
      hasOwnKey: false,
      emailVerified: true,
      freeTierEligible: true,
      keyRequired: false,
    });
    expect(response.headers['cache-control']).toBe('no-store');
  });

  it('reports usage, key ownership and exhausted state', async () => {
    await database.db.insert(usage).values({
      userId: alice.id,
      freeTokensUsed: 4_500,
    });
    await seedProviderKey(database.db, alice.id, 'gemini');

    const { app } = createTestApp({
      db: database.db,
      env: { FREE_TOKEN_CAP: 5_000 },
    });
    const response = await request(app)
      .get('/api/usage')
      .set(authHeader(alice.id));

    expect(response.body.freeTokensUsed).toBe(4_500);
    expect(response.body.freeTokensRemaining).toBe(500);
    expect(response.body.hasOwnKey).toBe(true);
    expect(response.body.keyRequired).toBe(false);
  });

  it('marks unverified users as ineligible', async () => {
    const { app } = createTestApp({ db: database.db });
    const response = await request(app)
      .get('/api/usage')
      .set(authHeader(bob.id));

    expect(response.body.emailVerified).toBe(false);
    expect(response.body.freeTierEligible).toBe(false);
    expect(response.body.keyRequired).toBe(true);
  });

  it('rate limits per user and leaves other users unaffected', async () => {
    const { app } = createTestApp({
      db: database.db,
      rateLimits: {
        ...HIGH_RATE_LIMITS,
        usage: { limit: 1, windowMs: 60_000 },
      },
    });

    await request(app)
      .get('/api/usage')
      .set(authHeader(alice.id))
      .expect(200);

    const limited = await request(app)
      .get('/api/usage')
      .set(authHeader(alice.id));
    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe('RATE_LIMITED');
    expect(limited.headers['retry-after']).toBeDefined();
    expect(limited.headers['ratelimit-limit']).toBe('1');

    await request(app)
      .get('/api/usage')
      .set(authHeader(bob.id))
      .expect(200);
  });
});
