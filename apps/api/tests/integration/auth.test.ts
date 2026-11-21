import { toNodeHandler } from 'better-auth/node';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { createAuth, type Auth } from '../../src/auth/auth.js';
import type { EmailMessage } from '../../src/auth/email.js';
import type { Env } from '../../src/config/env.js';
import { accounts, sessions, users } from '../../src/db/schema.js';
import { createSilentLogger } from '../../src/lib/logger.js';
import { createBetterAuthSessionResolver } from '../../src/middleware/auth.js';
import {
  createTestApp,
  RecordingEmailSender,
  testEnv,
} from '../helpers/app.js';
import { createTestDatabase, type TestDatabase } from '../helpers/testDb.js';

const PASSWORD = 'correct-horse-battery';
const NEW_PASSWORD = 'new-correct-horse-battery';

const VERIFICATION_SUBJECT = 'Verify your Contexta email';
const RESET_SUBJECT = 'Reset your Contexta password';

interface Harness {
  database: TestDatabase;
  app: ReturnType<typeof createTestApp>['app'];
  auth: Auth;
  emails: RecordingEmailSender;
  env: Env;
}

let harness: Harness | undefined;

async function createHarness(overrides: Partial<Env> = {}): Promise<Harness> {
  const database = await createTestDatabase();
  const env = testEnv({
    GOOGLE_CLIENT_ID: undefined,
    GOOGLE_CLIENT_SECRET: undefined,
    ...overrides,
  });
  const emails = new RecordingEmailSender();
  const auth = createAuth({
    db: database.db,
    env,
    emailSender: emails,
    logger: createSilentLogger(),
  });
  const { app } = createTestApp({
    db: database.db,
    env,
    authHandler: toNodeHandler(auth),
    sessionResolver: createBetterAuthSessionResolver(auth),
  });
  harness = { database, app, auth, emails, env };
  return harness;
}

afterEach(async () => {
  await harness?.database.close();
  harness = undefined;
});

function firstUrl(text: string): URL {
  const match = text.match(/https?:\/\/[^\s]+/);
  if (!match) throw new Error('Email did not contain a link.');
  return new URL(match[0]);
}

