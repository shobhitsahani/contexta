# Contexta: Plan

**Tagline:** AI that understands your context.
**One-liner:** An intelligent knowledge assistant that turns your data into answers.

Items marked (?) are still open.

## 1. Goals
Portfolio piece, real product, deep RAG learning, and open source, all at once. So: polished UI, easy to try, clean documented code, public repo.

Constraint: zero running cost. Free tiers only. Users bring their own LLM key (BYOK) after a small free token allowance.

## 2. Decisions so far
- File types in v1: PDF, DOCX, TXT
- Users: anyone, generic
- Accounts: single user, simple accounts (no teams in v1)
- Hosting: free tiers only
- BYOK: users can pick any LLM provider
- Free tier: small token allowance per user, then BYOK required
- v1 includes chat history and multiple chats
- Embeddings: one fixed model for everyone (see section 6)
- Login: email + password and Google (no GitHub)
- UI: light and dark themes with a toggle
- Process: plan fully first, then build
- Backend: separate Express API on a free host
- Auth: Better Auth (recommended; works with Express + Postgres, email/password + Google)
- If documents lack the answer: answer from them first, then general knowledge, clearly labeled
- Free tier: about 10 questions, tracked as a token budget
- Chat management: rename, delete, pin
- Files: stored in Cloudflare R2 or Supabase Storage (free tier)
- Ingestion: background job, status polling first, live progress (SSE) later
- Scale: design for growth, run on free tiers today
- DB layer: Drizzle ORM (recommended); repo: pnpm monorepo (recommended)
- Free-tier chat model: Gemini Flash free tier (model id kept in config, not hardcoded)
- Privacy: Gemini free tier with clear disclosure in privacy policy and at upload (decided, see 15.7)
- Express host: Render free web service (recommended, see 15.6)
- Embeddings: gemini-embedding-001 at 768 dims (recommended, see 15.6)
- Email: verification + password reset via Resend (free tier)
- Abuse protection: email verification + per-IP limit + daily global cap on the free key
- Demo mode: sample document, no signup needed
- Queue: Postgres-backed jobs table (claim with SKIP LOCKED), resumable; Redis only for rate limits (my decision, you delegated)
- Follow-up questions: v1 uses a cheap approach (retrieval query = last user message + current question); LLM rewrite added later (my decision)
- Build: possibly several coding agents in parallel, so work is split by contract (see 18)
- Main worry: RAG quality, so evaluation comes before tuning (see 19)
- Hybrid search: in v1 (Postgres full-text + vector, rank fusion), behind a flag so the eval can compare (my decision)
- Summaries: "summarize the whole document" is a v1 must-have, built as stored summaries (see 20); outline panel in v1 (simple), no regenerate-with-own-key in v1
- Eval docs: mix of your own and public sample docs; private ones never committed (see 19.7)
- Timeline: no fixed demo date; keep a cut order (see 17.4)
- Chunking: heading/paragraph-aware, size-capped with overlap (recommended)
- Citations: numbered markers [1] in the answer, click to open a source panel (file, page, snippet)

## 3. Scope

**v1**
- Sign up / log in (email + password, Google)
- Light / dark theme toggle
- Upload PDF, DOCX, TXT (with size limits)
- Multiple chats, saved history; rename, delete, pin
- Chat over one document or several
- Answers with citations (file, page, snippet)
- BYOK settings page: choose provider, add key (stored encrypted)
- Free token allowance, then key required

**Later**
- Web URLs, more file types
- Teams / sharing
- Hybrid search and reranking
- OCR for scanned PDFs

**Not in v1:** billing, SSO, admin dashboard, fine-tuning

## 4. Architecture

```
Next.js (UI) -> Express API -> Postgres + pgvector
                    |
                    +-> Redis (rate limits)
                    +-> Ingestion (parse, chunk, embed)
                    +-> LLM provider (user's key, or server key on free tier)
```

## 5. Stack (?)
- Frontend: Next.js, Tailwind
- Backend: TypeScript, Node.js, Express
- DB: Postgres with pgvector (Neon or Supabase free tier)
- Redis: Upstash free tier (rate limits only)
- Parsing: pdfjs-dist / pdf-parse, mammoth (DOCX), plain read (TXT)
- LLM layer: provider-agnostic wrapper (e.g. Vercel AI SDK)
- Hosting: Vercel (frontend), Render free (API + worker)

## 6. Embeddings (recommendation)
- Use ONE embedding model for all users, on a server-side key from a free hosted embedding API (Gemini, Voyage and Jina all have had free tiers; check current limits).
- Reason: vectors from different models are not compatible, so per-user embedding providers would break search. Only the chat model is user-selectable.
- Fix the vector dimension when creating the table. Changing models later means re-embedding everything.
- Fallback if free limits bite: local model (transformers.js, MiniLM) on the API server.
- Protect the free quota: cap file size, pages, and documents per user.

## 7. RAG pipeline

**Ingestion**
1. Upload, store file, create document row (pending)
2. Extract text with page numbers
3. Chunk ~500-800 tokens, 10-15% overlap
4. Embed in batches, insert into chunks
5. Mark ready

**Query**
1. Embed the question
2. Top-k vector search (k ~ 8), scoped to the user's documents
3. Build prompt: instructions + chunks + recent chat history
4. Stream the answer with citations
5. If the documents don't contain the answer, say so, then add general knowledge in a clearly labeled section

## 8. Data model
See section 14.2 for the full schema (this section was replaced to avoid two versions).

