/**
 * POST /chats/:id/messages — streamed SSE response.
 * GET  /chats/:id/messages — paginated message history.
 *
 * This module orchestrates: validation, credential resolution, retrieval,
 * prompt construction, LLM streaming, citation generation, and persistence.
 */

import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import {
  sendMessageBodySchema,
  ErrorCode,
  type Citation,
} from '@contexta/shared';

import { getEnv } from '../../config/env.js';
import { type Embedder } from '../../services/embedding/index.js';
import {
  search,
  buildMessages,
  buildRetrievalQuery,
  detectSummaryIntent,
  buildSummaryContext,
  type RetrievalDB,
  type SummaryDB,
  type SearchHit,
} from '../../services/retrieval/index.js';
import { getProvider, type LLMProvider } from '../../services/llm/index.js';
import {
  initSSE,
  sendDelta,
  sendSources,
  sendUsage,
  sendDone,
  sendError,
  sendKeepAlive,
} from './sse.js';

// ── Dependency injection types ──

export interface ChatRow {
  id: string;
  userId: string;
  title: string | null;
}

export interface MessageRow {
  id: string;
  chatId: string;
  role: 'user' | 'assistant';
  content: string;
  sources: Citation[] | null;
  tokensIn: number | null;
  tokensOut: number | null;
  usedFreeBudget?: boolean | null;
  createdAt: Date;
}

export interface MessagesDB {
  getChat(chatId: string): Promise<ChatRow | null>;
  getChatDocumentIds(chatId: string): Promise<string[]>;
  getRecentMessages(chatId: string, limit: number): Promise<MessageRow[]>;
  saveMessage(msg: Omit<MessageRow, 'createdAt'>): Promise<void>;
  updateChatTitle(chatId: string, title: string): Promise<void>;
}

export interface UsageDB {
  getFreeTokensUsed(userId: string): Promise<number>;
  addFreeTokensUsed(userId: string, tokens: number): Promise<void>;
}

export interface KeysDB {
  getUserProviderKey(userId: string, provider: string): Promise<string | null>;
}

export interface DocumentInfo {
  id: string;
  name: string;
}

export interface DocumentsDB {
  getDocumentsByIds(ids: string[], userId: string): Promise<DocumentInfo[]>;
}

export interface MessagesDeps {
  embedder: Embedder;
  retrievalDB: RetrievalDB;
  summaryDB: SummaryDB;
  messagesDB: MessagesDB;
  usageDB: UsageDB;
  keysDB: KeysDB;
  documentsDB: DocumentsDB;
  /** Override for testing; defaults to getProvider from the LLM registry */
  getProviderFn?: (id: string) => LLMProvider;
}

/**
 * Create the messages router. Dependencies are injected for testability.
 */
