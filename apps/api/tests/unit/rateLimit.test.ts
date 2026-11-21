import express from 'express';
import { Redis } from 'ioredis';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createErrorHandler } from '../../src/lib/errors.js';
import { createSilentLogger } from '../../src/lib/logger.js';
import {
  MemoryRateLimitStore,
  RedisRateLimitStore,
  createRateLimiter,
  createRateLimitStore,
  ipIdentifier,
  userIdentifier,
} from '../../src/middleware/rateLimit.js';

const logger = createSilentLogger();

function buildApp(options: {
  limit: number;
  store: MemoryRateLimitStore;
  throwOnIncrement?: boolean;
}) {
  const store = options.store;
  if (options.throwOnIncrement) {
    store.increment = async () => {
      throw new Error('redis down');
    };
  }
  const app = express();
  app.get(
    '/limited',
    createRateLimiter({
      store,
      logger,
      name: 'test',
      limit: options.limit,
      windowMs: 60_000,
      identify: ipIdentifier,
    }),
    (_req, res) => {
      res.json({ ok: true });
    },
  );
  app.use(createErrorHandler(logger));
  return app;
}

describe('memory rate limit store', () => {
  it('counts within a window and resets after expiry', async () => {
    const store = new MemoryRateLimitStore();
    const first = await store.increment('key', 20);
    const second = await store.increment('key', 20);
    expect(first.count).toBe(1);
    expect(second.count).toBe(2);
    expect(second.resetAt).toBeGreaterThanOrEqual(first.resetAt);

    await new Promise((resolve) => setTimeout(resolve, 30));
    const third = await store.increment('key', 20);
    expect(third.count).toBe(1);
  });

  it('closes cleanly', async () => {
    const store = new MemoryRateLimitStore();
    await store.increment('key', 1_000);
    await store.close();
    expect((await store.increment('key', 1_000)).count).toBe(1);
  });
});

describe('rate limiter middleware', () => {
  it('allows requests up to the limit then returns 429', async () => {
    const app = buildApp({ limit: 2, store: new MemoryRateLimitStore() });

    const first = await request(app).get('/limited');
    const second = await request(app).get('/limited');
    const third = await request(app).get('/limited');

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(third.status).toBe(429);
    expect(third.body.error.code).toBe('RATE_LIMITED');
    expect(third.headers['ratelimit-limit']).toBe('2');
    expect(third.headers['ratelimit-remaining']).toBe('0');
    expect(third.headers['retry-after']).toBeDefined();
  });

  it('fails open when the store is unavailable', async () => {
    const app = buildApp({
      limit: 1,
      store: new MemoryRateLimitStore(),
      throwOnIncrement: true,
    });
    const response = await request(app).get('/limited');
    expect(response.status).toBe(200);
  });
});

describe('Redis rate limit store', () => {
  it('uses an atomic INCR script and aligned window keys', async () => {
    const calls: unknown[][] = [];
    const fakeClient = {
      eval: async (...args: unknown[]) => {
        calls.push(args);
        return 3;
      },
      quit: async () => undefined,
    } as unknown as Redis;
    const store = new RedisRateLimitStore(fakeClient);

    const result = await store.increment('rl:test:user', 60_000);
    expect(result.count).toBe(3);
    expect(result.resetAt % 60_000).toBe(0);
    expect(calls).toHaveLength(1);
    const [script, numberOfKeys, key, ttl] = calls[0]!;
    expect(String(script)).toContain('INCR');
    expect(numberOfKeys).toBe(1);
    expect(String(key)).toMatch(/^rl:test:user:\d+$/);
    expect(Number(ttl)).toBe(61_000);
  });

  it('falls back to memory without a Redis URL', async () => {
    const store = createRateLimitStore({ logger });
    expect(store).toBeInstanceOf(MemoryRateLimitStore);
    await store.close?.();
  });
});

describe('identifiers', () => {
  it('uses the authenticated user when present', () => {
    const requestLike = {
      user: { id: 'user-1' },
      ip: '1.2.3.4',
      socket: { remoteAddress: '1.2.3.4' },
    } as never;
    expect(userIdentifier(requestLike)).toBe('user-1');
    expect(ipIdentifier(requestLike)).toBe('1.2.3.4');
  });

  it('returns null for unauthenticated user identification', () => {
    const requestLike = {
      ip: '1.2.3.4',
      socket: { remoteAddress: '1.2.3.4' },
    } as never;
    expect(userIdentifier(requestLike)).toBeNull();
  });
});
