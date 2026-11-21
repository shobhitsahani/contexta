import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import type { Db } from '../../src/db/client.js';
import * as schema from '../../src/db/schema.js';

export interface TestDatabase {
  client: PGlite;
  db: Db;
  close(): Promise<void>;
}

/**
 * Applies the real Drizzle migration to in-memory Postgres (PGlite).
 *
 * PGlite does not ship pgvector, so statements for the `chunks` table are
 * skipped. Agent 3's tables (auth, chats, settings, usage) are unaffected.
 */
export async function createTestDatabase(): Promise<TestDatabase> {
  const client = new PGlite();
  const db = drizzle(client, { schema });

  const migrationsDir = path.resolve(process.cwd(), 'drizzle');
  const files = readdirSync(migrationsDir)
    .filter((file) => file.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const sql = readFileSync(path.join(migrationsDir, file), 'utf8');
    const statements = sql.split('--> statement-breakpoint');
    for (const statement of statements) {
      const trimmed = statement.trim();
      if (!trimmed) continue;
      if (/create\s+extension/i.test(trimmed)) continue;
      if (/"chunks"/i.test(trimmed)) continue;
      await client.exec(trimmed);
    }
  }

  return {
    client,
    db: db as unknown as Db,
    close: () => client.close(),
  };
}