export function createMessagesRouter(deps: MessagesDeps): Router {
  const router = Router({ mergeParams: true });

  // POST /chats/:id/messages — stream SSE
  router.post('/', async (req, res) => {
    const chatId = (req.params as { id: string }).id;

    // 1. Validate body
    const parsed = sendMessageBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: { code: ErrorCode.VALIDATION_ERROR, message: parsed.error.message },
      });
      return;
    }
    const { content } = parsed.data;

    // 2. Load chat and check ownership
    const chat = await deps.messagesDB.getChat(chatId);
    if (!chat) {
      res.status(404).json({
        error: { code: ErrorCode.NOT_FOUND, message: 'Chat not found' },
      });
      return;
    }

    // Auth: userId comes from middleware. Support req.userId or req.user.id.
    const userId = ((req as any).userId ?? (req as any).user?.id) as string | undefined;
    if (!userId || chat.userId !== userId) {
      res.status(403).json({
        error: { code: ErrorCode.UNAUTHORIZED, message: 'Not your chat' },
      });
      return;
    }

    // 3. Resolve credentials
    const env = getEnv();
    let apiKey: string;
    let model: string;
    let providerId: string;
    let usingFreeBudget = false;

    // Check user's own keys in order: FREE_CHAT_PROVIDER, then other supported providers
    const providersToCheck = [
      env.FREE_CHAT_PROVIDER,
      'openai',
      'anthropic',
      'gemini',
    ].filter((p, idx, arr) => arr.indexOf(p) === idx);

    let foundKey: { provider: string; key: string } | null = null;
    for (const p of providersToCheck) {
      const userKey = await deps.keysDB.getUserProviderKey(userId, p);
      if (userKey) {
        foundKey = { provider: p, key: userKey };
        break;
      }
    }

    if (foundKey) {
      apiKey = foundKey.key;
      providerId = foundKey.provider;
      if (providerId === 'openai') {
        model = env.OPENAI_DEFAULT_MODEL;
      } else if (providerId === 'anthropic') {
        model = env.ANTHROPIC_DEFAULT_MODEL;
      } else if (providerId === 'gemini') {
        model = env.GEMINI_DEFAULT_MODEL;
      } else {
        model = env.FREE_CHAT_MODEL;
      }
    } else {
      // Check free budget
      const used = await deps.usageDB.getFreeTokensUsed(userId);
      if (used >= env.FREE_TOKEN_CAP) {
        res.status(402).json({
          error: { code: ErrorCode.KEY_REQUIRED, message: 'Free budget exhausted. Add your own API key.' },
        });
        return;
      }
      apiKey = env.FREE_CHAT_API_KEY;
      model = env.FREE_CHAT_MODEL;
      providerId = env.FREE_CHAT_PROVIDER;
      usingFreeBudget = true;
    }

    // 4. Get provider
    const resolveProvider = deps.getProviderFn ?? getProvider;
    let provider: LLMProvider;
    try {
      provider = resolveProvider(providerId);
    } catch {
      res.status(500).json({
        error: { code: ErrorCode.PROVIDER_ERROR, message: `Provider ${providerId} not available` },
      });
      return;
    }

    // 5. Fetch prior chat history before saving current message
    const priorHistory = await deps.messagesDB.getRecentMessages(chatId, 10);
    const isFirstMessage = priorHistory.filter((m) => m.role === 'user').length === 0;
    if (isFirstMessage && !chat.title) {
      const title = content.length > 60 ? content.slice(0, 57) + '...' : content;
      await deps.messagesDB.updateChatTitle(chatId, title);
    }

    // 6. Save current user message
    const userMsgId = uuid();
    await deps.messagesDB.saveMessage({
      id: userMsgId,
      chatId,
      role: 'user',
      content,
      sources: null,
      tokensIn: null,
      tokensOut: null,
      usedFreeBudget: false,
    });

    // 7. Get chat documents
    const documentIds = await deps.messagesDB.getChatDocumentIds(chatId);

    // Resolve document metadata early
    const docMap = new Map<string, string>();
    if (documentIds.length > 0) {
      const docs = await deps.documentsDB.getDocumentsByIds(documentIds, userId);
      for (const doc of docs) {
        docMap.set(doc.id, doc.name);
      }
    }

    // 8. Build retrieval query (with follow-up context from prior history)
    const chatHistory = priorHistory.map((m) => ({ role: m.role, content: m.content }));
    const retrievalQuery = buildRetrievalQuery(content, chatHistory);

    // 9. Detect summary intent
    const summaryIntent = detectSummaryIntent(content);

    // Begin SSE
    initSSE(res);

    // Keep-alive interval
    const keepAliveTimer = setInterval(() => sendKeepAlive(res), 15000);

    // Abort controller for client disconnect
    const abortController = new AbortController();
    req.on('close', () => {
      abortController.abort();
      clearInterval(keepAliveTimer);
    });

    try {
      let hits: SearchHit[] = [];
      let summaryContext: string | undefined;
      const sources: Citation[] = [];

      if (summaryIntent.isSummary && documentIds.length > 0) {
        // Multi-document summary path: collect stored summaries from all documents
        const summaryContexts: string[] = [];

        for (const docId of documentIds) {
          const docName = docMap.get(docId) ?? 'Document';
          const summary = await deps.summaryDB.getDocumentSummary(docId, userId);
          if (summary) {
            const ctx = buildSummaryContext(summary, summaryIntent.sectionHint);
            summaryContexts.push(`--- Document: ${docName} ---\n${ctx}`);

            // Generate citations for the summary
            let matchedSections = summary.sections;
            if (summaryIntent.sectionHint && summaryIntent.sectionHint.trim()) {
              const hint = summaryIntent.sectionHint.toLowerCase().trim();
              const matched = summary.sections.filter(
                (s) =>
                  s.title.toLowerCase().includes(hint) ||
                  String(s.pageStart) === hint ||
                  String(s.pageEnd) === hint ||
                  `${s.pageStart}-${s.pageEnd}`.includes(hint),
              );
              if (matched.length > 0) {
                matchedSections = matched;
              }
            }

            if (matchedSections.length > 0) {
              for (const sec of matchedSections) {
                sources.push({
                  n: sources.length + 1,
                  documentId: docId,
                  fileName: docName,
                  page: sec.pageStart,
                  snippet: `${sec.title}: ${sec.summary}`.slice(0, 200),
                });
              }
            } else if (summary.overview) {
              sources.push({
                n: sources.length + 1,
                documentId: docId,
                fileName: docName,
                page: 1,
                snippet: summary.overview.slice(0, 200),
              });
            }
          }
        }

        if (summaryContexts.length > 0) {
          summaryContext = summaryContexts.join('\n\n');
        } else {
          // If no stored summaries found, fall back to chunk retrieval
          const queryVec = await deps.embedder.embed(retrievalQuery);
          hits = await search(deps.retrievalDB, {
            userId,
            documentIds,
            queryVec,
            queryText: retrievalQuery,
            topK: env.DEFAULT_TOP_K,
            scoreThreshold: env.HYBRID_SEARCH_ENABLED ? 0 : env.DEFAULT_SCORE_THRESHOLD,
            hybridSearch: env.HYBRID_SEARCH_ENABLED,
          });
        }
      } else if (documentIds.length > 0) {
        // Normal retrieval path
        const queryVec = await deps.embedder.embed(retrievalQuery);
        hits = await search(deps.retrievalDB, {
          userId,
          documentIds,
          queryVec,
          queryText: retrievalQuery,
          topK: env.DEFAULT_TOP_K,
          scoreThreshold: env.HYBRID_SEARCH_ENABLED ? 0 : env.DEFAULT_SCORE_THRESHOLD,
          hybridSearch: env.HYBRID_SEARCH_ENABLED,
        });
      }

      // If chunk retrieval returned hits, populate sources
      if (hits.length > 0) {
        for (let i = 0; i < hits.length; i++) {
          const hit = hits[i];
          sources.push({
            n: sources.length + 1,
            documentId: hit.documentId,
            fileName: docMap.get(hit.documentId) ?? hit.documentName,
            page: hit.page,
            snippet: hit.content.length > 200 ? hit.content.slice(0, 197) + '...' : hit.content,
          });
        }
      }

      // 10. Build prompt
      const { system, messages } = buildMessages(
        hits,
        chatHistory,
        content,
        summaryContext,
      );

      // 11. Stream response
      let fullResponse = '';
      let tokensIn = 0;
      let tokensOut = 0;

      for await (const chunk of provider.stream({
        model,
        system,
        messages,
        apiKey,
        signal: abortController.signal,
      })) {
        if (chunk.text) {
          fullResponse += chunk.text;
          sendDelta(res, chunk.text);
        }
        if (chunk.usage) {
          if (chunk.usage.in > 0) tokensIn = chunk.usage.in;
          if (chunk.usage.out > 0) tokensOut = chunk.usage.out;
        }
      }

      // Send events
      if (sources.length > 0) {
        sendSources(res, sources);
      }
      sendUsage(res, tokensIn, tokensOut);

      // 13. Save assistant message
      const assistantMsgId = uuid();
      await deps.messagesDB.saveMessage({
        id: assistantMsgId,
        chatId,
        role: 'assistant',
        content: fullResponse,
        sources: sources.length > 0 ? sources : null,
        tokensIn,
        tokensOut,
        usedFreeBudget: usingFreeBudget,
      });

      // 14. Update free budget
      if (usingFreeBudget && (tokensIn + tokensOut) > 0) {
        await deps.usageDB.addFreeTokensUsed(userId, tokensIn + tokensOut);
      }

      sendDone(res);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      if (message === 'Aborted' || abortController.signal.aborted) {
        // Client disconnected; nothing to send
      } else {
        // Do not expose provider API keys in error messages
        const safeMessage = message.replace(/key=\S+/gi, 'key=***').replace(/Bearer \S+/gi, 'Bearer ***');
        sendError(res, ErrorCode.PROVIDER_ERROR, safeMessage);
      }
    } finally {
      clearInterval(keepAliveTimer);
      res.end();
    }
  });

  // GET /chats/:id/messages — message history
  router.get('/', async (req, res) => {
    const chatId = (req.params as { id: string }).id;

    const chat = await deps.messagesDB.getChat(chatId);
    if (!chat) {
      res.status(404).json({
        error: { code: ErrorCode.NOT_FOUND, message: 'Chat not found' },
      });
      return;
    }

    const userId = ((req as any).userId ?? (req as any).user?.id) as string | undefined;
    if (!userId || chat.userId !== userId) {
      res.status(403).json({
        error: { code: ErrorCode.UNAUTHORIZED, message: 'Not your chat' },
      });
      return;
    }

    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const messages = await deps.messagesDB.getRecentMessages(chatId, limit);

    res.json({
      messages: messages.map((m) => ({
        id: m.id,
        chatId: m.chatId,
        role: m.role,
        content: m.content,
        sources: m.sources ?? [],
        tokensIn: m.tokensIn ?? 0,
        tokensOut: m.tokensOut ?? 0,
        usedFreeBudget: m.usedFreeBudget ?? false,
        createdAt: m.createdAt.toISOString(),
      })),
    });
  });

  return router;
}
