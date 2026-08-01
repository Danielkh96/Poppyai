import { fileURLToPath } from "node:url";

import { migrate } from "drizzle-orm/node-postgres/migrator";
import { PgBoss } from "pg-boss";

import { createDatabaseClient } from "./client.js";

const migrationDatabaseUrl = process.env.MIGRATION_DATABASE_URL;
if (!migrationDatabaseUrl) {
  throw new Error("MIGRATION_DATABASE_URL is required to run migrations");
}

const client = createDatabaseClient(migrationDatabaseUrl);
const queue = new PgBoss({
  connectionString: migrationDatabaseUrl,
  application_name: "siftloom-migrations",
  schema: "pgboss"
});
let queueStarted = false;

try {
  await migrate(client.db, {
    migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url))
  });
  await queue.start();
  queueStarted = true;
  await queue.createQueue("m0.health");

  // pg-boss owns its internal migration SQL. Runtime roles receive data-plane access
  // only after the migration owner has brought that schema to the pinned version.
  await client.pool.query(`
    grant usage on schema pgboss to siftloom_web, siftloom_worker;
    grant select, insert, update, delete on all tables in schema pgboss
      to siftloom_web, siftloom_worker;
    grant usage, select, update on all sequences in schema pgboss
      to siftloom_web, siftloom_worker;
    grant execute on all functions in schema pgboss to siftloom_web, siftloom_worker;
  `);
} finally {
  if (queueStarted) await queue.stop({ graceful: true, timeout: 10_000 });
  await client.close();
}
