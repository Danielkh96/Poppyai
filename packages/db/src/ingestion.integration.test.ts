import { randomUUID } from "node:crypto";

import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { WorkspaceScope } from "@siftloom/shared";

import { BoardNotFoundError } from "./boards.js";
import { createDatabaseClient, type DatabaseClient } from "./client.js";
import {
  claimIngestionAttempt,
  claimStaleUploadForCleanup,
  completeIngestionAttempt,
  deleteQuarantinedUploadRecord,
  failIngestionAttempt,
  IngestionStateError,
  listIngestionStatuses,
  listStaleUploadCleanupCandidates,
  retryIngestion,
  resolveIngestionWorkerScope,
  submitRemoteIngestion,
  type QueueDispatcher
} from "./ingestion.js";

function requiredUrl(
  name: "TEST_DATABASE_URL" | "TEST_RUNTIME_DATABASE_URL" | "TEST_WORKER_DATABASE_URL"
): string {
  const value = process.env[name];
  if (!value)
    throw new Error(`${name} is required; ingestion integration tests may not skip`);
  return value;
}

const adminUrl = requiredUrl("TEST_DATABASE_URL");
const runtimeUrl = requiredUrl("TEST_RUNTIME_DATABASE_URL");
const workerUrl = requiredUrl("TEST_WORKER_DATABASE_URL");
const workspaceA = randomUUID();
const workspaceB = randomUUID();
const boardA = randomUUID();
const boardB = randomUUID();
const nodeA = randomUUID();
const actorA = `ingestion-a-${randomUUID()}`;
const actorB = `ingestion-b-${randomUUID()}`;
const scopeA: WorkspaceScope = { workspaceId: workspaceA, actorUserId: actorA };
const scopeB: WorkspaceScope = { workspaceId: workspaceB, actorUserId: actorB };

let admin: Pool;
let runtime: DatabaseClient;
let worker: DatabaseClient;

const fakeQueue: QueueDispatcher = {
  async send() {
    return randomUUID();
  }
};

