import cors from 'cors';
import express, {
  type Express,
  type RequestHandler,
} from 'express';
import helmet from 'helmet';
import type { Env } from './config/env.js';
import type { Db } from './db/client.js';
import {
  createErrorHandler,
  notFoundHandler,
} from './lib/errors.js';
import type { Logger } from './lib/logger.js';
import {
  createRateLimiter,
  ipIdentifier,
  userIdentifier,
  type RateLimitStore,
} from './middleware/rateLimit.js';
import { requestId } from './middleware/requestId.js';
import {
  getRequestUser,
  requireAuth,
  type SessionResolver,
} from './middleware/auth.js';
import { createChatsRouter } from './routes/chats/index.js';
import { createSettingsRouter } from './routes/settings/index.js';
import { createUsageRouter } from './routes/usage.js';
import type { ProviderValidator } from './services/providerValidation.js';

export interface RateLimitConfig {
  authIp: { limit: number; windowMs: number };
  chats: { limit: number; windowMs: number };
  settings: { limit: number; windowMs: number };
  usage: { limit: number; windowMs: number };
}

export interface CreateAppDependencies {
  env: Env;
  db: Db;
  logger: Logger;
  sessionResolver: SessionResolver;
  /** Better Auth's toNodeHandler(auth); omitted in route-level tests. */
  authHandler?: RequestHandler;
  rateLimitStore: RateLimitStore;
  rateLimits?: RateLimitConfig;
  masterKey: Buffer;
  providerValidator: ProviderValidator;
}

function defaultRateLimits(env: Env): RateLimitConfig {
  return {
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
  };
}

export function createApp(dependencies: CreateAppDependencies): Express {
  const {
    env,
    db,
    logger,
    sessionResolver,
    authHandler,
    rateLimitStore,
    providerValidator,
    masterKey,
  } = dependencies;
  const rateLimits = dependencies.rateLimits ?? defaultRateLimits(env);
  const app = express();

  app.disable('x-powered-by');
  app.set('json escape', true);
  if (env.TRUST_PROXY > 0) {
    app.set('trust proxy', env.TRUST_PROXY);
  }

  app.use(helmet({ crossOriginResourcePolicy: false }));
  app.use(
    cors({
      origin(origin, callback) {
        // Same-origin / non-browser requests have no Origin header.
        if (!origin || origin === env.WEB_ORIGIN) {
          callback(null, true);
          return;
        }
        callback(null, false);
      },
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
      exposedHeaders: [
        'RateLimit-Limit',
        'RateLimit-Remaining',
        'RateLimit-Reset',
        'Retry-After',
        'x-request-id',
      ],
      maxAge: 600,
    }),
  );
  app.use(requestId());
  app.use((req, res, next) => {
    const startedAt = Date.now();
    res.on('finish', () => {
      logger.info('request_completed', {
        requestId: req.requestId,
        method: req.method,
        path: req.path,
        status: res.statusCode,
        durationMs: Date.now() - startedAt,
        userId: req.user?.id,
      });
    });
    next();
  });

  // Better Auth must be mounted before express.json(): body parsers consume
  // the raw request stream it needs.
  if (authHandler) {
    const authIpLimiter = createRateLimiter({
      store: rateLimitStore,
      logger,
      name: 'auth-ip',
      limit: rateLimits.authIp.limit,
      windowMs: rateLimits.authIp.windowMs,
      identify: ipIdentifier,
    });
    app.all('/api/auth/*splat', authIpLimiter, authHandler);
  }

  app.use(express.json({ limit: '1mb' }));

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  const auth = requireAuth(sessionResolver);

  const chatsLimiter = createRateLimiter({
    store: rateLimitStore,
    logger,
    name: 'chats',
    limit: rateLimits.chats.limit,
    windowMs: rateLimits.chats.windowMs,
    identify: userIdentifier,
  });
  const settingsLimiter = createRateLimiter({
    store: rateLimitStore,
    logger,
    name: 'settings',
    limit: rateLimits.settings.limit,
    windowMs: rateLimits.settings.windowMs,
    identify: userIdentifier,
  });
  const usageLimiter = createRateLimiter({
    store: rateLimitStore,
    logger,
    name: 'usage',
    limit: rateLimits.usage.limit,
    windowMs: rateLimits.usage.windowMs,
    identify: userIdentifier,
  });

  app.use(
    '/api/chats',
    auth,
    chatsLimiter,
    createChatsRouter({ db }),
  );
  app.use(
    '/api/settings',
    auth,
    settingsLimiter,
    createSettingsRouter({ db, masterKey, providerValidator }),
  );
  app.use(
    '/api/usage',
    auth,
    usageLimiter,
    createUsageRouter({ db, freeTokensCap: env.FREE_TOKEN_CAP }),
  );

  app.get('/api/me', auth, (req, res) => {
    const user = getRequestUser(req);
    res.json({ user });
  });

  app.use(notFoundHandler);
  app.use(createErrorHandler(logger));

  return app;
}