## 9. Free tier and BYOK
- Free tier is about 10 questions, tracked as a token budget (chat in + out) per user; estimate ~5k tokens per question with 8 chunks, so a cap around 50k (tune after testing)
- Free-tier chat uses a server key with a Gemini Flash model (id in config)
- After the cap: user must add own key
- Keys: HTTPS only, AES-256-GCM at rest, never logged, never sent back to the client
- Redis rate limits per user and per IP

## 10. Milestones
1. Setup: repo, Next.js + Express, Postgres + pgvector, auth
2. Ingestion: upload, parse, chunk, embed
3. Chat: retrieval, streaming, citations
4. Multiple chats and history
5. BYOK + free token limit
6. UI polish, landing page, README, demo
7. Deploy on free tiers

## 11. Risks
- Free hosts sleep or time out: ingestion must be quick or chunked into steps
- Free Express host cold starts after idle: show a loading state; see 17 for worker recovery
- Free embedding quota runs out: caps, fallback to local model
- Scanned PDFs have no text: reject with a clear message for now
- Prompt injection from document text: treat chunks as data
- Key security: encryption, no logging

## 12. Open questions
See 15.5 and 17.5 for the current list.

## 13. High-Level Design (HLD)

### 13.1 Components
```
Browser (Next.js, light/dark)
   |  HTTPS (REST + SSE)
   v
Express API  (auth, uploads, chats, query, usage)
   |        \
   |         +--> Object storage (R2 / Supabase Storage): original files
   |         +--> Redis: rate limits only
   |         +--> Job worker (same process now, separable later)
   v                     |
Postgres + pgvector <----+   (users, docs, chunks+vectors, chats, messages, jobs)
   ^
   |
Embedding API (server key)       LLM provider (user key, or server key on free tier)
```

### 13.2 Ingestion flow (recommended: background job)
1. Client asks API for upload; API validates type and size, stores file in object storage, creates `documents` row (status: queued) and a job.
2. API returns immediately with document id. Client polls `GET /documents/:id` for status (queued, parsing, embedding, ready, failed). SSE progress can be added later.
3. Worker pulls the job: download file, parse, chunk, embed in batches, insert chunks, set status ready.
4. Failures retry with backoff; after max retries status is failed with a readable reason.
5. Worker runs inside the API process for now (fits one free host). Queue is behind an interface so it can move to its own service.

### 13.3 Query flow
1. Client sends message to `POST /chats/:id/messages` (SSE response).
2. API checks auth, then key: user's own key, or free budget remaining.
3. Embed question, vector search scoped to the chat's documents, take top-k.
4. Build prompt: instructions + chunks + recent history. Chunks are data, not instructions.
5. Stream tokens to the client; at the end send citations (file, page, snippet).
6. Save the message, sources and token usage; update the free-tier budget.
7. If documents lack the answer: say so, then give a labeled general-knowledge section.

### 13.4 API surface (v1)
- Auth: sign up, log in, Google, log out (Better Auth)
- `POST /documents`, `GET /documents`, `GET /documents/:id`, `DELETE /documents/:id`
- `POST /chats`, `GET /chats`, `PATCH /chats/:id` (rename, pin), `DELETE /chats/:id`
- `POST /chats/:id/messages` (streamed), `GET /chats/:id/messages`
- `PUT /settings/provider-key`, `DELETE /settings/provider-key`
- `GET /usage` (free budget left)

### 13.5 Key design choices
- One vector DB: pgvector with an HNSW index, filtered by user/document.
- Fixed embedding model for everyone; vector dimension fixed at table creation.
- Chat model is provider-agnostic behind one interface; embeddings are not.
- Every query is scoped by user id (no cross-user reads).
- Stateless API: sessions in DB, jobs in Redis/DB, files in object storage. This is what makes scaling out possible.

### 13.6 Growth path (free now, scalable later)
1. Now: one Express service (API + worker), free Postgres, free Redis, free object storage.
2. Next: split the worker into its own service; add more workers.
3. Then: read replicas or a dedicated vector store if pgvector gets slow; CDN for static assets; per-user quotas on storage.
4. Add hybrid search and reranking when retrieval quality needs it.

### 13.7 Security and reliability
- Provider keys encrypted at rest (AES-256-GCM), never logged, never returned.
- Upload checks: type, size, page count; reject scanned PDFs with a clear message.
- Rate limits per user and IP in Redis; free-tier budget enforced server side.
- Delete a document removes file, chunks and vectors.
- Health endpoint; loading state in the UI for free-host cold starts.
- Basic logs with request ids; no document text or keys in logs.

### 13.8 HLD open items
- Which free host for Express (check current free-tier limits)
- Which free model for the free-tier chat
- Final token cap

## 14. Low-Level Design (LLD)

### 14.1 Repo layout (pnpm monorepo)
```
contexta/
  apps/
    web/                 Next.js (App Router), Tailwind
      app/ (auth, chats/[id], documents, settings)
      components/ (ChatView, MessageList, SourcePanel, Uploader, ThemeToggle)
      lib/ (apiClient.ts, sse.ts)
    api/                 Express + worker
      src/
        index.ts         bootstrap, middleware, routes
        config/env.ts    zod-validated env
        db/ (schema.ts, client.ts, migrations/)
        auth/            Better Auth setup
        routes/ (documents, chats, messages, settings, usage)
        services/
          ingestion/ (parse.ts, chunk.ts, embed.ts, pipeline.ts)
          retrieval/ (search.ts, prompt.ts)
          llm/ (provider.ts, anthropic.ts, openai.ts, gemini.ts)
          keys.ts        encrypt/decrypt provider keys
          usage.ts       token budget
          storage.ts     R2 / Supabase wrapper
        queue/ (queue.ts interface, pgQueue.ts, worker.ts)
        middleware/ (auth, rateLimit, error)
  packages/
    shared/              zod schemas + TS types used by web and api
```
Why: one repo is easier to run and review; shared zod schemas keep request/response types in sync.