describe("ingestion persistence and tenant boundary", () => {
  beforeAll(async () => {
    admin = new Pool({ connectionString: adminUrl });
    runtime = createDatabaseClient(runtimeUrl);
    worker = createDatabaseClient(workerUrl);
    await admin.query(
      `insert into workspace (id, name) values ($1, 'Ingestion A'), ($2, 'Ingestion B')`,
      [workspaceA, workspaceB]
    );
    await admin.query(
      `insert into workspace_membership (workspace_id, user_id, role, status)
       values ($1, $2, 'owner', 'active'), ($3, $4, 'owner', 'active')`,
      [workspaceA, actorA, workspaceB, actorB]
    );
    await admin.query(
      `insert into board (id, workspace_id, name)
       values ($1, $2, 'Board A'), ($3, $4, 'Board B')`,
      [boardA, workspaceA, boardB, workspaceB]
    );
    await admin.query(
      `insert into node (id, workspace_id, board_id, kind, x, y, width, height, payload)
       values ($1, $2, $3, 'webpage', 0, 0, 230, 145, $4::jsonb)`,
      [
        nodeA,
        workspaceA,
        boardA,
        JSON.stringify({
          version: 1,
          kind: "webpage",
          title: "Source",
          summary: "",
          status: "draft",
          progress: null,
          url: "https://example.com/"
        })
      ]
    );
  });

  afterAll(async () => {
    await runtime.close();
    await worker.close();
    await admin.query("delete from workspace where id = any($1::uuid[])", [
      [workspaceA, workspaceB]
    ]);
    await admin.end();
  });

  it("persists a source, re-authorizes the worker, and stores a versioned artifact", async () => {
    const queued = await submitRemoteIngestion(runtime.db, fakeQueue, scopeA, boardA, {
      mutationId: randomUUID(),
      nodeId: nodeA,
      url: "https://example.com/"
    });
    expect(queued.status).toBe("queued");

    await expect(resolveIngestionWorkerScope(worker.db, queued.id)).resolves.toMatchObject({
      workspaceId: workspaceA,
      boardId: boardA,
      actorUserId: actorA
    });
    const claimed = await claimIngestionAttempt(worker.db, queued.id);
    expect(claimed?.attemptNumber).toBe(1);
    if (!claimed) throw new Error("Expected ingestion claim");
    await completeIngestionAttempt(worker.db, claimed, {
      title: "Example Domain",
      sourceMime: "text/html",
      contentHash: "a".repeat(64),
      extractorVersion: "integration-1",
      warnings: [],
      provenance: { sourceUrl: "https://example.com/" },
      segments: [
        {
          text: "Example Domain",
          location: { start: 0, end: 14 },
          contentHash: "b".repeat(64)
        }
      ]
    });

    const [completed] = await listIngestionStatuses(runtime.db, scopeA, boardA);
    expect(completed).toMatchObject({
      id: queued.id,
      status: "succeeded",
      progress: 100,
      artifact: { segmentCount: 1, extractorVersion: "integration-1" }
    });
  });

  it("does not reveal a different tenant's board or ingestion status", async () => {
    await expect(listIngestionStatuses(runtime.db, scopeB, boardA)).rejects.toBeInstanceOf(
      BoardNotFoundError
    );
    await expect(listIngestionStatuses(runtime.db, scopeB, boardB)).resolves.toEqual([]);
  });

  it("deduplicates an identical submission and rejects a mismatched replay", async () => {
    const mutationId = randomUUID();
    const original = await submitRemoteIngestion(runtime.db, fakeQueue, scopeA, boardA, {
      mutationId,
      nodeId: nodeA,
      url: "https://example.com/idempotent"
    });
    const replay = await submitRemoteIngestion(runtime.db, fakeQueue, scopeA, boardA, {
      mutationId,
      nodeId: nodeA,
      url: "https://example.com/idempotent"
    });
    expect(replay.id).toBe(original.id);
    await expect(
      submitRemoteIngestion(runtime.db, fakeQueue, scopeA, boardA, {
        mutationId,
        nodeId: nodeA,
        url: "https://example.com/different"
      })
    ).rejects.toBeInstanceOf(IngestionStateError);

    const claimed = await claimIngestionAttempt(worker.db, original.id);
    if (!claimed) throw new Error("Expected idempotent ingestion claim");
    await failIngestionAttempt(worker.db, claimed, {
      code: "fixture_terminal",
      message: "Fixture terminal failure",
      retryable: false
    });
  });

  it("supersedes an expired attempt lease and rejects a concurrent claim", async () => {
    const leaseNode = randomUUID();
    await admin.query(
      `insert into node (id, workspace_id, board_id, kind, x, y, width, height, payload)
       values ($1, $2, $3, 'webpage', 0, 0, 230, 145, $4::jsonb)`,
      [
        leaseNode,
        workspaceA,
        boardA,
        JSON.stringify({
          version: 1,
          kind: "webpage",
          title: "Lease source",
          summary: "",
          status: "draft",
          progress: null,
          url: "https://example.com/lease"
        })
      ]
    );
    const queued = await submitRemoteIngestion(runtime.db, fakeQueue, scopeA, boardA, {
      mutationId: randomUUID(),
      nodeId: leaseNode,
      url: "https://example.com/lease"
    });
    const first = await claimIngestionAttempt(worker.db, queued.id);
    if (!first) throw new Error("Expected first lease");
    await expect(claimIngestionAttempt(worker.db, queued.id)).resolves.toBeNull();
    await admin.query(
      "update ingestion_attempt set updated_at = now() - interval '3 minutes' where id = $1",
      [first.attemptId]
    );
    const second = await claimIngestionAttempt(worker.db, queued.id);
    expect(second?.attemptNumber).toBe(2);
    const prior = await admin.query<{ status: string; error_code: string }>(
      "select status, error_code from ingestion_attempt where id = $1",
      [first.attemptId]
    );
    expect(prior.rows[0]).toEqual({ status: "cancelled", error_code: "lease_expired" });
    if (!second) throw new Error("Expected replacement lease");
    await failIngestionAttempt(worker.db, second, {
      code: "fixture_terminal",
      message: "Fixture terminal failure",
      retryable: false
    });
  });

  it("claims and removes bounded stale upload intents through the worker role", async () => {
    const staleAsset = randomUUID();
    const objectKey = `workspaces/${workspaceA}/uploads/${staleAsset}/source`;
    await admin.query(
      `insert into asset (
         id, workspace_id, board_id, source_type, status, object_key,
         original_file_name, declared_mime, declared_size, content_hash,
         upload_mutation_id, updated_at
       ) values (
         $1, $2, $3, 'upload', 'pending', $4,
         'stale.txt', 'text/plain', 5, $5, $6, now() - interval '2 hours'
       )`,
      [staleAsset, workspaceA, boardA, objectKey, "c".repeat(64), randomUUID()]
    );
    const candidates = await listStaleUploadCleanupCandidates(worker.db, 100);
    const candidate = candidates.find((value) => value.assetId === staleAsset);
    expect(candidate).toBeDefined();
    if (!candidate) throw new Error("Expected stale upload candidate");
    await expect(claimStaleUploadForCleanup(worker.db, candidate)).resolves.toBe(objectKey);
    await expect(deleteQuarantinedUploadRecord(worker.db, candidate)).resolves.toBe(true);
  });

  it("bounds automatic attempts and creates a linked logical job for manual retry", async () => {
    const retryNode = randomUUID();
    await admin.query(
      `insert into node (id, workspace_id, board_id, kind, x, y, width, height, payload)
       values ($1, $2, $3, 'webpage', 0, 0, 230, 145, $4::jsonb)`,
      [
        retryNode,
        workspaceA,
        boardA,
        JSON.stringify({
          version: 1,
          kind: "webpage",
          title: "Retry source",
          summary: "",
          status: "draft",
          progress: null,
          url: "https://example.com/retry"
        })
      ]
    );
    const queued = await submitRemoteIngestion(runtime.db, fakeQueue, scopeA, boardA, {
      mutationId: randomUUID(),
      nodeId: retryNode,
      url: "https://example.com/retry"
    });
    for (let attemptNumber = 1; attemptNumber <= 3; attemptNumber += 1) {
      const claimed = await claimIngestionAttempt(worker.db, queued.id);
      expect(claimed?.attemptNumber).toBe(attemptNumber);
      if (!claimed) throw new Error("Expected retryable attempt");
      const outcome = await failIngestionAttempt(worker.db, claimed, {
        code: "fixture_retryable",
        message: "Fixture retryable failure",
        retryable: true
      });
      expect(outcome.shouldRetry).toBe(attemptNumber < 3);
    }
    const failed = (await listIngestionStatuses(runtime.db, scopeA, boardA)).find(
      (value) => value.id === queued.id
    );
    expect(failed).toMatchObject({
      status: "failed",
      error: { code: "fixture_retryable", retryable: true }
    });

    const manual = await retryIngestion(runtime.db, fakeQueue, scopeA, boardA, queued.id, {
      mutationId: randomUUID()
    });
    expect(manual).toMatchObject({ status: "queued", retryOfJobId: queued.id });
    const claimedManual = await claimIngestionAttempt(worker.db, manual.id);
    if (!claimedManual) throw new Error("Expected manual retry claim");
    await failIngestionAttempt(worker.db, claimedManual, {
      code: "fixture_terminal",
      message: "Fixture terminal failure",
      retryable: false
    });
  });
});
