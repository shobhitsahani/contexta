import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildMessages } from '../../src/services/retrieval/prompt.js';
import { FakeLLMProvider } from '../../src/services/llm/fake.js';
import { DocumentSummarySchema } from '@contexta/shared';
import { search, type RetrievalDB, type SearchHit } from '../../src/services/retrieval/search.js';
import { authHeader, seedUser } from '../helpers/seed.js';
import { createTestApp } from '../helpers/app.js';
import { createTestDatabase } from '../helpers/testDb.js';

function makeHit(overrides: Partial<SearchHit> = {}): SearchHit {
  return {
    chunkId: 'chunk-1',
    documentId: 'doc-a',
    documentName: 'doc-a.pdf',
    page: 3,
    content: 'Contexta stores uploaded documents and chat history.',
    score: 0.9,
    ...overrides,
  };
}

describe('QA critical paths', () => {
  it('returns 404 for unknown routes and 401 for protected routes', async () => {
    const database = await createTestDatabase();
    const { app } = createTestApp({ db: database.db });
    try {
      await request(app).get('/api/does-not-exist').expect(404);
      await request(app).get('/api/chats').expect(401);
      await request(app).get('/health').expect(200);
    } finally {
      await database.close();
    }
  }, 60_000);

  it('rejects malformed chat bodies for authenticated users', async () => {
    const database = await createTestDatabase();
    const user = await seedUser(database.db, { email: 'qa@example.com' });
    const { app } = createTestApp({ db: database.db });
    try {
      const response = await request(app)
        .post('/api/chats')
        .set(authHeader(user.id))
        .send({ documentIds: 'not-an-array' });
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    } finally {
      await database.close();
    }
  }, 60_000);

  it('isolates retrieval by user and document', async () => {
    const hit = makeHit();
    const db: RetrievalDB = {
      async vectorSearch(userId, documentIds) {
        if (userId !== 'owner' || !documentIds.includes('doc-a')) return [];
        return [hit];
      },
      async fullTextSearch() {
        return [];
      },
    };

    const ownerResult = await search(db, {
      userId: 'owner',
      documentIds: ['doc-a'],
      queryVec: [0.1],
      queryText: 'documents',
      topK: 5,
      scoreThreshold: 0,
      hybridSearch: false,
    });
    expect(ownerResult).toHaveLength(1);

    const otherUserResult = await search(db, {
      userId: 'intruder',
      documentIds: ['doc-a'],
      queryVec: [0.1],
      queryText: 'documents',
      topK: 5,
      scoreThreshold: 0,
      hybridSearch: false,
    });
    expect(otherUserResult).toHaveLength(0);

    const otherDocResult = await search(db, {
      userId: 'owner',
      documentIds: ['doc-b'],
      queryVec: [0.1],
      queryText: 'documents',
      topK: 5,
      scoreThreshold: 0,
      hybridSearch: false,
    });
    expect(otherDocResult).toHaveLength(0);
  });

  it('streams LLM output with usage and supports abort', async () => {
    const provider = new FakeLLMProvider('fake', ['Hello world [1].']);
    const chunks: string[] = [];
    let usageSeen = false;
    for await (const chunk of provider.stream({
      model: 'fake-model',
      system: 'system',
      messages: [{ role: 'user', content: 'hi' }],
      apiKey: 'test',
    })) {
      if (chunk.text) chunks.push(chunk.text);
      if (chunk.usage) usageSeen = true;
    }
    expect(chunks.join('')).toContain('Hello');
    expect(usageSeen).toBe(true);

    const abortingProvider = new FakeLLMProvider('fake', ['one two three four']);
    const controller = new AbortController();
    controller.abort();
    await expect(async () => {
      for await (const _chunk of abortingProvider.stream({
        model: 'fake-model',
        system: 'system',
        messages: [{ role: 'user', content: 'hi' }],
        apiKey: 'test',
        signal: controller.signal,
      })) {
        // consume
      }
    }).rejects.toThrow();
  });

  it('includes refusal instructions for unanswerable questions', () => {
    const { system } = buildMessages([], [], 'What is the capital of Mars?');
    expect(system).toContain("couldn't find this information");
    expect(system).toContain('No relevant sources were found');
  });

  it('validates document summary schema and required facts', () => {
    const summary = {
      overview: 'Contexta stores uploaded documents and supports retrieval.',
      keyPoints: ['Contexta stores uploaded documents', 'Retrieval grounds answers'],
      sections: [
        { title: 'Overview', pageStart: 1, pageEnd: 1, summary: 'Introductory section.' },
      ],
    };
    const parsed = DocumentSummarySchema.parse(summary);
    expect(parsed.keyPoints).toHaveLength(2);

    const requiredFacts = ['Contexta stores uploaded documents'];
    const serialized = JSON.stringify(parsed).toLowerCase();
    for (const fact of requiredFacts) {
      expect(serialized).toContain(fact.toLowerCase());
    }
  });
});
