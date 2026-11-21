import { z } from "zod";

/** Stable error codes shared by the API and web client. */
export const ERROR_CODES = [
  "BAD_REQUEST",
  "VALIDATION_ERROR",
  "UNAUTHORIZED",
  "EMAIL_NOT_VERIFIED",
  "FORBIDDEN",
  "NOT_FOUND",
  "CONFLICT",
  "KEY_REQUIRED",
  "RATE_LIMITED",
  "PROVIDER_KEY_INVALID",
  "PROVIDER_UNAVAILABLE",
  "PROVIDER_ERROR",
  "INVALID_DOCUMENT",
  "DOCUMENT_NOT_READY",
  "FILE_TOO_LARGE",
  "UNSUPPORTED_TYPE",
  "INGESTION_FAILED",
  "INTERNAL_ERROR",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export const apiErrorSchema = z.object({
  error: z.object({
    code: z.enum(ERROR_CODES),
    message: z.string(),
    requestId: z.string().optional(),
  }),
});

export type ApiError = z.infer<typeof apiErrorSchema>;

/** Supported BYOK / chat providers. No custom base URLs in v1. */
export const providerSchema = z.enum(["gemini", "openai", "anthropic"]);
export type Provider = z.infer<typeof providerSchema>;

export const providerListSchema = z.array(providerSchema);

export const chatTitleSchema = z.string().trim().min(1).max(120);

export const createChatSchema = z.object({
  title: chatTitleSchema.optional(),
  documentIds: z.array(z.uuid()).max(20).optional().default([]),
});

export type CreateChatInput = z.input<typeof createChatSchema>;
export type CreateChatBody = z.output<typeof createChatSchema>;

export const updateChatSchema = z
  .object({
    title: chatTitleSchema.optional(),
    pinned: z.boolean().optional(),
  })
  .refine((value) => value.title !== undefined || value.pinned !== undefined, {
    message: "Provide at least one of title or pinned.",
  });

export type UpdateChatInput = z.infer<typeof updateChatSchema>;

export const sourceSchema = z.object({
  n: z.number().int().positive(),
  documentId: z.uuid(),
  fileName: z.string(),
  page: z.number().int().positive().nullable(),
  snippet: z.string(),
});

export type MessageSource = z.infer<typeof sourceSchema>;

export const messageRoleSchema = z.enum(["user", "assistant"]);
export type MessageRole = z.infer<typeof messageRoleSchema>;

export const messageSchema = z.object({
  id: z.uuid(),
  chatId: z.uuid(),
  role: messageRoleSchema,
  content: z.string(),
  sources: z.array(sourceSchema).nullable(),
  tokensIn: z.number().int().nonnegative(),
  tokensOut: z.number().int().nonnegative(),
  usedFreeBudget: z.boolean(),
  createdAt: z.string(),
});

export type Message = z.infer<typeof messageSchema>;

export const chatSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  pinned: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type Chat = z.infer<typeof chatSchema>;

export const chatWithDocumentsSchema = chatSchema.extend({
  documentIds: z.array(z.uuid()),
});

export type ChatWithDocuments = z.infer<typeof chatWithDocumentsSchema>;

export const chatListResponseSchema = z.object({
  chats: z.array(chatSchema),
});

export const chatMessagesResponseSchema = z.object({
  messages: z.array(messageSchema),
});

export const providerKeyBodySchema = z.object({
  provider: providerSchema,
  apiKey: z.string().trim().min(8).max(4096),
});

export type ProviderKeyBody = z.infer<typeof providerKeyBodySchema>;

export const providerKeyListResponseSchema = z.object({
  providers: z.array(
    z.object({
      provider: providerSchema,
      createdAt: z.string(),
    }),
  ),
});

export const providerKeyDeleteQuerySchema = z.object({
  provider: providerSchema.optional(),
});

export const usageResponseSchema = z.object({
  freeTokensUsed: z.number().int().nonnegative(),
  freeTokensCap: z.number().int().positive(),
  freeTokensRemaining: z.number().int().nonnegative(),
  hasOwnKey: z.boolean(),
  emailVerified: z.boolean(),
  freeTierEligible: z.boolean(),
  keyRequired: z.boolean(),
});

export type UsageResponse = z.infer<typeof usageResponseSchema>;

export const HEALTH_PATH = "/health";
export const AUTH_BASE_PATH = "/api/auth";

import {
  ContextaError,
  DocumentStatusSchema,
  type DocumentStatus,
  DocumentSchema,
  type Document,
  UploadResponseSchema,
  type UploadResponse,
  DocumentSummarySectionSchema,
  type DocumentSummarySection,
  DocumentSummarySchema,
  type DocumentSummary,
  SendMessageRequestSchema,
  type SendMessageRequest,
  SourceSchema,
  type Source,
  StreamEventDeltaSchema,
  type StreamEventDelta,
  StreamEventSourcesSchema,
  type StreamEventSources,
  StreamEventUsageSchema,
  type StreamEventUsage,
  StreamEventDoneSchema,
  type StreamEventDone,
  StreamEventErrorSchema,
  type StreamEventError,
  StreamEventSchema,
  type StreamEvent,
  UsageSchema,
  type Usage,
  API_ROUTES,
} from './schemas.js';

export {
  ContextaError,
  DocumentStatusSchema,
  type DocumentStatus,
  DocumentSchema,
  type Document,
  UploadResponseSchema,
  type UploadResponse,
  DocumentSummarySectionSchema,
  type DocumentSummarySection,
  DocumentSummarySchema,
  type DocumentSummary,
  SendMessageRequestSchema,
  type SendMessageRequest,
  SourceSchema,
  type Source,
  StreamEventDeltaSchema,
  type StreamEventDelta,
  StreamEventSourcesSchema,
  type StreamEventSources,
  StreamEventUsageSchema,
  type StreamEventUsage,
  StreamEventDoneSchema,
  type StreamEventDone,
  StreamEventErrorSchema,
  type StreamEventError,
  StreamEventSchema,
  type StreamEvent,
  UsageSchema,
  type Usage,
  API_ROUTES,
};

export type Citation = MessageSource;
export const citationSchema = sourceSchema;
export const sendMessageBodySchema = SendMessageRequestSchema;
export type SendMessageBody = SendMessageRequest;

export const ErrorCode = Object.fromEntries(
  ERROR_CODES.map((code) => [code, code]),
) as { readonly [K in ErrorCode]: K };

