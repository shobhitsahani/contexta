import { randomUUID } from 'node:crypto';
import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import { betterAuth } from 'better-auth';
import type { Env } from '../config/env.js';
import type { Db } from '../db/client.js';
import * as schema from '../db/schema.js';
import type { Logger } from '../lib/logger.js';
import {
  type EmailSender,
  passwordResetEmail,
  verificationEmail,
} from './email.js';

export interface AuthDependencies {
  db: Db;
  env: Env;
  emailSender: EmailSender;
  logger: Logger;
}

/**
 * Better Auth configuration.
 *
 * Unverified users can log in (plan §15.1) but the free tier is blocked by
 * requireVerified/UsageService until they verify. Google OAuth is only enabled
 * when both credentials are present.
 */
export function createAuth(dependencies: AuthDependencies) {
  const { db, env, emailSender, logger } = dependencies;

  const deliver = (message: Parameters<EmailSender['send']>[0]): void => {
    void emailSender.send(message).catch((error: unknown) => {
      logger.warn('email_send_failed', {
        subject: message.subject,
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
    });
  };

  const socialProviders =
    env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
      ? {
          google: {
            clientId: env.GOOGLE_CLIENT_ID,
            clientSecret: env.GOOGLE_CLIENT_SECRET,
          },
        }
      : {};

  // Better Auth expects singular model keys; the shared schema uses plural
  // variables (users/sessions/...).
  const authSchema = {
    ...schema,
    user: schema.users,
    session: schema.sessions,
    account: schema.accounts,
    verification: schema.verifications,
  };

  return betterAuth({
    appName: 'Contexta',
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: [env.WEB_ORIGIN],
    database: drizzleAdapter(db, {
      provider: 'pg',
      schema: authSchema,
    }),
    emailAndPassword: {
      enabled: true,
      // Plan §15.1: allow login, block the free tier until verified.
      requireEmailVerification: false,
      minPasswordLength: 8,
      maxPasswordLength: 128,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) => {
        deliver({
          ...passwordResetEmail({ name: user.name ?? '', url }),
          to: user.email,
        });
      },
      onPasswordReset: async ({ user }) => {
        logger.info('password_reset_completed', { userId: user.id });
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      sendOnSignIn: false,
      autoSignInAfterVerification: false,
      sendVerificationEmail: async ({ user, url }) => {
        deliver({
          ...verificationEmail({ name: user.name ?? '', url }),
          to: user.email,
        });
      },
    },
    socialProviders,
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
    },
    advanced: {
      useSecureCookies: env.NODE_ENV === 'production',
      defaultCookieAttributes: {
        httpOnly: true,
        secure: env.NODE_ENV === 'production',
        sameSite: env.NODE_ENV === 'production' ? 'none' : 'lax',
        path: '/',
      },
      database: {
        generateId: () => randomUUID(),
      },
    },
    // Redis-backed limits are enforced in middleware; avoid a second,
    // per-instance in-memory limiter in production.
    rateLimit: { enabled: false },
    logger: { disabled: true },
  });
}

export type Auth = ReturnType<typeof createAuth>;
