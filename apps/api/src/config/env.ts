import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3001),
  DATABASE_URL: z.string().default('postgresql://localhost:5432/contexta'),

  // Better Auth
  BETTER_AUTH_URL: z.string().url().default('http://localhost:3001'),
  BETTER_AUTH_SECRET: z
    .string()
    .min(32)
    .default('dev-only-better-auth-secret-change-me'),
  WEB_ORIGIN: z.string().url().default('http://localhost:3000'),

  // Google OAuth (optional in local dev)
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),

  // Email (Resend)
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().default('Contexta <onboarding@resend.dev>'),

  // Redis rate limits (in-memory fallback when absent)
  REDIS_URL: z.string().optional(),
  TRUST_PROXY: z.coerce.number().int().min(0).default(0),

  // Provider key validation
  PROVIDER_TIMEOUT_MS: z.coerce.number().int().positive().default(8000),
  OPENAI_DEFAULT_MODEL: z.string().default('gpt-4.1-mini'),
  ANTHROPIC_DEFAULT_MODEL: z.string().default('claude-sonnet-4-5'),
  GEMINI_DEFAULT_MODEL: z.string().default('gemini-2.5-flash'),

  // Rate limit defaults
  AUTH_IP_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(30),
  AUTH_IP_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  CHAT_USER_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(120),
  CHAT_USER_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  SETTINGS_USER_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(20),
  SETTINGS_USER_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  USAGE_USER_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(60),
  USAGE_USER_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),

  // Embedding
  EMBEDDING_API_KEY: z.string().default('test-key'),
  EMBEDDING_MODEL: z.string().default('gemini-embedding-001'),
  EMBEDDING_DIMENSIONS: z.coerce.number().default(768),

  // Free-tier chat
  FREE_CHAT_API_KEY: z.string().default('test-key'),
  FREE_CHAT_MODEL: z.string().default('gemini-2.0-flash'),
  FREE_CHAT_PROVIDER: z.enum(['gemini', 'openai', 'anthropic']).default('gemini'),

  // Token budget
  FREE_TOKEN_CAP: z.coerce.number().default(50000),

  // Key encryption
  KEY_ENCRYPTION_SECRET: z.string().min(32).default('a'.repeat(32)),

  // Retrieval defaults
  DEFAULT_TOP_K: z.coerce.number().default(8),
  DEFAULT_SCORE_THRESHOLD: z.coerce.number().default(0.3),
  HYBRID_SEARCH_ENABLED: z.coerce.boolean().default(true),
});

export type Env = z.infer<typeof envSchema>;

let _env: Env | undefined;

function assertProductionSecrets(env: Env): void {
  if (env.NODE_ENV !== 'production') return;
  if (!process.env.BETTER_AUTH_SECRET) {
    throw new Error('BETTER_AUTH_SECRET is required in production');
  }
  if (!process.env.KEY_ENCRYPTION_SECRET) {
    throw new Error('KEY_ENCRYPTION_SECRET is required in production');
  }
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required in production');
  }
  const hasGoogleId = Boolean(env.GOOGLE_CLIENT_ID);
  const hasGoogleSecret = Boolean(env.GOOGLE_CLIENT_SECRET);
  if (hasGoogleId !== hasGoogleSecret) {
    throw new Error(
      'GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set together',
    );
  }
}

export function getEnv(): Env {
  if (!_env) {
    _env = envSchema.parse(process.env);
    assertProductionSecrets(_env);
  }
  return _env;
}

/** Override env for testing */
export function setEnv(partial?: Partial<Env>): void {
  if (partial === undefined) {
    _env = undefined;
    return;
  }
  _env = envSchema.parse({ ...getEnv(), ...partial });
}

export function resetEnv(): void {
  _env = undefined;
}