### 14.2 Database (Drizzle + pgvector)
```sql
-- vector dimension must match the chosen embedding model (example: 768)
CREATE EXTENSION IF NOT EXISTS vector;

documents(
  id uuid pk, user_id uuid not null, name text, mime text, size_bytes int,
  storage_key text, status text check (status in
    ('queued','parsing','embedding','ready','failed')),
  error text, page_count int, created_at timestamptz default now()
);
chunks(
  id uuid pk, document_id uuid references documents on delete cascade,
  user_id uuid not null, chunk_index int, page int,
  content text, token_count int, embedding vector(768)
);
CREATE INDEX chunks_embedding_hnsw ON chunks
  USING hnsw (embedding vector_cosine_ops);
CREATE INDEX chunks_doc_idx ON chunks(document_id);

chats(id uuid pk, user_id uuid, title text, pinned bool default false,
      created_at, updated_at);
chat_documents(chat_id uuid, document_id uuid, primary key(chat_id, document_id));
messages(id uuid pk, chat_id uuid, role text check (role in ('user','assistant')),
         content text, sources jsonb, tokens_in int, tokens_out int,
         used_free_budget bool, created_at);
provider_keys(id uuid pk, user_id uuid, provider text, ciphertext bytea,
              iv bytea, auth_tag bytea, created_at, unique(user_id, provider));
usage(user_id uuid pk, free_tokens_used int default 0);
jobs(id uuid pk, document_id uuid, attempts int default 0,
     status text check (status in ('queued','processing','done','failed')),
     locked_at timestamptz, last_error text, run_at timestamptz default now());
```
(Auth tables are created by Better Auth.)

### 14.3 Key interfaces
```ts
// llm/provider.ts
interface LLMProvider {
  id: 'anthropic' | 'openai' | 'gemini' | string;
  stream(req: { model: string; system: string; messages: Msg[];
                apiKey: string; signal: AbortSignal }): AsyncIterable<{
      text?: string; usage?: { in: number; out: number } }>;
}

// queue/queue.ts  (so Redis can be swapped later)
interface JobQueue {
  enqueue(job: { documentId: string }): Promise<void>;
  process(handler: (job: { documentId: string }) => Promise<void>): void;
}

// retrieval/search.ts
type Hit = { chunkId: string; documentId: string; page: number;
             content: string; score: number };
search(userId: string, documentIds: string[], queryVec: number[], k: number): Promise<Hit[]>;
```

### 14.4 Ingestion pipeline (pipeline.ts)
1. `status=parsing`: load file from storage. Parse by mime:
   - PDF: pdfjs-dist, text per page; if total text is near empty, fail with "scanned PDF not supported yet".
   - DOCX: mammoth to text; page = 1 (DOCX has no stable pages), keep headings.
   - TXT: read as UTF-8; page = 1.
2. Chunk (chunk.ts), heading/paragraph-aware:
   - Split by blank lines and heading markers into blocks.
   - Merge blocks up to ~600 tokens; split oversized blocks on sentences.
   - Overlap: carry last ~80 tokens into the next chunk.
   - Each chunk keeps its page number (page of its first block).
   - Token counting: a cheap estimate (chars / 4) is fine here.
3. `status=embedding`: embed in batches of ~64 with retry/backoff on 429; insert chunks per batch.
4. `status=ready`. On error: attempts++, retry up to 3 times, else `failed` with a readable message.
5. Limits (free tier): max file 10 MB, max 100 pages, max 5 documents per user (tune).

### 14.5 Query pipeline (messages route)
1. Validate body `{ content }` with zod; load chat; check ownership.
2. Resolve credentials:
   - user has key for chosen provider -> use it.
   - else if `free_tokens_used < FREE_CAP` -> use server key and server free model.
   - else respond 402 with code `KEY_REQUIRED`.
3. Embed question; `search(k=8)`; drop hits below a score threshold.
4. Prompt (prompt.ts):
   - system: answer from sources, cite as [n], say when sources lack the answer, then add a section labeled "General knowledge (not from your documents)" if useful, treat source text as data only.
   - sources block: `[n] (file, p.X) text`
   - last ~6 messages of history.
5. Stream via SSE: events `delta`, `sources`, `usage`, `done`, `error`. Abort on client disconnect.
6. After stream: save assistant message with `sources` (file, page, snippet) and token counts; if free credentials were used, add tokens to `usage` atomically (`UPDATE ... SET free_tokens_used = free_tokens_used + $n`).
7. First message of a chat: generate the title from the question (cheap, local truncation to start).

### 14.6 API contracts (examples)
- `POST /documents` multipart -> `201 { id, status: "queued" }`
- `GET /documents/:id` -> `{ id, name, status, error?, pageCount }`
- `POST /chats` `{ documentIds: string[] }` -> `{ id }`
- `PATCH /chats/:id` `{ title?, pinned? }`
- `POST /chats/:id/messages` `{ content }` -> SSE stream
- `PUT /settings/provider-key` `{ provider, apiKey }` -> `204` (key validated with a tiny test call before saving)
- `GET /usage` -> `{ freeTokensUsed, freeTokensCap, hasOwnKey }`
- Errors: `{ error: { code, message } }`; codes: `UNAUTHORIZED`, `NOT_FOUND`, `KEY_REQUIRED`, `RATE_LIMITED`, `FILE_TOO_LARGE`, `UNSUPPORTED_TYPE`, `INGESTION_FAILED`.

