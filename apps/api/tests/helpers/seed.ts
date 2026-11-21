import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { Db } from '../../src/db/client.js';
import { documents, providerKeys, users } from '../../src/db/schema.js';
import type { AuthSessionResult, SessionResolver } from '../../src/middleware/auth.js';

export interface SeedUserInput {
  id?: string;
  email?: string;
  name?: string;
  emailVerified?: boolean;
}

export async function seedUser(
  db: Db,
  input: SeedUserInput = {},
) {
  const id = input.id ?? randomUUID();
  const rows = await db
    .insert(users)
    .values({
      id,
      email: input.email ?? `user-${id}@example.com`,
      name: input.name ?? 'Test User',
      emailVerified: input.emailVerified ?? true,
    })
    .returning();
  const user = rows[0];
  if (!user) throw new Error('Failed to seed user');
  return user;
}

export async function seedDocument(
  db: Db,
  userId: string,
  overrides: { status?: string; name?: string; isDemo?: boolean } = {},
) {
  const rows = await db
    .insert(documents)
    .values({
      userId,
      name: overrides.name ?? 'notes.txt',
      mime: 'text/plain',
      sizeBytes: 128,
      storageKey: `uploads/${randomUUID()}.txt`,
      status: overrides.status ?? 'ready',
      isDemo: overrides.isDemo ?? false,
    })
    .returning();
  const document = rows[0];
  if (!document) throw new Error('Failed to seed document');
  return document;
}

export async function seedProviderKey(
  db: Db,
  userId: string,
  provider: string,
  ciphertext = Buffer.from('ciphertext'),
) {
  await db.insert(providerKeys).values({
    userId,
    provider,
    ciphertext,
    iv: Buffer.alloc(12, 1),
    authTag: Buffer.alloc(16, 2),
  });
}

export function createTestSessionResolver(db: Db): SessionResolver {
  return async (headers: Headers): Promise<AuthSessionResult | null> => {
    const userId = headers.get('x-test-user-id');
    if (!userId) return null;
    const rows = await db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    const user = rows[0];
    if (!user) return null;
    return {
      user: {
        id: user.id,
        email: user.email,
        emailVerified: user.emailVerified,
        name: user.name ?? '',
        image: user.image,
      },
      session: {
        id: randomUUID(),
        userId: user.id,
        expiresAt: new Date(Date.now() + 60_000),
      },
    };
  };
}

export function authHeader(userId: string): Record<string, string> {
  return { 'x-test-user-id': userId };
}
