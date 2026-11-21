import {
  and,
  asc,
  desc,
  eq,
  inArray,
} from 'drizzle-orm';
import { Router } from 'express';
import {
  createChatSchema,
  updateChatSchema,
  type MessageSource,
} from '@contexta/shared';
import type { Db } from '../../db/client.js';
import {
  chatDocuments,
  chats,
  documents,
  messages,
} from '../../db/schema.js';
import { AppError } from '../../lib/errors.js';
import { asyncHandler } from '../../lib/errors.js';
import { parseOrThrow } from '../../lib/validate.js';
import { getRequestUser } from '../../middleware/auth.js';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function parseChatId(value: string | string[] | undefined): string {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    throw AppError.notFound('Chat not found.');
  }
  return value;
}

function toChatResponse(chat: typeof chats.$inferSelect) {
  return {
    id: chat.id,
    title: chat.title,
    pinned: chat.pinned,
    createdAt: chat.createdAt.toISOString(),
    updatedAt: chat.updatedAt.toISOString(),
  };
}

async function getOwnedChat(db: Db, chatId: string, userId: string) {
  const rows = await db
    .select()
    .from(chats)
    .where(and(eq(chats.id, chatId), eq(chats.userId, userId)))
    .limit(1);
  const chat = rows[0];
  if (!chat) {
    throw AppError.notFound('Chat not found.');
  }
  return chat;
}

async function getChatDocumentIds(
  db: Db,
  chatId: string,
): Promise<string[]> {
  const rows = await db
    .select({ documentId: chatDocuments.documentId })
    .from(chatDocuments)
    .where(eq(chatDocuments.chatId, chatId));
  return rows.map((row) => row.documentId);
}

export interface ChatsRouterDependencies {
  db: Db;
}

export function createChatsRouter({
  db,
}: ChatsRouterDependencies): Router {
  const router = Router();

  // POST /chats
  router.post(
    '/',
    asyncHandler(async (req, res) => {
      const user = getRequestUser(req);
      const body = parseOrThrow(createChatSchema, req.body ?? {});
      const documentIds = [...new Set(body.documentIds)];

      const chat = await db.transaction(async (tx) => {
        if (documentIds.length > 0) {
          const ownedDocuments = await tx
            .select({ id: documents.id, status: documents.status })
            .from(documents)
            .where(
              and(
                inArray(documents.id, documentIds),
                eq(documents.userId, user.id),
              ),
            );
          if (ownedDocuments.length !== documentIds.length) {
            throw AppError.notFound(
              'One or more documents were not found.',
            );
          }
          if (ownedDocuments.some((document) => document.status !== 'ready')) {
            throw AppError.conflict(
              'DOCUMENT_NOT_READY',
              'One or more documents are still processing.',
            );
          }
        }

        const inserted = await tx
          .insert(chats)
          .values({
            userId: user.id,
            title: body.title ?? 'New chat',
          })
          .returning();
        const created = inserted[0];
        if (!created) {
          throw AppError.internal();
        }

        if (documentIds.length > 0) {
          await tx.insert(chatDocuments).values(
            documentIds.map((documentId) => ({
              chatId: created.id,
              documentId,
            })),
          );
        }
        return created;
      });

      res.status(201).json({
        ...toChatResponse(chat),
        documentIds,
      });
    }),
  );

  // GET /chats
  router.get(
    '/',
    asyncHandler(async (req, res) => {
      const user = getRequestUser(req);
      const rows = await db
        .select()
        .from(chats)
        .where(eq(chats.userId, user.id))
        .orderBy(desc(chats.pinned), desc(chats.updatedAt));
      res.json({ chats: rows.map(toChatResponse) });
    }),
  );

  // GET /chats/:id
  router.get(
    '/:id',
    asyncHandler(async (req, res) => {
      const user = getRequestUser(req);
      const chatId = parseChatId(req.params.id);
      const chat = await getOwnedChat(db, chatId, user.id);
      const documentIds = await getChatDocumentIds(db, chatId);
      res.json({ ...toChatResponse(chat), documentIds });
    }),
  );

  // PATCH /chats/:id — rename and/or pin
  router.patch(
    '/:id',
    asyncHandler(async (req, res) => {
      const user = getRequestUser(req);
      const chatId = parseChatId(req.params.id);
      const body = parseOrThrow(updateChatSchema, req.body ?? {});

      const updates: Partial<typeof chats.$inferInsert> = {
        updatedAt: new Date(),
      };
      if (body.title !== undefined) updates.title = body.title;
      if (body.pinned !== undefined) updates.pinned = body.pinned;

      const rows = await db
        .update(chats)
        .set(updates)
        .where(and(eq(chats.id, chatId), eq(chats.userId, user.id)))
        .returning();

      const chat = rows[0];
      if (!chat) {
        throw AppError.notFound('Chat not found.');
      }
      res.json(toChatResponse(chat));
    }),
  );

  // DELETE /chats/:id
  router.delete(
    '/:id',
    asyncHandler(async (req, res) => {
      const user = getRequestUser(req);
      const chatId = parseChatId(req.params.id);
      const deleted = await db
        .delete(chats)
        .where(and(eq(chats.id, chatId), eq(chats.userId, user.id)))
        .returning({ id: chats.id });
      if (deleted.length === 0) {
        throw AppError.notFound('Chat not found.');
      }
      res.status(204).send();
    }),
  );

  // GET /chats/:id/messages — ascending history
  router.get(
    '/:id/messages',
    asyncHandler(async (req, res) => {
      const user = getRequestUser(req);
      const chatId = parseChatId(req.params.id);
      await getOwnedChat(db, chatId, user.id);

      const rows = await db
        .select()
        .from(messages)
        .where(eq(messages.chatId, chatId))
        .orderBy(asc(messages.createdAt), asc(messages.id));

      res.json({
        messages: rows.map((message) => ({
          id: message.id,
          chatId: message.chatId,
          role: message.role as 'user' | 'assistant',
          content: message.content,
          sources: (message.sources ?? []) as MessageSource[],
          tokensIn: message.tokensIn ?? 0,
          tokensOut: message.tokensOut ?? 0,
          usedFreeBudget: message.usedFreeBudget ?? false,
          createdAt: message.createdAt.toISOString(),
        })),
      });
    }),
  );

  return router;
}
