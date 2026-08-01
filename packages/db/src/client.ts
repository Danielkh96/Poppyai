import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "./schema.js";

export type SiftloomDatabase = NodePgDatabase<typeof schema>;

export interface DatabaseClient {
  readonly db: SiftloomDatabase;
  readonly pool: Pool;
  close(): Promise<void>;
}

export function createDatabaseClient(connectionString: string): DatabaseClient {
  const pool = new Pool({
    connectionString,
    application_name: "siftloom"
  });
  const db = drizzle({ client: pool, schema });

  return {
    db,
    pool,
    close: () => pool.end()
  };
}
