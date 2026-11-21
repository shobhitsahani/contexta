import { fromNodeHeaders } from 'better-auth/node';
import type { Request, RequestHandler } from 'express';
import { AppError } from '../lib/errors.js';

export interface AuthUser {
  id: string;
  email: string;
  emailVerified: boolean;
  name: string;
  image?: string | null;
}

export interface AuthSession {
  id: string;
  userId: string;
  expiresAt: Date | string;
}

export interface AuthSessionResult {
  user: AuthUser;
  session: AuthSession;
}

export type SessionResolver = (
  headers: Headers,
) => Promise<AuthSessionResult | null>;

interface BetterAuthSessionSource {
  api: {
    getSession(args: { headers: Headers }): Promise<unknown>;
  };
}

function asSessionResult(value: unknown): AuthSessionResult | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as {
    user?: Record<string, unknown>;
    session?: Record<string, unknown>;
  };
  if (!candidate.user || !candidate.session) return null;
  const user = candidate.user;
  const session = candidate.session;
  if (typeof user.id !== 'string' || typeof user.email !== 'string') {
    return null;
  }
  return {
    user: {
      id: user.id,
      email: user.email,
      emailVerified: user.emailVerified === true,
      name: typeof user.name === 'string' ? user.name : '',
      image: typeof user.image === 'string' ? user.image : null,
    },
    session: {
      id: typeof session.id === 'string' ? session.id : '',
      userId:
        typeof session.userId === 'string' ? session.userId : user.id,
      expiresAt:
        session.expiresAt instanceof Date ||
        typeof session.expiresAt === 'string'
          ? session.expiresAt
          : new Date(),
    },
  };
}

/** Adapts a Better Auth instance to the middleware's session resolver. */
export function createBetterAuthSessionResolver(
  auth: BetterAuthSessionSource,
): SessionResolver {
  return async (headers) => {
    const session = await auth.api.getSession({ headers });
    return asSessionResult(session);
  };
}

/** Rejects requests without a valid Better Auth session. */
export function requireAuth(resolveSession: SessionResolver): RequestHandler {
  return (req, res, next) => {
    void (async () => {
      try {
        const session = await resolveSession(fromNodeHeaders(req.headers));
        if (!session) {
          throw AppError.unauthorized();
        }
        req.user = session.user;
        req.authSession = session.session;
        // Compatibility with the messages route contract (Agent 2).
        req.userId = session.user.id;
        next();
      } catch (error) {
        next(error);
      }
    })();
  };
}

/** Must run after requireAuth. Blocks free-tier actions for unverified email. */
export function requireVerified(): RequestHandler {
  return (req, _res, next) => {
    if (!req.user) {
      next(AppError.unauthorized());
      return;
    }
    if (!req.user.emailVerified) {
      next(AppError.emailNotVerified());
      return;
    }
    next();
  };
}

export function getRequestUser(req: Request): AuthUser {
  if (!req.user) {
    throw AppError.unauthorized();
  }
  return req.user;
}
