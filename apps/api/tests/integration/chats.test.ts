import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { messages } from '../../src/db/schema.js';
import {
  authHeader,
  seedDocument,
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

describe('chat routes', () => {
  let database: TestDatabase;
  let app: ReturnType<typeof createTestApp>['app'];
  let alice: Awaited<ReturnType<typeof seedUser>>;
  let bob: Awaited<ReturnType<typeof seedUser>>;
  let readyDocument: Awaited<ReturnType<typeof seedDocument>>;
  let queuedDocument: Awaited<ReturnType<typeof seedDocument>>;
  let validator: FakeProviderValidator;

  beforeEach(async () => {
    database = await createTestDatabase();
    alice = await seedUser(database.db, {
      email: 'alice@example.com',
      name: 'Alice',
    });
    bob = await seedUser(database.db, {
      email: 'bob@example.com',
      name: 'Bob',
    });
    readyDocument = await seedDocument(database.db, alice.id, {
      name: 'ready.txt',
    });
    queuedDocument = await seedDocument(database.db, alice.id, {
      name: 'queued.txt',
      status: 'queued',
    });
    const context = createTestApp({ db: database.db });
    app = context.app;
    validator = context.validator;
  });

  afterEach(async () => {
    await database.close();
  });

  it('requires authentication', async () => {
    const response = await request(app).get('/api/chats');
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('UNAUTHORIZED');
    expect(validator.calls).toHaveLength(0);
  });

  it('creates a chat with owned ready documents', async () => {
    const response = await request(app)
      .post('/api/chats')
      .set(authHeader(alice.id))
      .send({ documentIds: [readyDocument.id], title: '  My chat  ' });

    expect(response.status).toBe(201);
    expect(response.body.id).toBeTruthy();
    expect(response.body.title).toBe('My chat');
    expect(response.body.pinned).toBe(false);
    expect(response.body.documentIds).toEqual([readyDocument.id]);
  });

  it('rejects a document owned by another user', async () => {
    const bobDocument = await seedDocument(database.db, bob.id);
    const response = await request(app)
      .post('/api/chats')
      .set(authHeader(alice.id))
      .send({ documentIds: [bobDocument.id] });

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('NOT_FOUND');
  });

  it('rejects a document that is still processing', async () => {
    const response = await request(app)
      .post('/api/chats')
      .set(authHeader(alice.id))
      .send({ documentIds: [queuedDocument.id] });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('DOCUMENT_NOT_READY');
  });

  it('rejects malformed document ids', async () => {
    const response = await request(app)
      .post('/api/chats')
      .set(authHeader(alice.id))
      .send({ documentIds: ['not-a-uuid'] });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('lists only the current user chats with pinned first', async () => {
    const first = await request(app)
      .post('/api/chats')
      .set(authHeader(alice.id))
      .send({ title: 'First' });
    const second = await request(app)
      .post('/api/chats')
      .set(authHeader(alice.id))
      .send({ title: 'Second' });
    await request(app)
      .post('/api/chats')
      .set(authHeader(bob.id))
      .send({ title: "Bob's chat" });

    await request(app)
      .patch(`/api/chats/${first.body.id}`)
      .set(authHeader(alice.id))
      .send({ pinned: true })
      .expect(200);

    const response = await request(app)
      .get('/api/chats')
      .set(authHeader(alice.id));

    expect(response.status).toBe(200);
    expect(response.body.chats).toHaveLength(2);
    expect(response.body.chats[0].id).toBe(first.body.id);
    expect(response.body.chats[1].id).toBe(second.body.id);
    expect(response.body.chats[0].title).toBe('First');
  });

  it('gets, renames and pins an owned chat', async () => {
    const created = await request(app)
      .post('/api/chats')
      .set(authHeader(alice.id))
      .send({ documentIds: [readyDocument.id] });
    const chatId = created.body.id;

    const fetched = await request(app)
      .get(`/api/chats/${chatId}`)
      .set(authHeader(alice.id));
    expect(fetched.status).toBe(200);
    expect(fetched.body.documentIds).toEqual([readyDocument.id]);

    const patched = await request(app)
      .patch(`/api/chats/${chatId}`)
      .set(authHeader(alice.id))
      .send({ title: 'Renamed', pinned: true });
    expect(patched.status).toBe(200);
    expect(patched.body.title).toBe('Renamed');
    expect(patched.body.pinned).toBe(true);

    const invalid = await request(app)
      .patch(`/api/chats/${chatId}`)
      .set(authHeader(alice.id))
      .send({});
    expect(invalid.status).toBe(400);
  });

  it('never allows cross-user reads or writes', async () => {
    const created = await request(app)
      .post('/api/chats')
      .set(authHeader(alice.id))
      .send({ title: 'Private' });
    const chatId = created.body.id;

    await request(app)
      .get(`/api/chats/${chatId}`)
      .set(authHeader(bob.id))
      .expect(404);
    await request(app)
      .patch(`/api/chats/${chatId}`)
      .set(authHeader(bob.id))
      .send({ title: 'Stolen' })
      .expect(404);
    await request(app)
      .delete(`/api/chats/${chatId}`)
      .set(authHeader(bob.id))
      .expect(404);
    await request(app)
      .get(`/api/chats/${chatId}/messages`)
      .set(authHeader(bob.id))
      .expect(404);
  });

  it('returns message history in ascending order with sources', async () => {
    const created = await request(app)
      .post('/api/chats')
      .set(authHeader(alice.id))
      .send({});
    const chatId = created.body.id;

    await database.db.insert(messages).values([
      {
        id: randomUUID(),
        chatId,
        role: 'assistant',
        content: 'Second',
        sources: [
          {
            n: 1,
            documentId: readyDocument.id,
            fileName: 'ready.txt',
            page: 1,
            snippet: 'snippet',
          },
        ],
        tokensIn: 10,
        tokensOut: 20,
        usedFreeBudget: true,
        createdAt: new Date('2026-01-01T00:00:02Z'),
      },
      {
        id: randomUUID(),
        chatId,
        role: 'user',
        content: 'First',
        sources: null,
        createdAt: new Date('2026-01-01T00:00:01Z'),
      },
    ]);

    const response = await request(app)
      .get(`/api/chats/${chatId}/messages`)
      .set(authHeader(alice.id));

    expect(response.status).toBe(200);
    expect(response.body.messages.map((m: { content: string }) => m.content)).toEqual([
      'First',
      'Second',
    ]);
    expect(response.body.messages[1].sources[0].fileName).toBe('ready.txt');
    expect(response.body.messages[0].sources).toEqual([]);
  });

  it('deletes a chat and cascades messages', async () => {
    const created = await request(app)
      .post('/api/chats')
      .set(authHeader(alice.id))
      .send({});
    const chatId = created.body.id;
    await database.db.insert(messages).values({
      id: randomUUID(),
      chatId,
      role: 'user',
      content: 'hello',
    });

    await request(app)
      .delete(`/api/chats/${chatId}`)
      .set(authHeader(alice.id))
      .expect(204);

    await request(app)
      .get(`/api/chats/${chatId}`)
      .set(authHeader(alice.id))
      .expect(404);

    const remaining = await database.db
      .select()
      .from(messages)
      .where(eq(messages.chatId, chatId));
    expect(remaining).toHaveLength(0);
  });
});
