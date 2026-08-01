import "server-only";

import { INGESTION_QUEUE } from "@siftloom/shared";
import { PgBoss } from "pg-boss";

const queueGlobals = globalThis as typeof globalThis & {
  __siftloomQueue?: Promise<PgBoss>;
};

async function startQueue(): Promise<PgBoss> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is required");
  const boss = new PgBoss({
    connectionString,
    application_name: "siftloom-web",
    schema: "pgboss"
  });
  boss.on("error", (error) => {
    console.error("Queue connection failed", {
      errorName: error instanceof Error ? error.name : "UnknownError"
    });
  });
  await boss.start();
  await boss.createQueue(INGESTION_QUEUE);
  return boss;
}

export function getRuntimeQueue(): Promise<PgBoss> {
  queueGlobals.__siftloomQueue ??= startQueue();
  return queueGlobals.__siftloomQueue;
}
