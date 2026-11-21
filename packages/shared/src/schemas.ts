import { z } from "zod";

/* ------------------------------------------------------------------ */
/* Common primitives                                                  */
/* ------------------------------------------------------------------ */

export const uuidSchema = z.string().uuid();
export const nonEmptyString = z.string().min(1);

/* ------------------------------------------------------------------ */
/* Error contract (shared by API and UI)                              */
/* ------------------------------------------------------------------ */

export const ErrorCodeSchema = z.enum([
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
  "INVALID_DOCUMENT",
  "DOCUMENT_NOT_READY",
  "FILE_TOO_LARGE",
  "UNSUPPORTED_TYPE",
  "INGESTION_FAILED",
  "INTERNAL_ERROR",
  "UNKNOWN",
]);
export type ErrorCodeType = z.infer<typeof ErrorCodeSchema>;

export const APIErrorSchema = z.object({
  error: z.object({
    code: ErrorCodeSchema,
    message: z.string(),
  }),
});
export type APIError = z.infer<typeof APIErrorSchema>;

export class ContextaError extends Error {
  public readonly code: string;
  public readonly status: number;

  constructor({
    code,
    message,
    status = 500,
  }: {
    code: string;
    message: string;
    status?: number;
  }) {
    super(message);
    this.name = "ContextaError";
    this.code = code;
    this.status = status;
  }
}

/* ------------------------------------------------------------------ */
/* Auth                                                               */
/* ------------------------------------------------------------------ */

export const SignupRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(1).optional(),
});
export type SignupRequest = z.infer<typeof SignupRequestSchema>;

export const LoginRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

export const GoogleLoginRequestSchema = z.object({
  credential: z.string().min(1),
});
export type GoogleLoginRequest = z.infer<typeof GoogleLoginRequestSchema>;

export const VerifyEmailRequestSchema = z.object({
  email: z.string().email(),
  token: z.string().min(1),
});
export type VerifyEmailRequest = z.infer<typeof VerifyEmailRequestSchema>;

export const ForgotPasswordRequestSchema = z.object({
  email: z.string().email(),
});
export type ForgotPasswordRequest = z.infer<typeof ForgotPasswordRequestSchema>;

export const ResetPasswordRequestSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(8),
});
export type ResetPasswordRequest = z.infer<typeof ResetPasswordRequestSchema>;

export const UserSchema = z.object({
  id: uuidSchema,
  email: z.string().email(),
  name: z.string().nullable(),
  emailVerified: z.boolean().default(false),
  image: z.string().url().nullable().optional(),
  createdAt: z.string().datetime(),
});
export type User = z.infer<typeof UserSchema>;

export const AuthResponseSchema = z.object({
  user: UserSchema,
  token: z.string().optional(),
});
export type AuthResponse = z.infer<typeof AuthResponseSchema>;

/* ------------------------------------------------------------------ */
/* Documents                                                          */
/* ------------------------------------------------------------------ */

export const DocumentStatusSchema = z.enum([
  "queued",
  "parsing",
  "embedding",
  "ready",
  "failed",
]);
export type DocumentStatus = z.infer<typeof DocumentStatusSchema>;

export const DocumentSchema = z.object({
  id: uuidSchema,
  userId: uuidSchema.nullable(),
  name: nonEmptyString,
  mime: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  status: DocumentStatusSchema,
  error: z.string().nullable().optional(),
  pageCount: z.number().int().nonnegative().nullable().optional(),
  isDemo: z.boolean().default(false),
  summaryStatus: z.enum(["pending", "ready", "failed", "skipped"]).default("pending"),
  createdAt: z.string(),
});
export type Document = z.infer<typeof DocumentSchema>;

export const UploadResponseSchema = z.object({
  id: uuidSchema,
  status: z.literal("queued"),
});
export type UploadResponse = z.infer<typeof UploadResponseSchema>;

export const DocumentSummarySectionSchema = z.object({
  title: nonEmptyString,
  pageStart: z.number().int().nonnegative().nullable().optional(),
  pageEnd: z.number().int().nonnegative().nullable().optional(),
  summary: nonEmptyString,
});
export type DocumentSummarySection = z.infer<typeof DocumentSummarySectionSchema>;

export const DocumentSummarySchema = z.object({
  overview: nonEmptyString,
  keyPoints: z.array(nonEmptyString),
  sections: z.array(DocumentSummarySectionSchema),
});
export type DocumentSummary = z.infer<typeof DocumentSummarySchema>;

/* ------------------------------------------------------------------ */
/* Chats                                                              */
/* ------------------------------------------------------------------ */

