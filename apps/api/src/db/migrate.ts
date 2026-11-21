import 'dotenv/config';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { getEnv } from '../config/env.js';
import { createDatabase } from './client.js';

async function main(): Promise<void> {
  const env = getEnv();
  const { db, pool } = createDatabase(env.DATABASE_URL);
  try {
    await migrate(db, {
      migrationsFolder: fileURLToPath(new URL('../../drizzle', import.meta.url)),
    });
    console.log('Database migrations applied.');
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  // Never print connection strings or credentials.
  console.error(
    'Database migration failed:',
    error instanceof Error ? error.name : 'Unknown error',
  );
  process.exitCode = 1;
});
