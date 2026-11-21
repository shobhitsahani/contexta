import { and, eq } from 'drizzle-orm';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppError } from '../../src/lib/errors.js';
import { providerKeys } from '../../src/db/schema.js';
import {
  decryptProviderKey,
  keyAad,
  parseMasterKey,
} from '../../src/services/keys.js';
import {
  authHeader,
  seedUser,
} from '../helpers/seed.js';
import {
  createTestApp,
  type FakeProviderValidator,
} from '../helpers/app.js';
import {
  createTestDatabase,
  type TestDatabase,
} from '../helpers/testDb.js';

const API_KEY = 'sk-test-1234567890-secret';

describe('BYOK settings routes', () => {
  let database: TestDatabase;
  let app: ReturnType<typeof createTestApp>['app'];
  let env: ReturnType<typeof createTestApp>['env'];
  let validator: FakeProviderValidator;
  let alice: Awaited<ReturnType<typeof seedUser>>;
  let bob: Awaited<ReturnType<typeof seedUser>>;
  let masterKey: Buffer;

  beforeEach(async () => {
    database = await createTestDatabase();
    alice = await seedUser(database.db, { email: 'alice@example.com' });
    bob = await seedUser(database.db, { email: 'bob@example.com' });
    const context = createTestApp({ db: database.db });
    app = context.app;
    env = context.env;
    validator = context.validator;
    masterKey = parseMasterKey(env.KEY_ENCRYPTION_SECRET);
  });

  afterEach(async () => {
    await database.close();
  });

  it('requires authentication', async () => {
    await request(app)
      .put('/api/settings/provider-key')
      .send({ provider: 'openai', apiKey: API_KEY })
      .expect(401);
    await request(app).get('/api/settings/provider-key').expect(401);
  });

  it('validates, encrypts and stores a key', async () => {
    const response = await request(app)
      .put('/api/settings/provider-key')
      .set(authHeader(alice.id))
      .send({ provider: 'openai', apiKey: API_KEY });

    expect(response.status).toBe(204);
    expect(validator.calls).toEqual([
      { provider: 'openai', apiKey: API_KEY },
    ]);

    const rows = await database.db
      .select()
      .from(providerKeys)
      .where(
        and(
          eq(providerKeys.userId, alice.id),
          eq(providerKeys.provider, 'openai'),
        ),
      );
    expect(rows).toHaveLength(1);
    const row = rows[0]!;

    expect(row.ciphertext.toString('utf8')).not.toContain(API_KEY);
    expect(row.ciphertext.includes(Buffer.from(API_KEY))).toBe(false);
    expect(row.iv).toHaveLength(12);
    expect(row.authTag).toHaveLength(16);

    const decrypted = decryptProviderKey(
      {
        ciphertext: row.ciphertext,
        iv: row.iv,
        authTag: row.authTag,
      },
      masterKey,
      keyAad(alice.id, 'openai'),
    );
    expect(decrypted).toBe(API_KEY);
  });

  it('never returns key material or plaintext', async () => {
    await request(app)
      .put('/api/settings/provider-key')
      .set(authHeader(alice.id))
      .send({ provider: 'gemini', apiKey: API_KEY })
      .expect(204);

    const response = await request(app)
      .get('/api/settings/provider-key')
      .set(authHeader(alice.id));

    expect(response.status).toBe(200);
    const serialized = JSON.stringify(response.body);
    expect(serialized).not.toContain(API_KEY);
    expect(serialized).not.toContain('ciphertext');
    expect(serialized).not.toContain('authTag');
    expect(response.body.providers).toEqual([
      { provider: 'gemini', createdAt: expect.any(String) },
    ]);
  });

  it('does not save a key the provider rejects', async () => {
    validator.error = AppError.providerKeyInvalid();

    const response = await request(app)
      .put('/api/settings/provider-key')
      .set(authHeader(alice.id))
      .send({ provider: 'anthropic', apiKey: API_KEY });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('PROVIDER_KEY_INVALID');
    const rows = await database.db.select().from(providerKeys);
    expect(rows).toHaveLength(0);
  });

  it('does not save a key when the provider is unavailable', async () => {
    validator.error = AppError.providerUnavailable();

    const response = await request(app)
      .put('/api/settings/provider-key')
      .set(authHeader(alice.id))
      .send({ provider: 'openai', apiKey: API_KEY });

    expect(response.status).toBe(502);
    expect(response.body.error.code).toBe('PROVIDER_UNAVAILABLE');
    expect(await database.db.select().from(providerKeys)).toHaveLength(0);
  });

  it('upserts by user and provider without duplicating rows', async () => {
    await request(app)
      .put('/api/settings/provider-key')
      .set(authHeader(alice.id))
      .send({ provider: 'openai', apiKey: API_KEY })
      .expect(204);

    const updatedKey = 'sk-updated-key-0987654321';
    await request(app)
      .put('/api/settings/provider-key')
      .set(authHeader(alice.id))
      .send({ provider: 'openai', apiKey: updatedKey })
      .expect(204);

    const rows = await database.db
      .select()
      .from(providerKeys)
      .where(eq(providerKeys.userId, alice.id));
    expect(rows).toHaveLength(1);
    expect(
      decryptProviderKey(
        {
          ciphertext: rows[0]!.ciphertext,
          iv: rows[0]!.iv,
          authTag: rows[0]!.authTag,
        },
        masterKey,
        keyAad(alice.id, 'openai'),
      ),
    ).toBe(updatedKey);
  });

  it('deletes one provider or all providers', async () => {
    await request(app)
      .put('/api/settings/provider-key')
      .set(authHeader(alice.id))
      .send({ provider: 'openai', apiKey: API_KEY })
      .expect(204);
    await request(app)
      .put('/api/settings/provider-key')
      .set(authHeader(alice.id))
      .send({ provider: 'gemini', apiKey: API_KEY })
      .expect(204);

    await request(app)
      .delete('/api/settings/provider-key?provider=openai')
      .set(authHeader(alice.id))
      .expect(204);

    let rows = await database.db
      .select()
      .from(providerKeys)
      .where(eq(providerKeys.userId, alice.id));
    expect(rows.map((row) => row.provider)).toEqual(['gemini']);

    await request(app)
      .delete('/api/settings/provider-key')
      .set(authHeader(alice.id))
      .expect(204);

    rows = await database.db
      .select()
      .from(providerKeys)
      .where(eq(providerKeys.userId, alice.id));
    expect(rows).toHaveLength(0);
  });

  it('isolates provider metadata between users', async () => {
    await request(app)
      .put('/api/settings/provider-key')
      .set(authHeader(alice.id))
      .send({ provider: 'openai', apiKey: API_KEY })
      .expect(204);

    const bobResponse = await request(app)
      .get('/api/settings/provider-key')
      .set(authHeader(bob.id));
    expect(bobResponse.body.providers).toEqual([]);
  });

  it('rejects malformed bodies and providers', async () => {
    await request(app)
      .put('/api/settings/provider-key')
      .set(authHeader(alice.id))
      .send({ provider: 'openai' })
      .expect(400);
    await request(app)
      .put('/api/settings/provider-key')
      .set(authHeader(alice.id))
      .send({ provider: 'not-a-provider', apiKey: API_KEY })
      .expect(400);
  });
});
