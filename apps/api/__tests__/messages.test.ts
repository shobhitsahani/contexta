/**
 * Tests for the messages route handler.
 * Uses in-memory fakes for all dependencies.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import express from 'express';
import { v4 as uuid } from 'uuid';
import { createMessagesRouter } from '../../apps/api/src/routes/messages/handler.js';
import { FakeLLMProvider } from '../../apps/api/src/services/llm/fake.js';
import { FakeEmbedder } from '../../apps/api/src/services/embedding/embedder.js';
import type {
  MessagesDB,
  UsageDB,
  KeysDB,
  DocumentsDB,
  ChatRow,
  MessageRow,
} from '../../apps/api/src/routes/messages/handler.js';
import type { RetrievalDB, SummaryDB, SearchHit } from '../../apps/api/src/services/retrieval/search.js';
import {
  type Citation,
  StreamEventDeltaSchema,
  StreamEventSourcesSchema,
  StreamEventUsageSchema,
  StreamEventDoneSchema,
} from '@contexta/shared';
import {
  createDrizzleMessagesDB,
  createDrizzleKeysDB,
  createDrizzleDocumentsDB,
} from '../../apps/api/src/routes/messages/drizzleMessages.js';
import { createTestDatabase } from '../tests/helpers/testDb.js';
import { chats, documents, providerKeys, users } from '../../apps/api/src/db/schema.js';
import { encryptProviderKey, keyAad } from '../../apps/api/src/services/keys.js';

const TEST_DOC_ID = '11111111-1111-4111-8111-111111111111';

// ── In-memory DB fakes ──

function createFakeMessagesDB(): MessagesDB & { messages: MessageRow[]; chats: ChatRow[] } {
  const chats: ChatRow[] = [
    { id: 'chat-1', userId: 'user-1', title: null },
  ];
  const messages: MessageRow[] = [];

  return {
    chats,
    messages,
    async getChat(chatId) {
      return chats.find((c) => c.id === chatId) ?? null;
    },
    async getChatDocumentIds(chatId) {
      if (chatId === 'chat-1') return [TEST_DOC_ID];
      return [];
    },
    async getRecentMessages(chatId, limit) {
      return messages
        .filter((m) => m.chatId === chatId)
        .slice(-limit);
    },
    async saveMessage(msg) {
      messages.push({ ...msg, createdAt: new Date() });
    },
    async updateChatTitle(chatId, title) {
      const chat = chats.find((c) => c.id === chatId);
      if (chat) chat.title = title;
    },
  };
}

function createFakeUsageDB(): UsageDB & { usage: Map<string, number> } {
  const usage = new Map<string, number>();
  return {
    usage,
    async getFreeTokensUsed(userId) {
      return usage.get(userId) ?? 0;
    },
    async addFreeTokensUsed(userId, tokens) {
      usage.set(userId, (usage.get(userId) ?? 0) + tokens);
    },
  };
}

function createFakeKeysDB(): KeysDB {
  return {
    async getUserProviderKey() {
      return null; // No user key; use free tier
    },
  };
}

function createFakeDocumentsDB(): DocumentsDB {
  return {
    async getDocumentsByIds(ids) {
      return ids.map((id) => ({ id, name: `${id}.pdf` }));
    },
  };
}

function createFakeRetrievalDB(): RetrievalDB {
  const hits: SearchHit[] = [
    {
      chunkId: 'chunk-1',
      documentId: TEST_DOC_ID,
      documentName: 'doc-1.pdf',
      page: 5,
      content: 'Machine learning is a subset of artificial intelligence.',
      score: 0.92,
    },
    {
      chunkId: 'chunk-2',
      documentId: TEST_DOC_ID,
      documentName: 'doc-1.pdf',
      page: 12,
      content: 'Neural networks consist of layers of interconnected nodes.',
      score: 0.85,
    },
  ];

  return {
    async vectorSearch(userId, documentIds, _queryVec, limit) {
      return hits.filter((h) => documentIds.includes(h.documentId)).slice(0, limit);
    },
    async fullTextSearch(userId, documentIds, _queryText, limit) {
      return hits.filter((h) => documentIds.includes(h.documentId)).slice(0, limit);
    },
  };
}

function createFakeSummaryDB(): SummaryDB {
  return {
    async getDocumentSummary(documentId, _userId) {
      if (documentId === TEST_DOC_ID || documentId === 'doc-1') {
        return {
          overview: 'A paper about machine learning fundamentals.',
          keyPoints: ['ML is a subset of AI', 'Neural networks are key'],
          sections: [
            { title: 'Introduction', pageStart: 1, pageEnd: 5, summary: 'Introduces ML concepts' },
          ],
        };
      }
      return null;
    },
  };
}

// ── Helper to make a request and collect SSE events ──

async function collectSSE(app: express.Express, path: string, body: object, _userId = 'user-1'): Promise<{
  status: number;
  events: Array<{ event: string; data: any }>;
  raw: string;
}> {
  return new Promise((resolve, reject) => {
    // Use a real HTTP request via the app
    const server = app.listen(0, () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        reject(new Error('Bad address'));
        return;
      }

      const url = `http://127.0.0.1:${addr.port}${path}`;

      fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
        .then(async (res) => {
          const text = await res.text();
          const events: Array<{ event: string; data: any }> = [];

          // Parse SSE events
          const lines = text.split('\n');
          let currentEvent = '';
          for (const line of lines) {
            if (line.startsWith('event: ')) {
              currentEvent = line.slice(7).trim();
            } else if (line.startsWith('data: ')) {
              try {
                const data = JSON.parse(line.slice(6));
                events.push({ event: currentEvent, data });
              } catch {
                // skip
              }
            }
          }

          server.close();
          resolve({ status: res.status, events, raw: text });
        })
        .catch((err) => {
          server.close();
          reject(err);
        });
    });
  });
}

// ── Tests ──

describe('Messages Handler', () => {
  let app: express.Express;
  let fakeLLM: FakeLLMProvider;
  let fakeMessagesDB: ReturnType<typeof createFakeMessagesDB>;
  let fakeUsageDB: ReturnType<typeof createFakeUsageDB>;

  beforeEach(() => {
    app = express();
    app.use(express.json());

    // Inject userId via middleware for testing
    app.use((req, _res, next) => {
      (req as any).userId = 'user-1';
      next();
    });

    fakeLLM = new FakeLLMProvider('gemini', [
      'Based on the sources, machine learning is a subset of AI [1]. Neural networks use layers of nodes [2].',
    ]);
    fakeMessagesDB = createFakeMessagesDB();
    fakeUsageDB = createFakeUsageDB();

    const router = createMessagesRouter({
      embedder: new FakeEmbedder(768),
      retrievalDB: createFakeRetrievalDB(),
      summaryDB: createFakeSummaryDB(),
      messagesDB: fakeMessagesDB,
      usageDB: fakeUsageDB,
      keysDB: createFakeKeysDB(),
      documentsDB: createFakeDocumentsDB(),
      getProviderFn: () => fakeLLM,
    });

    app.use('/chats/:id/messages', router);
  });

  it('streams a response with delta, sources, usage, and done events', async () => {
    const { events } = await collectSSE(app, '/chats/chat-1/messages', {
      content: 'What is machine learning?',
    });

    const eventTypes = events.map((e) => e.event);
    expect(eventTypes).toContain('delta');
    expect(eventTypes).toContain('sources');
    expect(eventTypes).toContain('usage');
    expect(eventTypes).toContain('done');
    expect(eventTypes).not.toContain('error');

    // Verify all stream events conform to the shared contract schemas
    const deltaEvent = events.find((e) => e.event === 'delta');
    expect(StreamEventDeltaSchema.safeParse(deltaEvent?.data).success).toBe(true);
    expect(deltaEvent?.data.type).toBe('delta');
    expect(deltaEvent?.data.delta).toBeTruthy();

    const sourcesEvent = events.find((e) => e.event === 'sources');
    expect(StreamEventSourcesSchema.safeParse(sourcesEvent?.data).success).toBe(true);
    expect(sourcesEvent?.data.type).toBe('sources');

    const usageEvent = events.find((e) => e.event === 'usage');
    expect(StreamEventUsageSchema.safeParse(usageEvent?.data).success).toBe(true);
    expect(usageEvent?.data.type).toBe('usage');

    const doneEvent = events.find((e) => e.event === 'done');
    expect(StreamEventDoneSchema.safeParse(doneEvent?.data).success).toBe(true);
    expect(doneEvent?.data.type).toBe('done');
  });

  it('sends correct citation data in sources event', async () => {
    const { events } = await collectSSE(app, '/chats/chat-1/messages', {
      content: 'Tell me about neural networks',
    });

    const sourcesEvent = events.find((e) => e.event === 'sources');
    expect(sourcesEvent).toBeDefined();
    const sources: Citation[] = sourcesEvent!.data.sources;
    expect(sources.length).toBeGreaterThan(0);

    // Each citation must have required fields
    for (const src of sources) {
      expect(src.n).toBeGreaterThan(0);
      expect(src.documentId).toBeTruthy();
      expect(src.fileName).toBeTruthy();
      expect(src.page).toBeGreaterThan(0);
      expect(src.snippet).toBeTruthy();
    }
  });

  it('saves user and assistant messages', async () => {
    await collectSSE(app, '/chats/chat-1/messages', {
      content: 'Test question',
    });

    expect(fakeMessagesDB.messages).toHaveLength(2);
    expect(fakeMessagesDB.messages[0].role).toBe('user');
    expect(fakeMessagesDB.messages[0].content).toBe('Test question');
    expect(fakeMessagesDB.messages[1].role).toBe('assistant');
    expect(fakeMessagesDB.messages[1].content).toBeTruthy();
  });

  it('updates free token usage', async () => {
    await collectSSE(app, '/chats/chat-1/messages', {
      content: 'Test',
    });

    const used = fakeUsageDB.usage.get('user-1') ?? 0;
    expect(used).toBeGreaterThan(0);
  });

  it('generates title for first message', async () => {
    await collectSSE(app, '/chats/chat-1/messages', {
      content: 'What is deep learning?',
    });

    expect(fakeMessagesDB.chats[0].title).toBe('What is deep learning?');
  });

  it('truncates long titles', async () => {
    const longQuestion = 'A'.repeat(100);
    await collectSSE(app, '/chats/chat-1/messages', {
      content: longQuestion,
    });

    expect(fakeMessagesDB.chats[0].title!.length).toBeLessThanOrEqual(60);
    expect(fakeMessagesDB.chats[0].title!.endsWith('...')).toBe(true);
  });

  it('returns 404 for nonexistent chat', async () => {
    const server = app.listen(0);
    const addr = server.address();
    if (!addr || typeof addr === 'string') throw new Error('bad');
    const res = await fetch(`http://127.0.0.1:${(addr as any).port}/chats/nonexistent/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'test' }),
    });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe('NOT_FOUND');
    server.close();
  });

  it('returns 400 for invalid body', async () => {
    const server = app.listen(0);
    const addr = server.address();
    if (!addr || typeof addr === 'string') throw new Error('bad');
    const res = await fetch(`http://127.0.0.1:${(addr as any).port}/chats/chat-1/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('VALIDATION_ERROR');
    server.close();
  });

  it('returns 403 for wrong user', async () => {
    // Override userId to a different user
    const wrongUserApp = express();
    wrongUserApp.use(express.json());
    wrongUserApp.use((req, _res, next) => {
      (req as any).userId = 'other-user';
      next();
    });

    const router = createMessagesRouter({
      embedder: new FakeEmbedder(768),
      retrievalDB: createFakeRetrievalDB(),
      summaryDB: createFakeSummaryDB(),
      messagesDB: fakeMessagesDB,
      usageDB: fakeUsageDB,
      keysDB: createFakeKeysDB(),
      documentsDB: createFakeDocumentsDB(),
      getProviderFn: () => fakeLLM,
    });
    wrongUserApp.use('/chats/:id/messages', router);

    const server = wrongUserApp.listen(0);
    const addr = server.address();
    if (!addr || typeof addr === 'string') throw new Error('bad');
    const res = await fetch(`http://127.0.0.1:${(addr as any).port}/chats/chat-1/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'test' }),
    });
    expect(res.status).toBe(403);
    server.close();
  });

  it('handles summary queries using stored summaries and emits citations', async () => {
    const { events } = await collectSSE(app, '/chats/chat-1/messages', {
      content: 'Summarize this document',
    });

    const eventTypes = events.map((e) => e.event);
    expect(eventTypes).toContain('delta');
    expect(eventTypes).toContain('sources');
    expect(eventTypes).toContain('done');

    // The LLM should have received the summary context
    expect(fakeLLM.lastRequest?.system).toContain('summary');

    // Sources event should contain citations for the summary sections
    const sourcesEvent = events.find((e) => e.event === 'sources');
    expect(sourcesEvent).toBeDefined();
    expect(sourcesEvent!.data.sources.length).toBeGreaterThan(0);
    expect(sourcesEvent!.data.sources[0].fileName).toBe(`${TEST_DOC_ID}.pdf`);
    expect(sourcesEvent!.data.sources[0].snippet).toContain('Introduction');
  });

  it('prepends previous user question for follow-up without duplicating current turn', async () => {
    // Add prior turn in history
    fakeMessagesDB.messages.push(
      {
        id: 'prior-1',
        chatId: 'chat-1',
        role: 'user',
        content: 'What is deep learning?',
        sources: null,
        tokensIn: null,
        tokensOut: null,
        createdAt: new Date(Date.now() - 10000),
      },
      {
        id: 'prior-2',
        chatId: 'chat-1',
        role: 'assistant',
        content: 'Deep learning is a subset of machine learning based on neural networks.',
        sources: null,
        tokensIn: 20,
        tokensOut: 15,
        createdAt: new Date(Date.now() - 5000),
      },
    );

    let capturedQuery = '';
    const spyEmbedder = {
      dimension: 768,
      async embed(text: string) {
        capturedQuery = text;
        return new FakeEmbedder(768).embed(text);
      },
      async embedBatch(texts: string[]) {
        return new FakeEmbedder(768).embedBatch(texts);
      },
    };

    const followUpApp = express();
    followUpApp.use(express.json());
    followUpApp.use((req, _res, next) => {
      (req as any).userId = 'user-1';
      next();
    });

    const router = createMessagesRouter({
      embedder: spyEmbedder,
      retrievalDB: createFakeRetrievalDB(),
      summaryDB: createFakeSummaryDB(),
      messagesDB: fakeMessagesDB,
      usageDB: fakeUsageDB,
      keysDB: createFakeKeysDB(),
      documentsDB: createFakeDocumentsDB(),
      getProviderFn: () => fakeLLM,
    });
    followUpApp.use('/chats/:id/messages', router);

    await collectSSE(followUpApp, '/chats/chat-1/messages', {
      content: 'How do CNNs work?',
    });

    // Follow-up retrieval query should concatenate prior user message + current question
    expect(capturedQuery).toBe('What is deep learning? How do CNNs work?');

    // LLM request messages should not duplicate the current question
    const llmMessages = fakeLLM.lastRequest?.messages ?? [];
    const userTurns = llmMessages.filter((m) => m.role === 'user');
    // Exactly 2 user turns: the prior one and the current one
    expect(userTurns).toHaveLength(2);
    expect(userTurns[0].content).toBe('What is deep learning?');
    expect(userTurns[1].content).toBe('How do CNNs work?');
  });

  it('resolves BYOK credentials when user has an openai key', async () => {
    const openaiKeyProvider = new FakeLLMProvider('openai', ['OpenAI BYOK response']);
    const customKeysDB: KeysDB = {
      async getUserProviderKey(_userId, provider) {
        if (provider === 'openai') return 'sk-user-openai-key';
        return null;
      },
    };

    const byokApp = express();
    byokApp.use(express.json());
    byokApp.use((req, _res, next) => {
      (req as any).userId = 'user-1';
      next();
    });

    const router = createMessagesRouter({
      embedder: new FakeEmbedder(768),
      retrievalDB: createFakeRetrievalDB(),
      summaryDB: createFakeSummaryDB(),
      messagesDB: fakeMessagesDB,
      usageDB: fakeUsageDB,
      keysDB: customKeysDB,
      documentsDB: createFakeDocumentsDB(),
      getProviderFn: (id) => (id === 'openai' ? openaiKeyProvider : fakeLLM),
    });
    byokApp.use('/chats/:id/messages', router);

    const { events } = await collectSSE(byokApp, '/chats/chat-1/messages', {
      content: 'BYOK question',
    });

    expect(events.some((e) => e.event === 'delta')).toBe(true);
    expect(openaiKeyProvider.lastRequest?.apiKey).toBe('sk-user-openai-key');
    expect(openaiKeyProvider.lastRequest?.model).toBe('gpt-4.1-mini');
  });

  it('uses user-provided key when available (BYOK)', async () => {
    const customKeyProvider = new FakeLLMProvider('gemini', ['BYOK response']);
    const customKeysDB: KeysDB = {
      async getUserProviderKey(_userId, _provider) {
        return 'user-custom-api-key';
      },
    };

    const byokApp = express();
    byokApp.use(express.json());
    byokApp.use((req, _res, next) => {
      (req as any).userId = 'user-1';
      next();
    });

    const router = createMessagesRouter({
      embedder: new FakeEmbedder(768),
      retrievalDB: createFakeRetrievalDB(),
      summaryDB: createFakeSummaryDB(),
      messagesDB: fakeMessagesDB,
      usageDB: fakeUsageDB,
      keysDB: customKeysDB,
      documentsDB: createFakeDocumentsDB(),
      getProviderFn: () => customKeyProvider,
    });
    byokApp.use('/chats/:id/messages', router);

    const { events } = await collectSSE(byokApp, '/chats/chat-1/messages', {
      content: 'BYOK question',
    });

    expect(events.some((e) => e.event === 'delta')).toBe(true);
    expect(customKeyProvider.lastRequest?.apiKey).toBe('user-custom-api-key');
  });

  it('returns 402 KEY_REQUIRED when free budget is exhausted and no own key', async () => {
    const exhaustedUsageDB: UsageDB = {
      async getFreeTokensUsed() {
        return 100_000; // >= FREE_TOKEN_CAP (default 50,000)
      },
      async addFreeTokensUsed() {},
    };

    const exhaustedApp = express();
    exhaustedApp.use(express.json());
    exhaustedApp.use((req, _res, next) => {
      (req as any).userId = 'user-1';
      next();
    });

    const router = createMessagesRouter({
      embedder: new FakeEmbedder(768),
      retrievalDB: createFakeRetrievalDB(),
      summaryDB: createFakeSummaryDB(),
      messagesDB: fakeMessagesDB,
      usageDB: exhaustedUsageDB,
      keysDB: createFakeKeysDB(),
      documentsDB: createFakeDocumentsDB(),
      getProviderFn: () => fakeLLM,
    });
    exhaustedApp.use('/chats/:id/messages', router);

    const server = exhaustedApp.listen(0);
    const addr = server.address();
    if (!addr || typeof addr === 'string') throw new Error('bad');
    const res = await fetch(`http://127.0.0.1:${(addr as any).port}/chats/chat-1/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'Test question' }),
    });

    expect(res.status).toBe(402);
    const body = await res.json();
    expect(body.error.code).toBe('KEY_REQUIRED');
    server.close();
  });

  it('streams response even when chat has no attached documents', async () => {
    const emptyDocMessagesDB = createFakeMessagesDB();
    // Chat with no documents
    emptyDocMessagesDB.chats.push({ id: 'chat-empty', userId: 'user-1', title: null });

    const noDocApp = express();
    noDocApp.use(express.json());
    noDocApp.use((req, _res, next) => {
      (req as any).userId = 'user-1';
      next();
    });

    const router = createMessagesRouter({
      embedder: new FakeEmbedder(768),
      retrievalDB: createFakeRetrievalDB(),
      summaryDB: createFakeSummaryDB(),
      messagesDB: emptyDocMessagesDB,
      usageDB: fakeUsageDB,
      keysDB: createFakeKeysDB(),
      documentsDB: createFakeDocumentsDB(),
      getProviderFn: () => fakeLLM,
    });
    noDocApp.use('/chats/:id/messages', router);

    const { events } = await collectSSE(noDocApp, '/chats/chat-empty/messages', {
      content: 'General question without documents',
    });

    const eventTypes = events.map((e) => e.event);
    expect(eventTypes).toContain('delta');
    expect(eventTypes).toContain('usage');
    expect(eventTypes).toContain('done');
    // sources event should not be sent when 0 sources
    expect(eventTypes).not.toContain('sources');
  });


  it('never exposes API keys in error messages', async () => {
    // Create a provider that throws with a key in the error
    const badProvider = new FakeLLMProvider('bad');
    badProvider.setResponses([]);
    const errorProvider = {
      id: 'bad',
      // eslint-disable-next-line require-yield
      async *stream() {
        throw new Error('Invalid key=sk-secret123 for Bearer tok-abc');
      },
    };

    const errorApp = express();
    errorApp.use(express.json());
    errorApp.use((req, _res, next) => {
      (req as any).userId = 'user-1';
      next();
    });

    const router = createMessagesRouter({
      embedder: new FakeEmbedder(768),
      retrievalDB: createFakeRetrievalDB(),
      summaryDB: createFakeSummaryDB(),
      messagesDB: fakeMessagesDB,
      usageDB: fakeUsageDB,
      keysDB: createFakeKeysDB(),
      documentsDB: createFakeDocumentsDB(),
      getProviderFn: () => errorProvider,
    });
    errorApp.use('/chats/:id/messages', router);

    const { events, raw } = await collectSSE(errorApp, '/chats/chat-1/messages', {
      content: 'Test error',
    });

    // Should have an error event
    const errorEvent = events.find((e) => e.event === 'error');
    if (errorEvent) {
      expect(errorEvent.data.message).not.toContain('sk-secret123');
      expect(errorEvent.data.message).not.toContain('tok-abc');
      expect(errorEvent.data.message).toContain('***');
    }
    // Raw should not contain keys either
    expect(raw).not.toContain('sk-secret123');
    expect(raw).not.toContain('tok-abc');
  });
});

describe('Messages GET handler', () => {
  it('returns message history', async () => {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      (req as any).userId = 'user-1';
      next();
    });

    const fakeMessagesDB = createFakeMessagesDB();
    // Pre-populate some messages
    fakeMessagesDB.messages.push(
      { id: 'msg-1', chatId: 'chat-1', role: 'user', content: 'Hello', sources: null, tokensIn: null, tokensOut: null, createdAt: new Date() },
      { id: 'msg-2', chatId: 'chat-1', role: 'assistant', content: 'Hi!', sources: null, tokensIn: 10, tokensOut: 5, createdAt: new Date() },
    );

    const router = createMessagesRouter({
      embedder: new FakeEmbedder(768),
      retrievalDB: createFakeRetrievalDB(),
      summaryDB: createFakeSummaryDB(),
      messagesDB: fakeMessagesDB,
      usageDB: createFakeUsageDB(),
      keysDB: createFakeKeysDB(),
      documentsDB: createFakeDocumentsDB(),
      getProviderFn: () => new FakeLLMProvider(),
    });
    app.use('/chats/:id/messages', router);

    const server = app.listen(0);
    const addr = server.address();
    if (!addr || typeof addr === 'string') throw new Error('bad');
    const res = await fetch(`http://127.0.0.1:${(addr as any).port}/chats/chat-1/messages`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.messages).toHaveLength(2);
    expect(body.messages[0].id).toBe('msg-1');
    server.close();
  });
});

describe('Drizzle Messages DB Adapters (PGlite real schema)', () => {
  it('manages chats and messages with real database queries', async () => {
    const testDb = await createTestDatabase();
    try {
      const messagesDB = createDrizzleMessagesDB(testDb.db);

      const userId1 = uuid();
      await testDb.db.insert(users).values({ id: userId1, email: 'user-db-1@test.com' });
      // Create a test chat
      const [chat] = await testDb.db
        .insert(chats)
        .values({
          userId: userId1,
          title: 'Initial Title',
        })
        .returning();

      expect(chat).toBeDefined();

      // Test getChat
      const fetchedChat = await messagesDB.getChat(chat.id);
      expect(fetchedChat).toBeDefined();
      expect(fetchedChat?.id).toBe(chat.id);
      expect(fetchedChat?.userId).toBe(userId1);

      // Test updateChatTitle
      await messagesDB.updateChatTitle(chat.id, 'Updated Title');
      const updatedChat = await messagesDB.getChat(chat.id);
      expect(updatedChat?.title).toBe('Updated Title');

      // Test saveMessage and getRecentMessages
      const msgId1 = uuid();
      const msgId2 = uuid();
      const docId1 = uuid();
      await messagesDB.saveMessage({
        id: msgId1,
        chatId: chat.id,
        role: 'user',
        content: 'Hello database',
        sources: null,
        tokensIn: 5,
        tokensOut: 0,
      });

      await messagesDB.saveMessage({
        id: msgId2,
        chatId: chat.id,
        role: 'assistant',
        content: 'Hello from DB assistant',
        sources: [
          {
            n: 1,
            documentId: docId1,
            fileName: 'test.pdf',
            page: 1,
            snippet: 'sample',
          },
        ],
        tokensIn: 10,
        tokensOut: 20,
      });

      const recent = await messagesDB.getRecentMessages(chat.id, 10);
      expect(recent).toHaveLength(2);
      expect(recent[0].content).toBe('Hello database');
      expect(recent[1].content).toBe('Hello from DB assistant');
      expect(recent[1].sources).toHaveLength(1);
    } finally {
      await testDb.close();
    }
  });

  it('decrypts user provider keys and scopes documents correctly', async () => {
    const testDb = await createTestDatabase();
    const masterKey = Buffer.alloc(32, 0x42);
    try {
      const keysDB = createDrizzleKeysDB(testDb.db, masterKey);
      const docsDB = createDrizzleDocumentsDB(testDb.db);

      const userId = uuid();
      const otherUserId = uuid();
      await testDb.db.insert(users).values([
        { id: userId, email: 'user-db-2@test.com' },
        { id: otherUserId, email: 'other-user@test.com' },
      ]);
      const provider = 'openai';
      const secret = 'sk-live-decrypted-test-key';

      // Insert an encrypted key
      const encrypted = encryptProviderKey(secret, masterKey, keyAad(userId, provider));
      await testDb.db.insert(providerKeys).values({
        userId,
        provider,
        ciphertext: encrypted.ciphertext,
        iv: encrypted.iv,
        authTag: encrypted.authTag,
      });

      const decrypted = await keysDB.getUserProviderKey(userId, provider);
      expect(decrypted).toBe(secret);

      // Other provider returns null
      const nonExistent = await keysDB.getUserProviderKey(userId, 'gemini');
      expect(nonExistent).toBeNull();

      // Test documents scoping
      const [userDoc] = await testDb.db
        .insert(documents)
        .values({
          userId,
          name: 'user.pdf',
          mime: 'application/pdf',
          sizeBytes: 1024,
          storageKey: 'key-1',
          isDemo: false,
        })
        .returning();

      const [otherDoc] = await testDb.db
        .insert(documents)
        .values({
          userId: otherUserId,
          name: 'other.pdf',
          mime: 'application/pdf',
          sizeBytes: 1024,
          storageKey: 'key-2',
          isDemo: false,
        })
        .returning();

      const [demoDoc] = await testDb.db
        .insert(documents)
        .values({
          userId: null,
          name: 'demo.pdf',
          mime: 'application/pdf',
          sizeBytes: 1024,
          storageKey: 'key-3',
          isDemo: true,
        })
        .returning();

      const retrievedDocs = await docsDB.getDocumentsByIds(
        [userDoc.id, otherDoc.id, demoDoc.id],
        userId,
      );

      const retrievedIds = retrievedDocs.map((d) => d.id);
      expect(retrievedIds).toContain(userDoc.id);
      expect(retrievedIds).toContain(demoDoc.id);
      expect(retrievedIds).not.toContain(otherDoc.id); // Other user's doc excluded!
    } finally {
      await testDb.close();
    }
  });
});
