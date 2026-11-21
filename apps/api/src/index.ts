import 'dotenv/config';
import { toNodeHandler } from 'better-auth/node';
import { createAuth } from './auth/auth.js';
import { createEmailSender } from './auth/email.js';
import { createApp } from './app.js';
import { getEnv } from './config/env.js';
import { createDatabase } from './db/client.js';
import { createLogger } from './lib/logger.js';
import {
  createBetterAuthSessionResolver,
} from './middleware/auth.js';
import { createRateLimitStore } from './middleware/rateLimit.js';
import { parseMasterKey } from './services/keys.js';
import { createProviderValidator } from './services/providerValidation.js';

async function main(): Promise<void> {
  const env = getEnv();
  const logger = createLogger({
    level: env.NODE_ENV === 'production' ? 'info' : 'debug',
  });

  const { db, pool } = createDatabase(env.DATABASE_URL);
  const emailSender = createEmailSender({
    apiKey: env.RESEND_API_KEY,
    from: env.EMAIL_FROM,
  });
  const auth = createAuth({ db, env, emailSender, logger });
  const masterKey = parseMasterKey(env.KEY_ENCRYPTION_SECRET);
  const rateLimitStore = createRateLimitStore({
    redisUrl: env.REDIS_URL,
    logger,
  });
  const providerValidator = createProviderValidator({
    timeoutMs: env.PROVIDER_TIMEOUT_MS,
  });

  const app = createApp({
    env,
    db,
    logger,
    sessionResolver: createBetterAuthSessionResolver(auth),
    authHandler: toNodeHandler(auth),
    rateLimitStore,
    rateLimits: {
      authIp: {
        limit: env.AUTH_IP_RATE_LIMIT_MAX,
        windowMs: env.AUTH_IP_RATE_LIMIT_WINDOW_MS,
      },
      chats: {
        limit: env.CHAT_USER_RATE_LIMIT_MAX,
        windowMs: env.CHAT_USER_RATE_LIMIT_WINDOW_MS,
      },
      settings: {
        limit: env.SETTINGS_USER_RATE_LIMIT_MAX,
        windowMs: env.SETTINGS_USER_RATE_LIMIT_WINDOW_MS,
      },
      usage: {
        limit: env.USAGE_USER_RATE_LIMIT_MAX,
        windowMs: env.USAGE_USER_RATE_LIMIT_WINDOW_MS,
      },
    },
    masterKey,
    providerValidator,
  });

  const server = app.listen(env.PORT, () => {
    logger.info('api_started', { port: env.PORT });
  });

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info('api_shutdown', { signal });
    server.close();
    await rateLimitStore.close?.();
    await pool.end();
    process.exit(0);
  };

  process.on('SIGINT', () => {
    void shutdown('SIGINT');
  });
  process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
  });
}

main().catch((error: unknown) => {
  // Do not print environment values or request bodies.
  console.error(
    'API failed to start:',
    error instanceof Error ? error.message : 'Unknown error',
  );
  process.exitCode = 1;
});
