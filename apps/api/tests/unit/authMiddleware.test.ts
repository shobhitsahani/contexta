import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { describe, expect, it } from 'vitest';
import { AppError } from '../../src/lib/errors.js';
import {
  createBetterAuthSessionResolver,
  getRequestUser,
  requireAuth,
  requireVerified,
  type AuthSessionResult,
  type SessionResolver,
} from '../../src/middleware/auth.js';

function run(
  handler: RequestHandler,
  req: Request,
): Promise<unknown> {
  return new Promise((resolve) => {
    const next: NextFunction = (error?: unknown) => resolve(error);
    void handler(req as unknown as Request, {} as Response, next);
  });
}

function requestWithHeaders(headers: Record<string, string> = {}): Request {
  return { headers } as unknown as Request;
}

const session: AuthSessionResult = {
  user: {
    id: '11111111-1111-4111-8111-111111111111',
    email: 'alice@example.com',
    emailVerified: true,
    name: 'Alice',
    image: null,
  },
  session: {
    id: 'session-1',
    userId: '11111111-1111-4111-8111-111111111111',
    expiresAt: new Date(Date.now() + 60_000),
  },
};

describe('createBetterAuthSessionResolver', () => {
  it('normalizes a Better Auth session and forwards request headers', async () => {
    let received: Headers | undefined;
    const resolver = createBetterAuthSessionResolver({
      api: {
        async getSession({ headers }) {
          received = headers;
          return {
            user: {
              id: session.user.id,
              email: session.user.email,
              emailVerified: true,
              name: 'Alice',
              image: undefined,
            },
            session: {
              id: 'session-1',
              userId: session.user.id,
              expiresAt: new Date(Date.now() + 60_000).toISOString(),
            },
          };
        },
      },
    });

    const headers = new Headers({ cookie: 'better-auth.session_token=value' });
    const result = await resolver(headers);

    expect(received?.get('cookie')).toBe('better-auth.session_token=value');
    expect(result).toEqual({
      user: {
        id: session.user.id,
        email: session.user.email,
        emailVerified: true,
        name: 'Alice',
        image: null,
      },
      session: {
        id: 'session-1',
        userId: session.user.id,
        expiresAt: expect.any(String),
      },
    });
  });

  it('returns null for missing or malformed sessions', async () => {
    const nullResolver = createBetterAuthSessionResolver({
      api: { getSession: async () => null },
    });
    expect(await nullResolver(new Headers())).toBeNull();

    const malformedResolver = createBetterAuthSessionResolver({
      api: {
        getSession: async () => ({ user: { id: 'missing-email' } }),
      },
    });
    expect(await malformedResolver(new Headers())).toBeNull();
  });
});

describe('requireAuth', () => {
  it('attaches the user, session and compatibility userId', async () => {
    const req = requestWithHeaders();
    const error = await run(
      requireAuth(async () => session),
      req,
    );

    expect(error).toBeUndefined();
    expect(req.user).toEqual(session.user);
    expect(req.authSession).toEqual(session.session);
    expect(req.userId).toBe(session.user.id);
  });

  it('rejects requests without a session', async () => {
    const error = await run(
      requireAuth(async () => null),
      requestWithHeaders(),
    );

    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({ status: 401, code: 'UNAUTHORIZED' });
  });

  it('forwards resolver failures', async () => {
    const failure = new Error('session store unavailable');
    const error = await run(
      requireAuth(async () => {
        throw failure;
      }),
      requestWithHeaders(),
    );

    expect(error).toBe(failure);
  });

  it('passes original headers to the resolver', async () => {
    let received: Headers | undefined;
    const resolver: SessionResolver = async (headers) => {
      received = headers;
      return session;
    };

    await run(
      requireAuth(resolver),
      requestWithHeaders({
        cookie: 'better-auth.session_token=abc',
        'x-request-id': 'req-1',
      }),
    );

    expect(received?.get('cookie')).toBe('better-auth.session_token=abc');
    expect(received?.get('x-request-id')).toBe('req-1');
  });
});

describe('requireVerified', () => {
  it('rejects requests that skipped requireAuth', async () => {
    const error = await run(requireVerified(), requestWithHeaders());
    expect(error).toMatchObject({ status: 401, code: 'UNAUTHORIZED' });
  });

  it('blocks unverified users with 403', async () => {
    const req = requestWithHeaders();
    req.user = { ...session.user, emailVerified: false };
    const error = await run(requireVerified(), req);
    expect(error).toMatchObject({ status: 403, code: 'EMAIL_NOT_VERIFIED' });
  });

  it('allows verified users through', async () => {
    const req = requestWithHeaders();
    req.user = session.user;
    const error = await run(requireVerified(), req);
    expect(error).toBeUndefined();
  });
});

describe('getRequestUser', () => {
  it('returns the authenticated user', () => {
    const req = { user: session.user } as unknown as Request;
    expect(getRequestUser(req)).toEqual(session.user);
  });

  it('throws when called without an authenticated request', () => {
    expect(() => getRequestUser({} as Request)).toThrow(AppError);
  });
});
