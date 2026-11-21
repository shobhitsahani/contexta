import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  vector,
  index,
  primaryKey,
  jsonb,
  customType,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return "bytea";
  },
});

/* ------------------------------------------------------------------ */
/* Auth tables (Better Auth compatible)                               */
/* ------------------------------------------------------------------ */

export const users = pgTable("user", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  name: text("name"),
  emailVerified: boolean("email_verified").default(false).notNull(),
  image: text("image"),
  privacyConsentAt: timestamp("privacy_consent_at", { withTimezone: true }),
  privacyVersion: text("privacy_version"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const sessions = pgTable("session", {
  id: text("id").primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  token: text("token").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const accounts = pgTable("account", {
  id: text("id").primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const verifications = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

/* ------------------------------------------------------------------ */
/* Ingestion & Documents                                              */
/* ------------------------------------------------------------------ */

export const documents = pgTable("documents", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  mime: text("mime").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  storageKey: text("storage_key").notNull(),
  status: text("status").notNull().default("queued"), // 'queued'|'parsing'|'embedding'|'ready'|'failed'
  error: text("error"),
  pageCount: integer("page_count"),
  isDemo: boolean("is_demo").default(false).notNull(),
  summaryStatus: text("summary_status").notNull().default("pending"), // 'pending'|'ready'|'failed'|'skipped'
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const chunks = pgTable(
  "chunks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    userId: uuid("user_id"),
    chunkIndex: integer("chunk_index").notNull(),
    page: integer("page").notNull().default(1),
    content: text("content").notNull(),
    tokenCount: integer("token_count").notNull(),
    embedding: vector("embedding", { dimensions: 768 }),
  },
  (table) => [
    index("chunks_doc_idx").on(table.documentId),
    index("chunks_user_id_idx").on(table.userId),
  ],
);

export const jobs = pgTable(
  "jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    attempts: integer("attempts").default(0).notNull(),
    status: text("status").default("queued").notNull(), // 'queued'|'processing'|'done'|'failed'
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    lastError: text("last_error"),
    runAt: timestamp("run_at", { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("jobs_status_run_at_idx").on(table.status, table.runAt),
    index("jobs_doc_idx").on(table.documentId),
  ],
);

export const documentSummaries = pgTable(
  "document_summaries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    level: integer("level").notNull(), // 0 = whole doc, 1 = section
    ordinal: integer("ordinal").notNull().default(0),
    title: text("title").notNull(),
    pageStart: integer("page_start"),
    pageEnd: integer("page_end"),
    text: text("text").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("doc_summaries_doc_idx").on(table.documentId),
  ],
);

/* ------------------------------------------------------------------ */
/* Chats & Messages                                                  */
/* ------------------------------------------------------------------ */

export const chats = pgTable(
  "chats",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    pinned: boolean("pinned").default(false).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("chats_user_id_idx").on(table.userId),
  ],
);

export const chatDocuments = pgTable(
  "chat_documents",
  {
    chatId: uuid("chat_id")
      .notNull()
      .references(() => chats.id, { onDelete: "cascade" }),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({ columns: [table.chatId, table.documentId] }),
  ],
);

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    chatId: uuid("chat_id")
      .notNull()
      .references(() => chats.id, { onDelete: "cascade" }),
    role: text("role").notNull(), // 'user'|'assistant'
    content: text("content").notNull(),
    sources: jsonb("sources"),
    tokensIn: integer("tokens_in"),
    tokensOut: integer("tokens_out"),
    usedFreeBudget: boolean("used_free_budget").default(false).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("messages_chat_id_idx").on(table.chatId),
  ],
);

/* ------------------------------------------------------------------ */
/* Provider keys & Usage                                              */
/* ------------------------------------------------------------------ */

export const providerKeys = pgTable(
  "provider_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    ciphertext: bytea("ciphertext").notNull(),
    iv: bytea("iv").notNull(),
    authTag: bytea("auth_tag").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("provider_keys_user_provider_idx").on(
      table.userId,
      table.provider,
    ),
  ],
);

export const usage = pgTable("usage", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  freeTokensUsed: integer("free_tokens_used").default(0).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export type DocumentRow = typeof documents.$inferSelect;
export type InsertDocumentRow = typeof documents.$inferInsert;
export type ChunkRow = typeof chunks.$inferSelect;
export type InsertChunkRow = typeof chunks.$inferInsert;
export type JobRow = typeof jobs.$inferSelect;
export type InsertJobRow = typeof jobs.$inferInsert;
export type DocumentSummaryRow = typeof documentSummaries.$inferSelect;
export type InsertDocumentSummaryRow = typeof documentSummaries.$inferInsert;
