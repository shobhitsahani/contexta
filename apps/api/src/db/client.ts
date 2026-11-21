import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import { getEnv } from "../config/env.js";
import * as schema from "./schema.js";

const { Pool } = pg;

export type Db = NodePgDatabase<typeof schema>;

/** Creates an owned pool/connection for the API process or tests. */
export function createDatabase(connectionString: string): {
  db: Db;
  pool: pg.Pool;
} {
  const ownedPool = new Pool({ connectionString });
  return { db: drizzle(ownedPool, { schema }), pool: ownedPool };
}

let pool: pg.Pool | undefined;
let dbInstance: any;

export function getPool(): pg.Pool {
  if (!pool) {
    const env = getEnv();
    pool = new Pool({
      connectionString: env.DATABASE_URL,
    });
  }
  return pool;
}

export function getDb() {
  if (!dbInstance) {
    dbInstance = drizzle(getPool(), { schema });
  }
  return dbInstance;
}

export function setDb(customDb: any) {
  dbInstance = customDb;
}

export const db = new Proxy({} as ReturnType<typeof drizzle<typeof schema>>, {
  get(_target, prop) {
    return (getDb() as any)[prop];
  },
});
