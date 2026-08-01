import {
  claimIngestionAttempt,
  claimStaleUploadForCleanup,
  completeIngestionAttempt,
  createDatabaseClient,
  deleteQuarantinedUploadRecord,
  failIngestionAttempt,
  listStaleUploadCleanupCandidates,
  updateIngestionAttemptStage
} from "@siftloom/db";
import {
  createS3ObjectStorageFromEnvironment,
  extractSource,
  normalizeIngestionError
} from "@siftloom/ingestion";
import {
  INGESTION_CLEANUP_QUEUE,
  INGESTION_QUEUE,
  ingestionQueuePayloadSchema
} from "@siftloom/shared";
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
const database = createDatabaseClient(workerDatabaseUrl);
const storage = createS3ObjectStorageFromEnvironment();

boss.on("error", (error) => {
  console.error(
    JSON.stringify({
      event: "worker.queue_error",
      error: error instanceof Error ? error.message : "unknown_queue_error"
    })
  );
});

await boss.start();
await boss.createQueue(INGESTION_QUEUE);
await boss.createQueue(INGESTION_CLEANUP_QUEUE);
await boss.schedule(INGESTION_CLEANUP_QUEUE, "*/15 * * * *", null, {
  retryLimit: 2,
  retryDelay: 30,
  retryBackoff: true,
  expireInSeconds: 300
});

await boss.work("m0.health", async (jobs) => {
  for (const job of jobs) {
    console.info(JSON.stringify({ event: "m0.health", jobId: job.id }));
  }
});

await boss.work(
  INGESTION_QUEUE,
  { batchSize: 1, pollingIntervalSeconds: 1 },
  async (jobs) => {
    for (const queueJob of jobs) {
      const payload = ingestionQueuePayloadSchema.parse(queueJob.data);
      const claimed = await claimIngestionAttempt(database.db, payload.jobId);
      if (!claimed) continue;

      try {
        await updateIngestionAttemptStage(database.db, claimed, "fetching", 20);
        const extracted = await extractSource(claimed.asset, {
          storage,
          ...(process.env.YOUTUBE_API_KEY
            ? { youtubeApiKey: process.env.YOUTUBE_API_KEY }
            : {})
        });
        await updateIngestionAttemptStage(database.db, claimed, "normalizing", 75);
        await updateIngestionAttemptStage(database.db, claimed, "storing", 90);
        await completeIngestionAttempt(database.db, claimed, extracted);
        console.info(
          JSON.stringify({
            event: "ingestion.succeeded",
            jobId: claimed.jobId,
            attempt: claimed.attemptNumber,
            sourceType: claimed.asset.sourceType
          })
        );
      } catch (error) {
        const normalized = normalizeIngestionError(error);
        const outcome = await failIngestionAttempt(database.db, claimed, normalized);
        console.warn(
          JSON.stringify({
            event: "ingestion.failed",
            jobId: claimed.jobId,
            attempt: claimed.attemptNumber,
            errorCode: normalized.code,
            retryScheduled: outcome.shouldRetry
          })
        );
        if (outcome.shouldRetry) throw normalized;
      }
    }
  }
);

await boss.work(
  INGESTION_CLEANUP_QUEUE,
  { batchSize: 1, pollingIntervalSeconds: 5 },
  async () => {
    const candidates = await listStaleUploadCleanupCandidates(database.db, 50);
    let removed = 0;
    for (const candidate of candidates) {
      const objectKey = await claimStaleUploadForCleanup(database.db, candidate);
      if (!objectKey) continue;
      await storage.delete(candidate.scope.workspaceId, objectKey);
      if (await deleteQuarantinedUploadRecord(database.db, candidate)) removed += 1;
    }
    console.info(
      JSON.stringify({
        event: "ingestion.cleanup_completed",
        candidates: candidates.length,
        removed
      })
    );
  }
);

const stop = async (): Promise<void> => {
  await boss.stop({ graceful: true, timeout: 10_000 });
  await database.close();
  process.exitCode = 0;
};

process.once("SIGINT", () => {
  void stop();
});
process.once("SIGTERM", () => {
  void stop();
});

console.info(
  JSON.stringify({
    event: "worker.started",
    queueSchema: "pgboss",
    queues: ["m0.health", INGESTION_QUEUE, INGESTION_CLEANUP_QUEUE]
  })
);