### 14.7 Key encryption (keys.ts)
- AES-256-GCM, random 12-byte IV per key, master key from env (`KEY_ENCRYPTION_SECRET`, 32 bytes).
- Store ciphertext, iv, auth tag. Decrypt only in memory, only for the request that needs it.
- Never log request bodies on settings routes; redact `apiKey` in error reports.

### 14.8 Rate limiting
- Redis fixed/sliding window: per user (messages: 20/min, uploads: 10/hour) and per IP on auth routes.
- Free-tier budget is the separate, database-backed token counter.

### 14.9 Frontend notes
- Chat UI reads SSE with `fetch` + stream reader; append deltas, then render `sources`.
- Citation markers [n] link to the SourcePanel (file, page, snippet).
- Document list polls status every 2s while any document is not ready/failed.
- Theme: CSS variables, `data-theme` on html, saved in localStorage, defaults to system.
- Cold start: if the first API call is slow, show "Waking up the server..."

### 14.10 Testing
- Unit: chunker (sizes, overlap, page mapping), key encryption roundtrip, token budget math.
- Integration: upload -> ingestion -> search on a small fixture PDF/DOCX/TXT; message flow with a mocked LLM provider.
- Retrieval check: a small set of question/expected-page pairs to compare chunking changes.

### 14.11 Build order
1. Monorepo, env config, DB schema + migrations, Better Auth
2. Storage + upload route + jobs table/queue
3. Parse + chunk + embed pipeline
4. Search + prompt + streaming message route
5. Chats CRUD (rename, pin, delete) + usage budget
6. BYOK settings + provider adapters
7. Web UI: auth, upload, chat, sources, theme
8. Rate limits, error states, README, deploy

## 15. Extra planning

### 15.1 Email (decided)
- Resend free tier for verification and password reset emails (Better Auth hooks).
- Unverified users can log in but cannot use the free tier or upload until verified.
- Reset and verify tokens are single-use and expire (e.g. 1 hour).
- Need: a sending domain or the Resend test sender for dev (check current free limits).

### 15.2 Free-tier abuse protection (decided)
- Verified email required for the free token budget.
- Per-IP limits in Redis on signup and on the free tier (e.g. a few new accounts per IP per day).
- Daily global cap on total free-key tokens. When hit, free tier shows "free queries are paused today, add your own key" and BYOK keeps working.
- Block disposable email domains (simple list) (?).
- Log free-tier usage per day so the cap can be tuned.

### 15.3 Demo mode (decided)
- A sample document is ingested once by an admin script and marked `is_demo` (shared, read-only, visible to everyone).
- Visitors can chat with it without signing up, using the server free key.
- Protection: tiny per-IP limit (e.g. 5 questions/day), short answer length cap, counts toward the daily global cap.
- No uploads, no chat history saved server side for anonymous users (kept in browser only).
- Schema change: `documents.is_demo bool`, `documents.user_id` nullable for demo docs; search allows demo docs for anonymous requests.
- Call-to-action in the demo: "Sign up to chat with your own files."

### 15.4 Recommended defaults for the remaining items (not yet confirmed)
- Privacy: short privacy policy and terms; account deletion removes files, chunks, vectors, keys, chats.
- Retrieval test set: ~20 question/expected-page pairs on the sample document, run with a script.
- Dev setup: `.env.example`, docker-compose (Postgres with pgvector, Redis), GitHub Actions for lint, typecheck, tests.
- Observability: Sentry free tier, structured logs with request ids, no document text or keys in logs.
- Repo: MIT license, README with architecture diagram, CONTRIBUTING.
- Polish: mobile-responsive layout, keyboard and screen-reader basics, simple logo and brand colors.
- Storage estimate: size the free Postgres cap against chunks x vector dimension before launch (a 768-dim vector is about 3 KB per chunk, so tens of thousands of chunks use hundreds of MB).

### 15.5 Still open
1. Final token cap and daily global cap (set below the real Gemini free limits, check AI Studio)
2. Sending domain for email: get a free one via GitHub Student Developer Pack (see 15.8)
3. (Done) Privacy decision: option A, see 15.7
4. Confirm host and embedding picks below

### 15.6 Research notes (checked Nov 20, 2026; free tiers change, re-check before launch)

**Free-tier chat (Gemini Flash)**
- Free tier exists, but Google no longer publishes a fixed table; your real limits are in the AI Studio rate-limit view. Screenshot them with the date.
- Model names change often and older ones get shut down (one guide says 2.5 models shut down Oct 16, 2026). Keep the model id in env config and pick a current Flash/Flash-Lite id from AI Studio.
- One Google-derived source lists roughly 500 requests/day free for Flash/Flash-Lite (shared). Treat as a rough number; set the daily global cap well below your actual limit.
- Privacy: on the free tier, Google's pricing page says content is used to improve its products. Users' questions and retrieved document chunks would go there.

