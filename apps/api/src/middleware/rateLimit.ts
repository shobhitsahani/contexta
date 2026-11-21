import type { Request, RequestHandler } from 'express';
import { Redis } from 'ioredis';
import { AppError } from '../lib/errors.js';
import type { Logger } from '../lib/logger.js';

export interface RateLimitResult {
  count: number;
  resetAt: number;
}

export interface RateLimitStore {
  increment(key: string, windowMs: number): Promise<RateLimitResult>;
  close?(): Promise<void>;
}

interface MemoryEntry {
  count: number;
  expiresAt: number;
}

/** In-memory fixed-window store for local development and tests. */
export class MemoryRateLimitStore implements RateLimitStore {
  private readonly entries = new Map<string, MemoryEntry>();
  private operations = 0;

  async increment(key: string, windowMs: number): Promise<RateLimitResult> {
    const now = Date.now();
    this.operations += 1;
    if (this.operations % 500 === 0) {
      this.prune(now);
    }
    const existing = this.entries.get(key);
    if (!existing || existing.expiresAt <= now) {
      const entry = { count: 1, expiresAt: now + windowMs };
      this.entries.set(key, entry);
      return { count: entry.count, resetAt: entry.expiresAt };
    }
    existing.count += 1;
    return { count: existing.count, resetAt: existing.expiresAt };
  }

  private prune(now: number): void {
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= now) this.entries.delete(key);
    }
  }

  async close(): Promise<void> {
    this.entries.clear();
  }
}

const INCREMENT_SCRIPT = `
local current = redis.call('INCR', KEYS[1])
if current == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
return current
`;

/**
 * Redis fixed-window store. Keys are bucketed by window so resets are aligned
 * and old buckets expire on their own. Lua makes INCR+EXPIRE atomic.
 */
export class RedisRateLimitStore implements RateLimitStore {
  constructor(private readonly client: Redis) {}

  async increment(key: string, windowMs: number): Promise<RateLimitResult> {
    const bucket = Math.floor(Date.now() / windowMs);
    const bucketKey = `${key}:${bucket}`;
    const count = Number(
      await this.client.eval(
        INCREMENT_SCRIPT,
        1,
        bucketKey,
        String(windowMs + 1_000),
      ),
    );
    return {
      count: Number.isFinite(count) ? count : 0,
      resetAt: (bucket + 1) * windowMs,
    };
  }

  async close(): Promise<void> {
    await this.client.quit();
  }
}

export interface RateLimitStoreOptions {
  redisUrl?: string;
  logger: Logger;
}

export function createRateLimitStore(
  options: RateLimitStoreOptions,
): RateLimitStore {
  if (!options.redisUrl) {
    options.logger.warn('rate_limit_memory_fallback', {
      reason: 'REDIS_URL not configured',
    });
    return new MemoryRateLimitStore();
  }
  const client = new Redis(options.redisUrl, {
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    lazyConnect: false,
  });
  client.on('error', (error: Error) => {
    options.logger.warn('redis_error', { errorName: error.name });
  });
  return new RedisRateLimitStore(client);
}

export type RateLimitIdentifier = (req: Request) => string | null;

export function ipIdentifier(req: Request): string {
  return req.ip ?? req.socket.remoteAddress ?? 'unknown-ip';
}

export function userIdentifier(req: Request): string | null {
  return req.user?.id ?? null;
}

export interface RateLimiterOptions {
  store: RateLimitStore;
  logger: Logger;
  name: string;
  limit: number;
  windowMs: number;
  identify: RateLimitIdentifier;
}

/**
 * Fixed-window rate limiter. Fails open if the store is unavailable so a Redis
 * outage does not take down authentication; the failure is logged.
 */
export function createRateLimiter(options: RateLimiterOptions): RequestHandler {
  return (req, res, next) => {
    void (async () => {
      const identifier = options.identify(req);
      if (!identifier) {
        next();
        return;
      }
      const key = `rl:${options.name}:${identifier}`;
      try {
        const result = await options.store.increment(key, options.windowMs);
        const remaining = Math.max(0, options.limit - result.count);
        const resetSeconds = Math.max(
          0,
          Math.ceil((result.resetAt - Date.now()) / 1000),
        );
        res.setHeader('RateLimit-Limit', String(options.limit));
        res.setHeader('RateLimit-Remaining', String(remaining));
        res.setHeader('RateLimit-Reset', String(resetSeconds));
        if (result.count > options.limit) {
          res.setHeader('Retry-After', String(Math.max(1, resetSeconds)));
          throw AppError.rateLimited();
        }
        next();
      } catch (error) {
        if (error instanceof AppError) {
          next(error);
          return;
        }
        options.logger.warn('rate_limit_store_error', {
          limiter: options.name,
          errorName: error instanceof Error ? error.name : 'UnknownError',
        });
        // Fail open: availability over strict limiting during a Redis outage.
        next();
      }
    })();
  };
}
