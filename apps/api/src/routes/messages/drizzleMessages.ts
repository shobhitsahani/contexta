import { and, desc, eq, inArray, or } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { chats, chatDocuments, documents, messages, providerKeys } from '../../db/schema.js';
import { decryptProviderKey, keyAad } from '../../services/keys.js';
import { UsageService } from '../../services/usage.js';
import { getEnv } from '../../config/env.js';
import { createDrizzleRetrievalDB, createDrizzleSummaryDB } from '../../services/retrieval/drizzleRetrieval.js';
import type { Embedder } from '../../services/embedding/embedder.js';
import type {
  MessagesDB,
  KeysDB,
  DocumentsDB,
  MessagesDeps,
  MessageRow,
} from './handler.js';
import type { Citation } from '@contexta/shared';

export function createDrizzleMessagesDB(db: Db): MessagesDB {
  return {
    async getChat(chatId: string) {
      const rows = await db
        .select({
          id: chats.id,
          userId: chats.userId,
          title: chats.title,
        })
        .from(chats)
        .where(eq(chats.id, chatId))
        .limit(1);
      if (rows.length === 0) return null;
      return {
        id: rows[0].id,
        userId: rows[0].userId ?? '',
        title: rows[0].title,
      };
    },

    async getChatDocumentIds(chatId: string): Promise<string[]> {
      const rows = await db
        .select({ documentId: chatDocuments.documentId })
        .from(chatDocuments)
        .where(eq(chatDocuments.chatId, chatId));
      return rows.map((r) => r.documentId);
    },

    async getRecentMessages(chatId: string, limit: number): Promise<MessageRow[]> {
      const rows = await db
        .select({
          id: messages.id,
          chatId: messages.chatId,
          role: messages.role,
          content: messages.content,
          sources: messages.sources,
          tokensIn: messages.tokensIn,
          tokensOut: messages.tokensOut,
          usedFreeBudget: messages.usedFreeBudget,
          createdAt: messages.createdAt,
        })
        .from(messages)
        .where(eq(messages.chatId, chatId))
        .orderBy(desc(messages.createdAt), desc(messages.id))
        .limit(limit);

      // Return in chronological order
      return rows.reverse().map((r) => ({
        id: r.id,
        chatId: r.chatId,
        role: r.role as 'user' | 'assistant',
        content: r.content,
        sources: (r.sources as Citation[]) ?? null,
        tokensIn: r.tokensIn,
        tokensOut: r.tokensOut,
        usedFreeBudget: r.usedFreeBudget,
        createdAt: r.createdAt,
      }));
    },

    async saveMessage(msg: Omit<MessageRow, 'createdAt'>): Promise<void> {
      await db.insert(messages).values({
        id: msg.id,
        chatId: msg.chatId,
        role: msg.role,
        content: msg.content,
        sources: msg.sources,
        tokensIn: msg.tokensIn ?? 0,
        tokensOut: msg.tokensOut ?? 0,
        usedFreeBudget: msg.usedFreeBudget ?? false,
      });
    },

    async updateChatTitle(chatId: string, title: string): Promise<void> {
      await db
        .update(chats)
        .set({ title, updatedAt: new Date() })
        .where(eq(chats.id, chatId));
    },
  };
}

export function createDrizzleKeysDB(db: Db, masterKey: Buffer): KeysDB {
  return {
    async getUserProviderKey(userId: string, provider: string): Promise<string | null> {
      const rows = await db
        .select({
          ciphertext: providerKeys.ciphertext,
          iv: providerKeys.iv,
          authTag: providerKeys.authTag,
        })
        .from(providerKeys)
        .where(
          and(
            eq(providerKeys.userId, userId),
            eq(providerKeys.provider, provider),
          ),
        )
        .limit(1);

      if (rows.length === 0) return null;
      const row = rows[0];

      try {
        return decryptProviderKey(
          {
            ciphertext: row.ciphertext,
            iv: row.iv,
            authTag: row.authTag,
          },
          masterKey,
          keyAad(userId, provider),
        );
      } catch {
        return null;
      }
    },
  };
}

export function createDrizzleDocumentsDB(db: Db): DocumentsDB {
  return {
    async getDocumentsByIds(ids: string[], userId: string) {
      if (ids.length === 0) return [];

      const rows = await db
        .select({
          id: documents.id,
          name: documents.name,
        })
        .from(documents)
        .where(
          and(
            inArray(documents.id, ids),
            or(eq(documents.userId, userId), eq(documents.isDemo, true)),
          ),
        );

      return rows;
    },
  };
}

export interface DrizzleMessagesDepsOptions {
  db: Db;
  masterKey: Buffer;
  embedder: Embedder;
  freeTokensCap?: number;
}

export function createDrizzleMessagesDeps(opts: DrizzleMessagesDepsOptions): MessagesDeps {
  const cap = opts.freeTokensCap ?? getEnv().FREE_TOKEN_CAP;
  const usageService = new UsageService(opts.db, { freeTokensCap: cap });
  return {
    embedder: opts.embedder,
    retrievalDB: createDrizzleRetrievalDB(opts.db),
    summaryDB: createDrizzleSummaryDB(opts.db),
    messagesDB: createDrizzleMessagesDB(opts.db),
    usageDB: {
      async getFreeTokensUsed(userId: string) {
        return usageService.getFreeTokensUsed(userId);
      },
      async addFreeTokensUsed(userId: string, tokens: number) {
        await usageService.addFreeTokensUsed(userId, tokens);
      },
    },
    keysDB: createDrizzleKeysDB(opts.db, opts.masterKey),
    documentsDB: createDrizzleDocumentsDB(opts.db),
  };
}
