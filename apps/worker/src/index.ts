import { PgBoss } from "pg-boss";

const workerDatabaseUrl = process.env.WORKER_DATABASE_URL;
if (!workerDatabaseUrl) {
  throw new Error("WORKER_DATABASE_URL is required to start the worker");
}

const boss = new PgBoss({
  connectionString: workerDatabaseUrl,
  application_name: "siftloom-worker",
  schema: "pgboss"
});

boss.on("error", (error) => {
  console.error(
    JSON.stringify({
      event: "worker.queue_error",
      error: error instanceof Error ? error.message : "unknown_queue_error"
    })
  );
});

await boss.start();

await boss.work("m0.health", async (jobs) => {
  for (const job of jobs) {
    console.info(JSON.stringify({ event: "m0.health", jobId: job.id }));
  }
});

const stop = async (): Promise<void> => {
  await boss.stop({ graceful: true, timeout: 10_000 });
  process.exitCode = 0;
};

process.once("SIGINT", () => {
  void stop();
});
process.once("SIGTERM", () => {
  void stop();
});

console.info(JSON.stringify({ event: "worker.started", queueSchema: "pgboss" }));