async function waitForMessage(
  emails: RecordingEmailSender,
  subject: string,
  to: string,
): Promise<EmailMessage> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const message = emails.messages.find(
      (candidate) => candidate.subject === subject && candidate.to === to,
    );
    if (message) return message;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for the "${subject}" email.`);
}

function signUp(
  agent: ReturnType<typeof request.agent>,
  email = 'alice@example.com',
  name = 'Alice',
) {
  return agent.post('/api/auth/sign-up/email').send({
    email,
    password: PASSWORD,
    name,
  });
}

function signIn(
  agent: ReturnType<typeof request.agent>,
  email: string,
  password = PASSWORD,
) {
  return agent.post('/api/auth/sign-in/email').send({ email, password });
}

describe('Better Auth integration', () => {
  it('signs up, hashes the credential and signs in', async () => {
    const { app, database, emails } = await createHarness();
    const agent = request.agent(app);

    const signUpResponse = await signUp(agent);
    expect(signUpResponse.status).toBe(200);
    expect(signUpResponse.body.user).toMatchObject({
      email: 'alice@example.com',
      name: 'Alice',
      emailVerified: false,
    });
    expect(signUpResponse.body.user).not.toHaveProperty('password');
    expect(String(signUpResponse.headers['set-cookie'])).toContain(
      'better-auth.session_token',
    );

    const me = await agent.get('/api/me').expect(200);
    expect(me.body.user).toMatchObject({
      email: 'alice@example.com',
      emailVerified: false,
    });
    expect(me.body.user).not.toHaveProperty('password');

    const userRows = await database.db
      .select()
      .from(users)
      .where(eq(users.email, 'alice@example.com'));
    expect(userRows).toHaveLength(1);
    expect(userRows[0]?.emailVerified).toBe(false);

    const accountRows = await database.db
      .select()
      .from(accounts)
      .where(eq(accounts.userId, userRows[0]!.id));
    expect(accountRows).toHaveLength(1);
    expect(accountRows[0]?.providerId).toBe('credential');
    expect(accountRows[0]?.password).toBeTruthy();
    expect(accountRows[0]?.password).not.toContain(PASSWORD);

    const sessionRows = await database.db
      .select()
      .from(sessions)
      .where(eq(sessions.userId, userRows[0]!.id));
    expect(sessionRows).toHaveLength(1);

    const message = await waitForMessage(
      emails,
      VERIFICATION_SUBJECT,
      'alice@example.com',
    );
    expect(firstUrl(message.text).pathname).toBe('/api/auth/verify-email');

    const wrongAgent = request.agent(app);
    const wrong = await signIn(wrongAgent, 'alice@example.com', 'wrong-password');
    expect(wrong.status).toBe(401);
    expect(JSON.stringify(wrong.body)).not.toContain('wrong-password');

    const secondAgent = request.agent(app);
    const signInResponse = await signIn(secondAgent, 'alice@example.com');
    expect(signInResponse.status).toBe(200);
    expect(signInResponse.body.user.email).toBe('alice@example.com');
    await secondAgent.get('/api/me').expect(200);

    await secondAgent.post('/api/auth/sign-out').expect(200);
    await secondAgent.get('/api/me').expect(401);
  });

  it('verifies an email address and enables free-tier eligibility', async () => {
    const { app, database, emails } = await createHarness();
    const agent = request.agent(app);
    await signUp(agent);

    const message = await waitForMessage(
      emails,
      VERIFICATION_SUBJECT,
      'alice@example.com',
    );
    const link = firstUrl(message.text);
    expect(link.searchParams.get('token')).toBeTruthy();

    const verified = await agent
      .get(`${link.pathname}${link.search}`)
      .redirects(0);
    expect([200, 302]).toContain(verified.status);

    const userRows = await database.db
      .select()
      .from(users)
      .where(eq(users.email, 'alice@example.com'));
    expect(userRows[0]?.emailVerified).toBe(true);

    const me = await agent.get('/api/me').expect(200);
    expect(me.body.user.emailVerified).toBe(true);

    const usage = await agent.get('/api/usage').expect(200);
    expect(usage.body).toMatchObject({
      emailVerified: true,
      freeTierEligible: true,
      keyRequired: false,
      hasOwnKey: false,
    });

    // Reusing the single-use token must not fail the request loudly.
    const reused = await agent
      .get(`${link.pathname}${link.search}`)
      .redirects(0);
    expect([200, 302]).toContain(reused.status);

    const invalid = await agent
      .get('/api/auth/verify-email?token=not-a-token&callbackURL=%2F')
      .redirects(0);
    expect(invalid.status).toBe(302);
    expect(invalid.headers.location).toContain('error=INVALID_TOKEN');
  });

  it('resets a password, revokes sessions and rejects token reuse', async () => {
    const { app, database, emails } = await createHarness();
    const agent = request.agent(app);
    await signUp(agent);
    await agent.get('/api/me').expect(200);
    emails.messages.length = 0;

    const unknown = await agent
      .post('/api/auth/request-password-reset')
      .send({ email: 'nobody@example.com' })
      .expect(200);
    expect(unknown.body.status).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(emails.messages).toHaveLength(0);

    const requested = await agent
      .post('/api/auth/request-password-reset')
      .send({
        email: 'alice@example.com',
        redirectTo: 'http://localhost:3000/reset-password',
      })
      .expect(200);
    expect(requested.body.status).toBe(true);

    const message = await waitForMessage(
      emails,
      RESET_SUBJECT,
      'alice@example.com',
    );
    expect(message.text).not.toContain(PASSWORD);

    const link = firstUrl(message.text);
    const token = link.pathname.split('/').pop();
    expect(token).toBeTruthy();

    const callback = await agent
      .get(`${link.pathname}${link.search}`)
      .redirects(0);
    expect(callback.status).toBe(302);
    expect(callback.headers.location).toBe(
      `http://localhost:3000/reset-password?token=${token}`,
    );

    await agent
      .post('/api/auth/reset-password')
      .send({ newPassword: NEW_PASSWORD, token })
      .expect(200);

    // revokeSessionsOnPasswordReset: true.
    await agent.get('/api/me').expect(401);

    const oldPasswordAgent = request.agent(app);
    const oldPassword = await signIn(
      oldPasswordAgent,
      'alice@example.com',
      PASSWORD,
    );
    expect(oldPassword.status).toBe(401);

    const newPasswordAgent = request.agent(app);
    const newPassword = await signIn(
      newPasswordAgent,
      'alice@example.com',
      NEW_PASSWORD,
    );
    expect(newPassword.status).toBe(200);
    await newPasswordAgent.get('/api/me').expect(200);

    const reuse = await request(app)
      .post('/api/auth/reset-password')
      .send({ newPassword: PASSWORD, token });
    expect(reuse.status).toBe(400);

    const sessionRows = await database.db.select().from(sessions);
    expect(sessionRows.length).toBeGreaterThan(0);
  });

  it('returns a Google authorize URL when OAuth is configured', async () => {
    const { app, env } = await createHarness({
      GOOGLE_CLIENT_ID: 'test-google-client-id',
      GOOGLE_CLIENT_SECRET: 'test-google-client-secret',
    });

    const response = await request(app)
      .post('/api/auth/sign-in/social')
      .send({
        provider: 'google',
        callbackURL: 'http://localhost:3000/auth/callback',
        disableRedirect: true,
      })
      .expect(200);

    expect(response.body.redirect).toBe(false);
    const url = new URL(response.body.url);
    expect(url.origin).toBe('https://accounts.google.com');
    expect(url.searchParams.get('client_id')).toBe('test-google-client-id');
    expect(url.searchParams.get('redirect_uri')).toBe(
      `${env.BETTER_AUTH_URL}/api/auth/callback/google`,
    );
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('state')).toBeTruthy();
    expect(url.searchParams.get('scope')).toContain('email');
    expect(response.body.url).not.toContain('test-google-client-secret');
  });

  it('does not offer Google when OAuth is not configured', async () => {
    const { app } = await createHarness();

    const response = await request(app)
      .post('/api/auth/sign-in/social')
      .send({ provider: 'google', disableRedirect: true });

    expect(response.status).toBe(404);
    expect(JSON.stringify(response.body)).not.toContain('client_secret');
  });

  it('protects private routes from missing or invalid sessions', async () => {
    const { app } = await createHarness();

    for (const path of ['/api/me', '/api/chats', '/api/settings/provider-key', '/api/usage']) {
      const response = await request(app).get(path);
      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe('UNAUTHORIZED');
    }

    const bogus = await request(app)
      .get('/api/me')
      .set('Cookie', 'better-auth.session_token=not-a-real-session');
    expect(bogus.status).toBe(401);
    expect(bogus.body.error.code).toBe('UNAUTHORIZED');
  });
});
