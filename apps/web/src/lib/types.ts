import {
  type Chat,
  type Document,
  type Message,
  type MessageSource,
  type Provider,
  type Usage,
  type UsageResponse,
  type CreateChatInput,
  type CreateChatBody,
  type UpdateChatInput,
  type ProviderKeyBody,
  type ErrorCode,
} from "@contexta/shared";

/** Chat as used by the frontend UI. shared's Chat omits userId/documentIds. */
export interface AppChat extends Chat {
  userId?: string | null;
  documentIds?: string[];
}

/** A citation rendered in the UI (shared's MessageSource). */
export type AppCitation = MessageSource;

/** Local client-side error (decoupled from shared ErrorCode membership). */
export interface AppErrorProps {
  code: string;
  message: string;
  status?: number;
}

export class AppError extends Error {
  public readonly code: string;
  public readonly status: number;
  constructor({ code, message, status = 500 }: { code: string; message: string; status?: number }) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = status;
  }
}

/* ------------------------------------------------------------------ */
/* Local request/response types (not all are in shared yet)           */
/* ------------------------------------------------------------------ */

export type SignupInput = {
  email: string;
  password: string;
  name?: string;
};

export type LoginInput = { email: string; password: string };

export type GoogleLoginInput = { credential: string };

export type VerifyEmailInput = { email: string; token: string };

export type ForgotPasswordInput = { email: string };

export type ResetPasswordInput = { token: string; password: string };

export type AuthResponse = {
  user: { id: string; email: string; name: string | null; emailVerified: boolean; createdAt: string };
  token?: string;
};

export type ProviderKeyInput = { provider: Provider; apiKey: string };

export type DocumentSummary = {
  overview: string;
  keyPoints: string[];
  sections: Array<{
    title: string;
    pageStart?: number | null;
    pageEnd?: number | null;
    summary: string;
  }>;
};

export type {
  Document,
  Message,
  Usage,
  UsageResponse,
  Provider,
  ErrorCode,
};
export type { CreateChatInput, CreateChatBody, UpdateChatInput, ProviderKeyBody };
