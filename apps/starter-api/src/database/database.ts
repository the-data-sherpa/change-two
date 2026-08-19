import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "./schema.js";

export type StarterDatabase = NodePgDatabase<typeof schema>;

export interface StarterDatabaseHandle {
  readonly db: StarterDatabase;
  close(): Promise<void>;
}

export function openDatabase(databaseUrl: string): StarterDatabaseHandle {
  const pool = new Pool({ connectionString: databaseUrl });
  return {
    async close() {
      await pool.end();
    },
    db: drizzle(pool, { schema }),
  };
}