export const ChatSchema = z.object({
  id: uuidSchema,
  userId: uuidSchema.nullable(),
  title: nonEmptyString,
  pinned: z.boolean().default(false),
  documentIds: z.array(uuidSchema).default([]),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Chat = z.infer<typeof ChatSchema>;

export const CreateChatRequestSchema = z.object({
  documentIds: z.array(uuidSchema).optional().default([]),
});
export type CreateChatRequest = z.infer<typeof CreateChatRequestSchema>;

export const PatchChatRequestSchema = z.object({
  title: z.string().min(1).optional(),
  pinned: z.boolean().optional(),
});
export type PatchChatRequest = z.infer<typeof PatchChatRequestSchema>;

/* ------------------------------------------------------------------ */
/* Messages / chat stream                                             */
/* ------------------------------------------------------------------ */

export const SourceSchema = z.object({
  n: z.number().int().positive(),
  documentId: uuidSchema,
  fileName: nonEmptyString,
  page: z.number().int().nonnegative().nullable(),
  snippet: nonEmptyString,
});
export type Source = z.infer<typeof SourceSchema>;

export const MessageSchema = z.object({
  id: uuidSchema,
  chatId: uuidSchema,
  role: z.enum(["user", "assistant"]),
  content: z.string(),
  sources: z.array(SourceSchema).default([]),
  tokensIn: z.number().int().nonnegative().nullable().optional(),
  tokensOut: z.number().int().nonnegative().nullable().optional(),
  createdAt: z.string(),
});
export type Message = z.infer<typeof MessageSchema>;

export const SendMessageRequestSchema = z.object({
  content: z.string().min(1),
});
export type SendMessageRequest = z.infer<typeof SendMessageRequestSchema>;

/* SSE stream event types (plan.md 13.3 / 14.5 / 14.9)               */
export const StreamEventDeltaSchema = z.object({
  type: z.literal("delta"),
  delta: z.string(),
});
export type StreamEventDelta = z.infer<typeof StreamEventDeltaSchema>;

export const StreamEventSourcesSchema = z.object({
  type: z.literal("sources"),
  sources: z.array(SourceSchema),
});
export type StreamEventSources = z.infer<typeof StreamEventSourcesSchema>;

export const StreamEventUsageSchema = z.object({
  type: z.literal("usage"),
  tokensIn: z.number().int().nonnegative(),
  tokensOut: z.number().int().nonnegative(),
});
export type StreamEventUsage = z.infer<typeof StreamEventUsageSchema>;

export const StreamEventDoneSchema = z.object({
  type: z.literal("done"),
});
export type StreamEventDone = z.infer<typeof StreamEventDoneSchema>;

export const StreamEventErrorSchema = z.object({
  type: z.literal("error"),
  code: z.string(),
  message: z.string(),
});
export type StreamEventError = z.infer<typeof StreamEventErrorSchema>;

export const StreamEventSchema = z.discriminatedUnion("type", [
  StreamEventDeltaSchema,
  StreamEventSourcesSchema,
  StreamEventUsageSchema,
  StreamEventDoneSchema,
  StreamEventErrorSchema,
]);
export type StreamEvent = z.infer<typeof StreamEventSchema>;

/* ------------------------------------------------------------------ */
/* Settings / BYOK                                                    */
/* ------------------------------------------------------------------ */

export const ProviderSchema = z.enum(["anthropic", "openai", "gemini"]);
export type Provider = z.infer<typeof ProviderSchema>;

export const ProviderKeyRequestSchema = z.object({
  provider: ProviderSchema,
  apiKey: z.string().min(1),
});
export type ProviderKeyRequest = z.infer<typeof ProviderKeyRequestSchema>;

export const ProviderKeySchema = z.object({
  provider: ProviderSchema,
  createdAt: z.string(),
});
export type ProviderKey = z.infer<typeof ProviderKeySchema>;

/* ------------------------------------------------------------------ */
/* Usage                                                              */
/* ------------------------------------------------------------------ */

export const UsageSchema = z.object({
  freeTokensUsed: z.number().int().nonnegative().default(0),
  freeTokensCap: z.number().int().nonnegative(),
  hasOwnKey: z.boolean().default(false),
});
export type Usage = z.infer<typeof UsageSchema>;

/* ------------------------------------------------------------------ */
/* API route constants                                                */
/* ------------------------------------------------------------------ */

export const API_ROUTES = {
  auth: {
    signup: "/auth/signup",
    login: "/auth/login",
    google: "/auth/google",
    logout: "/auth/logout",
    verify: "/auth/verify",
    forgot: "/auth/forgot-password",
    reset: "/auth/reset-password",
  },
  documents: {
    list: "/documents",
    byId: (id: string) => `/documents/${id}`,
    summary: (id: string) => `/documents/${id}/summary`,
  },
  chats: {
    list: "/chats",
    byId: (id: string) => `/chats/${id}`,
    messages: (id: string) => `/chats/${id}/messages`,
  },
  settings: {
    providerKey: "/settings/provider-key",
  },
  usage: "/usage",
  health: "/health",
} as const;