**Embeddings (recommended: gemini-embedding-001, 768 dims)**
- Supports 100+ languages, 2048-token input, and Matryoshka sizes (3072 default; 1536 or 768 recommended), so 768 saves storage with little quality loss.
- Free tier limits quoted by a Google forum reply: 30k tokens/min, 100 requests/min, 1k requests/day (may be outdated). Paid is $0.15 per 1M tokens, so a 100-page document costs well under a cent.
- A newer multimodal model (gemini-embedding-2-preview) exists but is preview and unneeded for text.
- Same privacy point applies: on the free tier, document text sent for embedding may be used to improve Google's products.
- Alternative: a local model (e.g. MiniLM-class) keeps documents private and free, but 512 MB RAM on the free host is tight and quality is lower.

**Privacy options (pick one)**
- A: Use the free tier, and clearly disclose it in the privacy policy and at upload ("documents are processed by Google's Gemini API on a free plan").
- B: Use a paid-tier Gemini key for embeddings only (cost is cents); keep chat on free tier or require BYOK for private docs.
- C: Local embeddings and BYOK-only chat; free tier limited to the demo document.
- My lean: A for v1 with clear disclosure, B if you want the safer default. This slightly bends the "zero cost" rule under B.

**Express host (recommended: Render free web service)**
- Reported terms: 750 instance hours/month, 512 MB RAM, shared CPU, no card, sleeps after ~15 min idle, ~30-50 s cold start. Runs a normal long-lived Node process, which fits the API + in-process worker design.
- Alternatives: Railway is now closer to a small trial credit than a free tier; Koyeb has a small scale-to-zero free service; Fly has no free tier; Vercel/Cloudflare serverless suit short functions, not an ingestion worker or long SSE streams.
- Mitigations for cold starts: "Waking up the server" UI state; optional health-check ping (check Render's terms); make ingestion resumable so a sleep mid-job does not lose work.
- Pair with: Vercel (web), Neon or Supabase (Postgres + pgvector), Upstash (Redis), R2 or Supabase Storage (files).

### 15.7 Privacy disclosure (decided: option A)
- Upload screen shows a short notice before the first upload and a required checkbox: "Your documents and questions are processed by Google's Gemini API. On the free plan, Google may use this content to improve its products. Don't upload sensitive files."
- Same notice on the free-tier chat screen.
- Privacy policy states: what is sent to Google (chunk text for embeddings, questions, retrieved chunks), what is stored by us (files, chunks, vectors, chats, encrypted keys), and how to delete everything.
- BYOK chat goes to the provider the user chose, using their key and their provider's terms; say so in settings.
- Store the user's consent (timestamp + policy version) in the DB: `users.privacy_consent_at`, `users.privacy_version`. Block uploads until consent is recorded.
- Revisit if the project grows: moving embeddings to a paid key is a config change (same model, same 768 dims, no re-embedding).

### 15.8 Free domain for email (no domain yet)
- You are a BCA student, so the GitHub Student Developer Pack is the likely route (needs student verification with a school email or ID; check eligibility at education.github.com/pack).
- Namecheap: one free .me domain for a year (renews at the normal .me rate after).
- Name.com: one free domain from a list of TLDs (e.g. .dev, .app, .live, .studio) for a year, with WHOIS privacy. A payment method on file is required; start the claim from the GitHub offers page while logged out of Name.com.
- Either works for Resend: add the domain in Resend, add its DNS records (SPF, DKIM), verify, then send from e.g. noreply@yourdomain.
- Until the domain is verified: Resend's test sender works for development, but only to your own email, so test signup with your own address.
- Fallback if not verified as a student: a cheap .xyz/.dev-style domain costs a few dollars, or launch with Google login only and add email flows later.

## 16. Milestone 1 checklist: repo, schema, auth

**Done when:** you can sign up (email + Google), verify email, log in, see an empty dashboard, and the database has the full v1 schema.

### 16.1 Repo and tooling
- [ ] Create GitHub repo `contexta` (MIT license, README stub)
- [ ] pnpm workspace: `apps/web`, `apps/api`, `packages/shared`
- [ ] TypeScript base config, ESLint, Prettier
- [ ] `packages/shared`: zod schemas for auth and common error shape
- [ ] `.env.example` for web and api; env validation with zod in `apps/api/src/config/env.ts`
- [ ] docker-compose: Postgres with pgvector + Redis
- [ ] GitHub Actions: install, lint, typecheck, test on push

### 16.2 Database
- [ ] Choose project DB: Neon or Supabase free tier (needs pgvector); create dev and prod DBs
- [ ] Drizzle setup, `drizzle.config.ts`, migration scripts
- [ ] Enable `vector` extension in the first migration
- [ ] Define tables: documents, chunks (vector 768), chats, chat_documents, messages, provider_keys, usage, jobs
- [ ] Add fields from later decisions: `documents.is_demo`, nullable `documents.user_id`, `users.privacy_consent_at`, `users.privacy_version`
- [ ] HNSW index on `chunks.embedding`; indexes on `chunks.document_id`, `chats.user_id`
- [ ] Run migrations locally and on the free DB; confirm the vector extension works with a test insert/query

### 16.3 API skeleton
- [ ] Express app: JSON parsing, CORS (web origin only), helmet, request id, error middleware using the shared error shape
- [ ] `GET /health`
- [ ] Redis client + basic rate limit middleware (auth routes)
- [ ] Deploy stub to Render free; confirm it connects to DB and Redis

### 16.4 Auth (Better Auth)
- [ ] Install and configure Better Auth with Drizzle adapter (generate its tables)
- [ ] Email + password sign up / log in / log out
- [ ] Google OAuth: create Google Cloud OAuth client, set redirect URIs for local and prod
- [ ] Email verification and password reset using Resend (test sender first, own domain later)
- [ ] Session cookies: httpOnly, secure, correct SameSite for web on Vercel and API on Render (cross-site, so check cookie settings carefully)
- [ ] `requireAuth` middleware and `requireVerified` middleware
- [ ] Per-IP rate limit on signup and login
- [ ] Tests: sign up, verify, log in, protected route returns 401 without session

### 16.5 Web skeleton
- [ ] Next.js app with Tailwind, light/dark theme toggle (CSS variables, `data-theme`)
- [ ] Pages: sign up, log in, verify email notice, forgot/reset password
- [ ] Authenticated layout with empty dashboard and sidebar placeholder
- [ ] API client wrapper with typed errors; "Waking up the server..." state for slow first request
- [ ] Deploy to Vercel; set env vars; confirm login works end to end

### 16.5b Risks to watch in milestone 1
- Cross-site cookies between Vercel (web) and Render (API): easiest fix is a shared parent domain once you have a custom domain; otherwise use a Next.js proxy/rewrite to the API
- Free DB size and connection limits: use a pooled connection string
- Google OAuth consent screen set to "testing" limits who can sign in; publish it before launch

### 16.6 Definition of done
- [ ] New user signs up with email, gets a verification email, verifies, logs in
- [ ] New user signs in with Google
- [ ] Unverified user is blocked from protected API routes that require verification
- [ ] Theme toggle works and persists
- [ ] CI is green; web on Vercel and API on Render both live
- [ ] README explains how to run locally

## 17. Plan review (Nov 20, 2026)

### 17.1 Cleanups already applied
- Section 8 now points to 14.2 (it had an older schema).
- Sections 5, 9, 11 no longer show stale (?) items; section 12 points to the live lists.

### 17.2 Gaps found, with recommended fix
Not yet confirmed by you unless noted.

**Queue and worker (important on free tiers)**
- Gap: the plan says Redis queue, but the schema also has a `jobs` table. Pick one. Upstash's free tier has command limits and BullMQ polls a lot (check current limits).
- Fix: Postgres-backed queue (`jobs` table, claim with `FOR UPDATE SKIP LOCKED`). Redis only for rate limits.
- Gap: Render sleeps when idle, killing an in-process worker mid-job.
- Fix: jobs are resumable. On boot and every minute, reclaim jobs stuck in `processing` longer than N minutes. Ingestion saves progress per batch of chunks.

**Embedding quota**
- Gap: a Google forum reply quoted about 30k tokens/min and 1k requests/day for `gemini-embedding-001` free tier. A 100-page document can exceed 30k tokens, so ingestion must throttle, not just retry. Query-time embeddings use the same quota.
- Fix: a token-per-minute limiter in the embed step; a global daily embedding budget; max pages per user lowered if needed (e.g. 50). Verify real limits in AI Studio.

**Retrieval quality**
- Gap: follow-up questions like "what about the second one?" embed badly on their own.
- Fix: rewrite the latest message into a standalone question using the last 1-2 turns before retrieval (one small extra model call, or include the last user message in the query text for v1).
- Gap: citations across several documents and chats whose documents change.
- Fix: sources store `documentId`, file name, page, snippet at answer time. Deleting a document keeps old messages but marks sources as "document deleted". A chat can only use documents with status ready.

**Free-tier budget accuracy**
- Gap: two parallel requests can overshoot the cap; token counts are estimates until the provider reports usage.
- Fix: reserve tokens before the call, settle with the provider's reported usage after; reject if the reserve does not fit.

**BYOK details**
- Gap: model choice per provider, bad or exhausted user keys, user's own rate limits.
- Fix: a default model per provider in config plus an optional model field; validate the key with a tiny call on save; map provider errors to clear messages (invalid key, quota, rate limit).
- Decision: no custom base URLs in v1 (avoids server-side request forgery risk).

**Security**
- Uploads: check file signatures (not just extension/mime); DOCX is a zip, so cap decompressed size; run parsing with memory and time limits.
- Cross-site cookies (Vercel web, Render API): add CSRF protection and a strict CORS allow-list; test on Safari and mobile.
- Render answers as sanitized markdown (no raw HTML) to avoid script injection from model output or documents.
- Never put provider keys or document text in logs or error reports.

**Memory on the free host**
- Gap: 512 MB RAM (reported). Large PDFs parsed in memory can crash the process.
- Fix: stream uploads to storage (do not buffer in memory); enforce page and size caps before parsing; process one ingestion job at a time.

**Streaming**
- Gap: SSE can be buffered by proxies, and Vercel functions time out.
- Fix: the browser calls the Express API directly for streaming (not through Next.js routes); send periodic keep-alive comments.

**Product and project**
- Gap: no timeline. Fix: set a target date for a public demo and for internship applications; cut scope to fit (suggested cut order: pins, DOCX, demo polish).
- Gap: name check. Fix: before claiming the free domain, check that "Contexta" is free as a domain, GitHub repo name and app name, and is not an existing product you could collide with.
- Gap: portfolio value. Fix: write an architecture doc and a short results note (retrieval test numbers) in the repo, plus a demo video.
- Gap: backups. Fix: weekly `pg_dump` of the free DB to storage (free DBs can have limited backups; check your provider).

### 17.3 UI recommendation (you said "you suggest")
**Layout: chat-first with a source side panel.**
- Desktop: left sidebar (pinned chats, recent chats, documents with status), center chat, right panel that opens when a citation [n] is clicked, showing file, page and the highlighted snippet. Collapsed by default.
- Mobile: single column; sidebar as a drawer; source panel as a bottom sheet.
- Why: chat-first is familiar and keeps the main screen simple; the source panel is what makes the answers trustworthy and shows off the RAG design. A full split view (document viewer always open) is heavier to build and awkward for DOCX/TXT.
- Empty state: drag-and-drop upload, the sample document, and three example questions.
- Must-have states: uploading, parsing, failed (with reason), free budget left, key required, waking server.

**Brand: monochrome neutrals with one indigo accent.**
- Fits "minimal, intelligent, modern, enterprise-ready". Neutral grays for surfaces; indigo (around #4F46E5 light, a lighter tint in dark mode) for primary actions, links and citation markers.
- Type: one sans font (e.g. Inter) plus a mono font for snippets. Wordmark "Contexta" in plain text to start; a simple logo later.
- Define colors as CSS variables for light/dark so the theme toggle is trivial.

### 17.4 Suggested changes to scope
- Keep v1 as listed. If time is short, cut in this order: pinned chats, DOCX, demo-mode polish.

### 17.5 Decisions from the review
1. Queue: Postgres-backed. Sections 4, 13, 14 now match: `jobs` has `status` (queued, processing, done, failed), `attempts`, `locked_at`, `run_at`; the worker claims with `SELECT ... FOR UPDATE SKIP LOCKED`, reclaims stale `processing` rows, and saves progress per chunk batch. Redis is used for rate limits only.
2. Follow-ups: v1 builds the retrieval query from the last user message plus the current question. A proper LLM rewrite is a later improvement, judged by the retrieval test set.
3. Timeline: none fixed. Work milestone by milestone; cut order if needed: pinned chats, DOCX, demo polish.
4. Still to do: check the name "Contexta" (domain, GitHub repo, existing products) before claiming the free domain.
5. Still to do: read your real Gemini free limits in AI Studio, then set the token cap and daily global cap.

## 18. Building with multiple agents

Goal: several agents can work in parallel without stepping on each other.

### 18.1 Rules that make it work
- **Contracts first.** `packages/shared` (zod schemas, types, error codes, API route list) and the DB schema are written and merged before parallel work starts. Agents code against these, not against each other's code.
- **One owner per folder.** Each task lists the folders it may touch; nothing else.
- **Small tasks with acceptance criteria** (a test or a command that must pass), not vague goals.
- **Interfaces with fakes.** `LLMProvider`, `JobQueue`, `Embedder`, `Storage` each get an interface plus a fake implementation for tests, so the chat flow can be built before real keys or storage exist.
- **One branch per task, small PRs**, CI must be green to merge. Rebase on main daily.
- **A root `AGENTS.md`** (also usable as CLAUDE.md or similar for tools that read it): stack, folder map, commands (install, dev, test, lint, typecheck), coding rules, "do not touch" list, and the decisions from this plan. Keep it short and link to `plan.md`.
- **Decisions log** in `docs/decisions.md`: any agent that changes a decision records why.

### 18.2 Suggested workstreams (after milestone 1 contracts are merged)
| Stream | Owns | Needs from others |
|---|---|---|
| A. Ingestion | `services/ingestion`, `queue`, `storage` | DB schema, Embedder interface |
| B. Retrieval + chat | `services/retrieval`, `services/llm`, `routes/messages` | DB schema, fake Embedder |
| C. Chats, usage, BYOK | `routes/chats`, `routes/settings`, `usage.ts`, `keys.ts` | DB schema, auth middleware |
| D. Web UI | `apps/web` | shared schemas, mock API (MSW or fixtures) |
| E. Evaluation | `eval/` (see 19) | sample documents, retrieval interface |
| F. Infra and docs | CI, docker-compose, deploy, README, privacy page | everything, last |

### 18.3 Task template (copy for each task)
```
Task: <name>
Folders you may edit: <list>
Read first: plan.md sections <x>, AGENTS.md
Goal: <one paragraph>
Interfaces to use: <list>
Acceptance: <commands/tests that must pass>
Out of scope: <list>
```

### 18.4 Integration points to watch
- API route shapes and SSE event names (`delta`, `sources`, `usage`, `done`, `error`) must live in `packages/shared` so UI and API agree.
- Citation object shape: `{ n, documentId, fileName, page, snippet }` fixed early.
- Error codes list shared by API and UI.
- Migrations: one agent owns migrations at a time to avoid conflicts.

## 19. RAG quality plan

Because quality is the main worry, treat it as a measured feature, not a feeling.

### 19.1 Build an evaluation set first
- 3-5 real documents of different kinds (e.g. a research paper, a policy or legal-style doc, a manual with tables, a short TXT and a DOCX; scanned files are out of scope for now).
- 15-20 questions per document with: the question, the expected page(s) or passage, and a short reference answer. Include some unanswerable questions (answer should be "not in the document") and some multi-part and follow-up questions.
- Store in `eval/` as JSON so it runs from a script and in CI on a small subset.

### 19.2 Metrics
- **Retrieval:** hit rate@k (is the right chunk in top k?) and MRR. This is the first thing to fix, since a wrong retrieval cannot be saved by the model.
- **Answer:** faithfulness (claims supported by retrieved text), correct refusal on unanswerable questions, citation correctness (cited page actually contains the claim). Judge with a rubric; start with manual checks on ~30 answers, add an LLM judge later.
- **Cost/latency:** tokens per answer, time to first token.

### 19.3 Levers, in the order to try them
1. Chunk size and overlap (try ~300, ~600, ~900 tokens), heading-aware splitting, adding the document title or section heading to each chunk's text before embedding.
2. k and a minimum score threshold.
3. Embedding task types (query vs document) if the model supports them.
4. Hybrid search: add Postgres full-text search and combine with vector results (reciprocal rank fusion). Cheap to add, no extra service.
5. Query rewriting for follow-ups (later, see 17.5).
6. Reranking (a small cross-encoder or an LLM rerank) if hit rate is high at top 20 but low at top 5.
7. Prompt tuning: strict "answer only from sources, cite every claim, say when missing", then the labeled general-knowledge section.

### 19.4 Known hard cases to plan for
- Tables and multi-column PDFs (text extraction order breaks); decide a minimum bar and document limits.
- Scanned PDFs (rejected for now, OCR later).
- Questions that need the whole document ("summarize this"): retrieval of 8 chunks is not enough. Plan a "summarize" path (map-reduce over chunks, or first N chunks per section) or tell the user the limit.
- Very short or very long documents; documents in other languages (embedding model is multilingual, but test).
- Duplicate or near-duplicate chunks across several documents.

### 19.5 Process
- Run the eval before and after every retrieval change; record results in `eval/results.md` (also good portfolio material).
- Change one lever at a time.
- Keep the chunker and prompt in config so experiments do not need code changes.
- Log (in dev) the retrieved chunks and scores for each question to debug misses.

### 19.6 Decisions
- Users upload "a mix of everything", so the eval set must cover several document types (see 19.1) and chunking must not be tuned to one type.
- Hybrid search is in v1 (my decision): contracts, manuals and papers contain exact names, numbers and terms that vector search misses. Implementation: `tsvector` column on `chunks` with a GIN index, run vector and keyword search, merge with reciprocal rank fusion, keep it behind a config flag so the eval can compare vector-only vs hybrid.
- Summaries are a v1 must-have: see section 20.

### 19.7 Eval documents (mix of yours and public)
- Public set (committed to the repo, license permitting): e.g. an open-access research paper, a public government or company policy PDF, a product manual, a plain TXT, a DOCX you write. Check each license before committing.
- Private set (your own documents): kept in `eval/private/`, listed in `.gitignore`, never committed or uploaded to a public repo. Only metrics from them go in `eval/results.md`.
- Question files reference documents by name so the same script runs on either set.


## 20. Whole-document summaries (v1 must-have)

### 20.1 The problem
Top-8 retrieval cannot summarize a document, and sending a whole document to the chat model on demand would spend a free user's entire token budget (about 50k) on one question. So summaries are generated once, stored, and reused.

### 20.2 Design (recommended)
- **At ingestion**, after embedding, run one summary step with the server's Gemini Flash key:
  - Input: the full text if it fits the model's context (check the model's limit; a 100-page cap is roughly 50-75k tokens), else map-reduce over sections.
  - Output (JSON): overall summary, 5-10 key points, and an outline of sections each with a title, page range and 2-3 sentence summary.
  - One model call per document in the common case.
- **Stored** in a new table `document_summaries(document_id, level, ordinal, title, page_start, page_end, text)` (level 0 = whole document, level 1 = sections).
- **Not charged** to the user's free-question budget. It counts against the global daily server budget instead. If it fails or the budget is exhausted, the document still becomes `ready`, with `summary_status = 'pending'`; the summary is then generated lazily the first time it is requested, using the requester's credentials.
- **Privacy:** covered by the existing Gemini disclosure (15.7).

### 20.3 How a request reaches it
1. **Explicit:** a "Summarize" button on each document and in a chat's document list calls `POST /documents/:id/summary` (returns the stored summary, or generates it). Most reliable path.
2. **In chat:** a simple rule-based router (words like summarize, summary, overview, tl;dr, main points, key takeaways, outline, "what is this about") sends the question to the summary path instead of chunk retrieval. Upgrade to a model-based router only if the eval shows misses.
3. **Partial requests** ("summarize chapter 3", "pages 10-20"): use the section summaries whose page range matches; if none match, retrieve chunks from that page range and summarize those.
4. **Several documents in a chat:** one short summary per document, then a combined answer.
5. The summary path still returns citations: the section titles and page ranges used.

### 20.4 Schema and API additions
- `documents.summary_status text check (summary_status in ('pending','ready','failed','skipped'))`
- `document_summaries` table as above
- `POST /documents/:id/summary` and `GET /documents/:id/summary`
- Shared type `DocumentSummary { overview, keyPoints[], sections[{title,pageStart,pageEnd,summary}] }` in `packages/shared`
- Ingestion state machine gets a final optional step: `summarizing`

### 20.5 Quality and limits
- Add to the eval set: for each document, a short checklist of 5-8 facts a good summary must cover, and 2-3 facts it must not invent. Score coverage and faithfulness.
- Very long documents (over the page cap) are rejected, so the single-call path stays valid; map-reduce is the fallback only for large-but-allowed documents.
- DOCX and TXT have no stable pages, so their outlines use headings or section numbers instead of page ranges.
- Summaries are cached and invalidated only if the document is re-uploaded.

### 20.6 Decisions (you delegated these to me)
1. Outline panel: yes, in v1, kept simple. The document view lists the stored sections (title + page range); clicking one shows that section's summary and page range in the source panel (v1 has no full document viewer), and a "Summarize this section" action asks the chat about it. It reuses data already generated, so the cost is mostly UI work. Cut it first if time is short (add to the 17.4 cut order after pinned chats).
2. Regenerate with own key: not in v1. It adds model/key choices and billing edge cases for little gain; revisit after the eval shows summary quality problems.
