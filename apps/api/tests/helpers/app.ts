import type { Provider } from '@contexta/shared';
import type { RequestHandler } from 'express';
import type { Env } from '../../src/config/env.js';
import { getEnv } from '../../src/config/env.js';
import { createApp, type RateLimitConfig } from '../../src/app.js';
import type { EmailMessage, EmailSender } from '../../src/auth/email.js';
import type { Db } from '../../src/db/client.js';
import { AppError } from '../../src/lib/errors.js';
import { createSilentLogger } from '../../src/lib/logger.js';
import type { SessionResolver } from '../../src/middleware/auth.js';
import { MemoryRateLimitStore } from '../../src/middleware/rateLimit.js';
import { parseMasterKey } from '../../src/services/keys.js';
import type { ProviderValidator } from '../../src/services/providerValidation.js';
import { createTestSessionResolver } from './seed.js';

export class FakeProviderValidator implements ProviderValidator {
  readonly calls: Array<{ provider: Provider; apiKey: string }> = [];
  error: Error | null = null;

  async validate(provider: Provider, apiKey: string): Promise<void> {
    this.calls.push({ provider, apiKey });
    if (this.error) throw this.error;
  }
}

export class RecordingEmailSender implements EmailSender {
  readonly messages: EmailMessage[] = [];

  async send(message: EmailMessage): Promise<void> {
    this.messages.push(message);
  }
}

export const HIGH_RATE_LIMITS: RateLimitConfig = {
  authIp: { limit: 10_000, windowMs: 60_000 },
  chats: { limit: 10_000, windowMs: 60_000 },
  settings: { limit: 10_000, windowMs: 60_000 },
  usage: { limit: 10_000, windowMs: 60_000 },
};

export function testEnv(overrides: Partial<Env> = {}): Env {
  return {
    ...getEnv(),
    FREE_TOKEN_CAP: 5_000,
    TRUST_PROXY: 0,
    ...overrides,
  };
}

export interface TestAppOptions {
  db: Db;
  env?: Partial<Env>;
  rateLimits?: RateLimitConfig;
  validator?: FakeProviderValidator;
  authHandler?: RequestHandler;
  sessionResolver?: SessionResolver;
}

export function createTestApp(options: TestAppOptions) {
  const env = testEnv(options.env);
  const validator = options.validator ?? new FakeProviderValidator();
  const app = createApp({
    env,
    db: options.db,
    logger: createSilentLogger(),
    sessionResolver:
      options.sessionResolver ?? createTestSessionResolver(options.db),
    authHandler: options.authHandler,
    rateLimitStore: new MemoryRateLimitStore(),
    rateLimits: options.rateLimits ?? HIGH_RATE_LIMITS,
    masterKey: parseMasterKey(env.KEY_ENCRYPTION_SECRET),
    providerValidator: validator,
  });
  return { app, env, validator };
}

export function forbiddenProviderKeyError(): AppError {
  return AppError.providerKeyInvalid();
}
