import { randomUUID } from "node:crypto";

import { and, asc, count, desc, eq, gte, inArray, isNull, lt, sql } from "drizzle-orm";
import { fromDrizzle, type PgBoss, type SendOptions } from "pg-boss";

import {
  INGESTION_QUEUE,
  PHASE_1_LIMITS,
  createUploadIntentSchema,
  ingestionStatusSchema,
  retryIngestionSchema,
  submitRemoteSourceSchema,
  type AssetSourceType,
  type CreateUploadIntent,
  type IngestionAttemptStage,
  type IngestionStatus,
  type RetryIngestion,
  type SubmitRemoteSource,
  type WorkspaceScope
} from "@siftloom/shared";

import { BoardNotFoundError } from "./boards.js";
import type { SiftloomDatabase } from "./client.js";
import {
  assets,
  boards,
  extractionArtifacts,
  extractionSegments,
  ingestionAttempts,
  ingestionJobs,
  nodes
} from "./schema.js";
import { withTenantTransaction, type TenantTransaction } from "./tenant.js";

export class IngestionNotFoundError extends Error {
  constructor() {
    super("Ingestion resource not found");
    this.name = "IngestionNotFoundError";
  }
}

export class IngestionStateError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "IngestionStateError";
  }
}

export class StaleIngestionAttemptError extends Error {
  constructor() {
    super("Ingestion attempt lease is stale");
    this.name = "StaleIngestionAttemptError";
  }
}

export class IngestionLimitError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly httpStatus: 413 | 429
  ) {
    super(message);
    this.name = "IngestionLimitError";
  }
}

export interface QueueDispatcher {
  send(name: string, data?: object | null, options?: SendOptions): Promise<string | null>;
}

export interface UploadIntentRecord {
  readonly assetId: string;
  readonly objectKey: string;
  readonly fileName: string;
  readonly mimeType: "application/pdf" | "text/plain";
  readonly size: number;
  readonly checksumSha256: string;
}

export interface VerifiedUploadMetadata {
  readonly actualSize: number;
  readonly detectedMime: "application/pdf" | "text/plain";
  readonly checksumSha256: string;
}

export interface StaleUploadCleanupCandidate {
  readonly scope: WorkspaceScope;
  readonly assetId: string;
}

interface PersistedExtractionSegment {
  readonly text: string;
  readonly location: Record<string, unknown>;
  readonly contentHash: string;
}

interface PersistedExtractedSource {
  readonly title: string | null;
  readonly sourceMime: string;
  readonly contentHash: string;
  readonly extractorVersion: string;
  readonly warnings: readonly string[];
  readonly provenance: Record<string, unknown>;
  readonly segments: readonly PersistedExtractionSegment[];
}

interface NormalizedIngestionFailure {
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
}

function isYouTubeUrl(value: string): boolean {
  const host = new URL(value).hostname.toLowerCase();
  return ["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"].includes(host);
}

async function assertIngestionCapacity(
  transaction: TenantTransaction,
  scope: WorkspaceScope
): Promise<void> {
  const rows = await transaction
    .select({ value: count() })
    .from(ingestionJobs)
    .where(
      and(
        eq(ingestionJobs.workspaceId, scope.workspaceId),
        inArray(ingestionJobs.status, ["queued", "running"])
      )
    );
  if (Number(rows[0]?.value ?? 0) >= PHASE_1_LIMITS.ingestion.concurrentJobsPerWorkspace) {
    throw new IngestionLimitError(
      "INGESTION_CONCURRENCY_LIMIT",
      "当前已有两个来源正在处理，请稍后再试。",
      429
    );
  }
}

async function assertRemoteSubmissionRate(
  transaction: TenantTransaction,
  scope: WorkspaceScope
): Promise<void> {
  const since = new Date(Date.now() - 60 * 60 * 1_000);
  const rows = await transaction
    .select({ value: count() })
    .from(assets)
    .where(
      and(
        eq(assets.workspaceId, scope.workspaceId),
        inArray(assets.sourceType, ["webpage", "youtube"]),
        gte(assets.createdAt, since)
      )
    );
  if (Number(rows[0]?.value ?? 0) >= PHASE_1_LIMITS.ingestion.urlImportsPerWorkspaceHour) {
    throw new IngestionLimitError(
      "INGESTION_RATE_LIMIT",
      "本工作区一小时内的网址导入次数已达上限。",
      429
    );
  }
}

async function requireActiveSourceNode(
  transaction: TenantTransaction,
  scope: WorkspaceScope,
  boardId: string,
  nodeId: string,
  allowedKinds: readonly ("pdf" | "webpage" | "video")[]
): Promise<{ readonly kind: "pdf" | "webpage" | "video" }> {
  const rows = await transaction
    .select({ kind: nodes.kind })
    .from(nodes)
    .innerJoin(
      boards,
      and(eq(boards.workspaceId, nodes.workspaceId), eq(boards.id, nodes.boardId))
    )
    .where(
      and(
        eq(nodes.workspaceId, scope.workspaceId),
        eq(nodes.boardId, boardId),
        eq(nodes.id, nodeId),
        isNull(nodes.deletedAt),
        isNull(boards.archivedAt),
        inArray(nodes.kind, allowedKinds)
      )
    )
    .limit(1);
  const node = rows[0];
  if (!node || !allowedKinds.includes(node.kind as "pdf" | "webpage" | "video")) {
    throw new BoardNotFoundError();
  }
  return { kind: node.kind as "pdf" | "webpage" | "video" };
}

async function dispatchInTransaction(
  queue: QueueDispatcher,
  transaction: TenantTransaction,
  jobId: string
): Promise<void> {
  const queueJobId = await queue.send(
    INGESTION_QUEUE,
    { jobId },
    {
      db: fromDrizzle(transaction, sql),
      retryLimit: PHASE_1_LIMITS.ingestion.maxAutomaticAttempts - 1,
      retryDelay: 1,
      retryBackoff: true,
      retryDelayMax: 30,
      expireInSeconds: 120,
      singletonKey: jobId
    }
  );
  if (!queueJobId) throw new Error("Durable ingestion dispatch was not created");
}

export async function createUploadIntentRecord(
  database: SiftloomDatabase,
  scope: WorkspaceScope,
  boardId: string,
  untrustedCommand: CreateUploadIntent
): Promise<UploadIntentRecord> {
  const command = createUploadIntentSchema.parse(untrustedCommand);
  return withTenantTransaction(database, scope, async (transaction) => {
    await requireActiveSourceNode(transaction, scope, boardId, command.nodeId, ["pdf"]);
    const existing = await transaction
      .select()
      .from(assets)
      .where(
        and(
          eq(assets.workspaceId, scope.workspaceId),
          eq(assets.uploadMutationId, command.mutationId)
        )
      )
      .limit(1);
    const prior = existing[0];
    if (prior) {
      if (
        prior.boardId !== boardId ||
        prior.originalFileName !== command.fileName ||
        prior.declaredMime !== command.mimeType ||
        prior.declaredSize !== command.size ||
        prior.contentHash !== command.checksumSha256 ||
        !prior.objectKey
      ) {
        throw new IngestionStateError("IDEMPOTENCY_MISMATCH", "重复上传请求的内容不一致。");
      }
      if (prior.status !== "pending") {
        throw new IngestionStateError(
          "UPLOAD_ALREADY_COMPLETED",
          "该上传凭证已完成，请创建新的上传请求。"
        );
      }
      return {
        assetId: prior.id,
        objectKey: prior.objectKey,
        fileName: command.fileName,
        mimeType: command.mimeType,
        size: command.size,
        checksumSha256: command.checksumSha256
      };
    }

    const usageRows = await transaction
      .select({
        value: sql<number>`coalesce(sum(coalesce(${assets.actualSize}, ${assets.declaredSize}, 0)), 0)`
      })
      .from(assets)
      .where(eq(assets.workspaceId, scope.workspaceId));
    const usedBytes = Number(usageRows[0]?.value ?? 0);
    if (usedBytes + command.size > PHASE_1_LIMITS.workspace.maxStorageBytes) {
      throw new IngestionLimitError(
        "WORKSPACE_STORAGE_LIMIT",
        "本工作区的存储空间已达上限。",
        413
      );
    }

    const assetId = randomUUID();
    const objectKey = `workspaces/${scope.workspaceId}/uploads/${assetId}/source`;
    await transaction.insert(assets).values({
      id: assetId,
      workspaceId: scope.workspaceId,
      boardId,
      sourceType: "upload",
      objectKey,
      originalFileName: command.fileName,
      declaredMime: command.mimeType,
      declaredSize: command.size,
      contentHash: command.checksumSha256,
      uploadMutationId: command.mutationId
    });
    return {
      assetId,
      objectKey,
      fileName: command.fileName,
      mimeType: command.mimeType,
      size: command.size,
      checksumSha256: command.checksumSha256
    };
  });
}

export async function getUploadIntentRecord(
  database: SiftloomDatabase,
  scope: WorkspaceScope,
  boardId: string,
  assetId: string
): Promise<UploadIntentRecord> {
  return withTenantTransaction(database, scope, async (transaction) => {
    const rows = await transaction
      .select()
      .from(assets)
      .where(
        and(
          eq(assets.workspaceId, scope.workspaceId),
          eq(assets.boardId, boardId),
          eq(assets.id, assetId),
          eq(assets.sourceType, "upload")
        )
      )
      .limit(1);
    const asset = rows[0];
    if (
      !asset?.objectKey ||
      !asset.originalFileName ||
      !asset.declaredMime ||
      asset.declaredSize === null ||
      !asset.contentHash ||
      (asset.declaredMime !== "application/pdf" && asset.declaredMime !== "text/plain")
    ) {
      throw new IngestionNotFoundError();
    }
    return {
      assetId: asset.id,
      objectKey: asset.objectKey,
      fileName: asset.originalFileName,
      mimeType: asset.declaredMime,
      size: asset.declaredSize,
      checksumSha256: asset.contentHash
    };
  });
}

export async function completeUploadAndDispatch(
  database: SiftloomDatabase,
  queue: QueueDispatcher,
  scope: WorkspaceScope,
  boardId: string,
  nodeId: string,
  assetId: string,
  completionMutationId: string,
  metadata: VerifiedUploadMetadata
): Promise<IngestionStatus> {
  return withTenantTransaction(database, scope, async (transaction) => {
    await requireActiveSourceNode(transaction, scope, boardId, nodeId, ["pdf"]);
    const assetRows = await transaction
      .select()
      .from(assets)
      .where(
        and(
          eq(assets.workspaceId, scope.workspaceId),
          eq(assets.boardId, boardId),
          eq(assets.id, assetId),
          eq(assets.sourceType, "upload")
        )
      )
      .limit(1)
      .for("update");
    const asset = assetRows[0];
    if (!asset) throw new IngestionNotFoundError();
    if (
      asset.declaredSize !== metadata.actualSize ||
      asset.declaredMime !== metadata.detectedMime ||
      asset.contentHash !== metadata.checksumSha256
    ) {
      throw new IngestionStateError("UPLOAD_VERIFICATION_FAILED", "上传文件校验失败。");
    }
    const existing = await transaction
      .select({
        id: ingestionJobs.id,
        boardId: ingestionJobs.boardId,
        nodeId: ingestionJobs.nodeId,
        assetId: ingestionJobs.assetId
      })
      .from(ingestionJobs)
      .where(
        and(
          eq(ingestionJobs.workspaceId, scope.workspaceId),
          eq(ingestionJobs.submissionMutationId, completionMutationId)
        )
      )
      .limit(1);
    const priorJob = existing[0];
    if (priorJob) {
      if (
        priorJob.boardId !== boardId ||
        priorJob.nodeId !== nodeId ||
        priorJob.assetId !== assetId
      ) {
        throw new IngestionStateError("IDEMPOTENCY_MISMATCH", "重复完成请求的内容不一致。");
      }
      return readOneIngestionStatus(transaction, scope, boardId, priorJob.id);
    }
    if (asset.status !== "pending") {
      throw new IngestionStateError(
        "UPLOAD_NOT_PENDING",
        "该上传已结束或正在清理，请重新选择文件。"
      );
    }
    await assertIngestionCapacity(transaction, scope);
    const updated = await transaction
      .update(assets)
      .set({
        status: "verified",
        detectedMime: metadata.detectedMime,
        actualSize: metadata.actualSize,
        completionMutationId,
        updatedAt: new Date()
      })
      .where(and(eq(assets.workspaceId, scope.workspaceId), eq(assets.id, assetId)))
      .returning({ id: assets.id });
    if (updated.length !== 1) throw new IngestionNotFoundError();
    const jobId = randomUUID();
    await transaction.insert(ingestionJobs).values({
      id: jobId,
      workspaceId: scope.workspaceId,
      boardId,
      nodeId,
      assetId,
      submissionMutationId: completionMutationId
    });
    await dispatchInTransaction(queue, transaction, jobId);
    return readOneIngestionStatus(transaction, scope, boardId, jobId);
  });
}

export async function submitRemoteIngestion(
  database: SiftloomDatabase,
  queue: QueueDispatcher,
  scope: WorkspaceScope,
  boardId: string,
  untrustedCommand: SubmitRemoteSource
): Promise<IngestionStatus> {
  const command = submitRemoteSourceSchema.parse(untrustedCommand);
  return withTenantTransaction(database, scope, async (transaction) => {
    const existing = await transaction
      .select({
        id: ingestionJobs.id,
        boardId: ingestionJobs.boardId,
        nodeId: ingestionJobs.nodeId,
        sourceUrl: assets.sourceUrl
      })
      .from(ingestionJobs)
      .innerJoin(
        assets,
        and(
          eq(assets.workspaceId, ingestionJobs.workspaceId),
          eq(assets.id, ingestionJobs.assetId)
        )
      )
      .where(
        and(
          eq(ingestionJobs.workspaceId, scope.workspaceId),
          eq(ingestionJobs.submissionMutationId, command.mutationId)
        )
      )
      .limit(1);
    const prior = existing[0];
    if (prior) {
      if (
        prior.boardId !== boardId ||
        prior.nodeId !== command.nodeId ||
        prior.sourceUrl !== command.url
      ) {
        throw new IngestionStateError(
          "IDEMPOTENCY_MISMATCH",
          "重复导入请求的 Board 不一致。"
        );
      }
      return readOneIngestionStatus(transaction, scope, boardId, prior.id);
    }
    await assertIngestionCapacity(transaction, scope);
    await assertRemoteSubmissionRate(transaction, scope);
    const sourceType: AssetSourceType = isYouTubeUrl(command.url) ? "youtube" : "webpage";
    const node = await requireActiveSourceNode(
      transaction,
      scope,
      boardId,
      command.nodeId,
      ["webpage", "video"]
    );
    if (
      (sourceType === "youtube" && node.kind !== "video") ||
      (sourceType === "webpage" && node.kind !== "webpage")
    ) {
      throw new IngestionStateError(
        "SOURCE_NODE_KIND_MISMATCH",
        sourceType === "youtube"
          ? "请使用视频节点导入该网址。"
          : "请使用网页节点导入该网址。"
      );
    }
    const assetId = randomUUID();
    const jobId = randomUUID();
    await transaction.insert(assets).values({
      id: assetId,
      workspaceId: scope.workspaceId,
      boardId,
      sourceType,
      sourceUrl: command.url,
      status: "verified"
    });
    await transaction.insert(ingestionJobs).values({
      id: jobId,
      workspaceId: scope.workspaceId,
      boardId,
      nodeId: command.nodeId,
      assetId,
      submissionMutationId: command.mutationId
    });
    await dispatchInTransaction(queue, transaction, jobId);
    return readOneIngestionStatus(transaction, scope, boardId, jobId);
  });
}

async function readOneIngestionStatus(
  transaction: TenantTransaction,
  scope: WorkspaceScope,
  boardId: string,
  jobId: string
): Promise<IngestionStatus> {
  const values = await readIngestionStatuses(transaction, scope, boardId, jobId);
  const value = values[0];
  if (!value) throw new IngestionNotFoundError();
  return value;
}

async function readIngestionStatuses(
  transaction: TenantTransaction,
  scope: WorkspaceScope,
  boardId: string,
  jobId?: string
): Promise<IngestionStatus[]> {
  const jobRows = await transaction
    .select({ job: ingestionJobs, asset: assets })
    .from(ingestionJobs)
    .innerJoin(
      assets,
      and(
        eq(assets.workspaceId, ingestionJobs.workspaceId),
        eq(assets.id, ingestionJobs.assetId)
      )
    )
    .where(
      and(
        eq(ingestionJobs.workspaceId, scope.workspaceId),
        eq(ingestionJobs.boardId, boardId),
        ...(jobId ? [eq(ingestionJobs.id, jobId)] : [])
      )
    )
    .orderBy(desc(ingestionJobs.createdAt));
  if (jobRows.length === 0) return [];
  const jobIds = jobRows.map(({ job }) => job.id);
  const assetIds = jobRows.map(({ asset }) => asset.id);
  const [attemptRows, artifactRows] = await Promise.all([
    transaction
      .select()
      .from(ingestionAttempts)
      .where(
        and(
          eq(ingestionAttempts.workspaceId, scope.workspaceId),
          inArray(ingestionAttempts.jobId, jobIds)
        )
      )
      .orderBy(asc(ingestionAttempts.attemptNumber)),
    transaction
      .select({ artifact: extractionArtifacts, segmentCount: count(extractionSegments.id) })
      .from(extractionArtifacts)
      .leftJoin(
        extractionSegments,
        and(
          eq(extractionSegments.workspaceId, extractionArtifacts.workspaceId),
          eq(extractionSegments.artifactId, extractionArtifacts.id)
        )
      )
      .where(
        and(
          eq(extractionArtifacts.workspaceId, scope.workspaceId),
          inArray(extractionArtifacts.assetId, assetIds)
        )
      )
      .groupBy(extractionArtifacts.id)
  ]);
  const attemptsByJob = new Map<string, (typeof attemptRows)[number]>();
  for (const attempt of attemptRows) attemptsByJob.set(attempt.jobId, attempt);
  const artifactsByAsset = new Map(
    artifactRows.map(({ artifact, segmentCount }) => [
      artifact.assetId,
      { artifact, segmentCount }
    ])
  );

  return jobRows.map(({ job, asset }) => {
    const attempt = attemptsByJob.get(job.id);
    const artifactValue = artifactsByAsset.get(asset.id);
    return ingestionStatusSchema.parse({
      id: job.id,
      assetId: asset.id,
      nodeId: job.nodeId,
      sourceType: asset.sourceType,
      status: job.status,
      stage: attempt?.stage ?? null,
      progress:
        job.status === "succeeded"
          ? 100
          : job.status === "failed" || job.status === "cancelled"
            ? (attempt?.progress ?? 0)
            : (attempt?.progress ?? 0),
      revision: job.revision,
      warnings: job.warningCodes,
      error: job.errorCode
        ? {
            code: job.errorCode,
            message: job.errorMessage ?? "来源处理失败。",
            retryable: job.retryable
          }
        : null,
      artifact: artifactValue
        ? {
            id: artifactValue.artifact.id,
            title: artifactValue.artifact.title,
            sourceMime: artifactValue.artifact.sourceMime,
            contentHash: artifactValue.artifact.contentHash,
            segmentCount: artifactValue.segmentCount,
            extractedCharacters: artifactValue.artifact.extractedCharacters,
            extractorVersion: artifactValue.artifact.extractorVersion
          }
        : null,
      retryOfJobId: job.retryOfJobId,
      createdAt: job.createdAt.toISOString(),
      updatedAt: job.updatedAt.toISOString()
    });
  });
}

export async function listIngestionStatuses(
  database: SiftloomDatabase,
  scope: WorkspaceScope,
  boardId: string
): Promise<IngestionStatus[]> {
  return withTenantTransaction(database, scope, async (transaction) => {
    const boardRows = await transaction
      .select({ id: boards.id })
      .from(boards)
      .where(and(eq(boards.workspaceId, scope.workspaceId), eq(boards.id, boardId)))
      .limit(1);
    if (!boardRows[0]) throw new BoardNotFoundError();
    return readIngestionStatuses(transaction, scope, boardId);
  });
}

export async function retryIngestion(
  database: SiftloomDatabase,
  queue: QueueDispatcher,
  scope: WorkspaceScope,
  boardId: string,
  failedJobId: string,
  untrustedCommand: RetryIngestion
): Promise<IngestionStatus> {
  const command = retryIngestionSchema.parse(untrustedCommand);
  return withTenantTransaction(database, scope, async (transaction) => {
    const existing = await transaction
      .select({
        id: ingestionJobs.id,
        boardId: ingestionJobs.boardId,
        retryOfJobId: ingestionJobs.retryOfJobId
      })
      .from(ingestionJobs)
      .where(
        and(
          eq(ingestionJobs.workspaceId, scope.workspaceId),
          eq(ingestionJobs.submissionMutationId, command.mutationId)
        )
      )
      .limit(1);
    if (existing[0]) {
      if (existing[0].boardId !== boardId || existing[0].retryOfJobId !== failedJobId) {
        throw new IngestionStateError("IDEMPOTENCY_MISMATCH", "重复重试请求的内容不一致。");
      }
      return readOneIngestionStatus(transaction, scope, boardId, existing[0].id);
    }
    await assertIngestionCapacity(transaction, scope);
    const failedRows = await transaction
      .select()
      .from(ingestionJobs)
      .where(
        and(
          eq(ingestionJobs.workspaceId, scope.workspaceId),
          eq(ingestionJobs.boardId, boardId),
          eq(ingestionJobs.id, failedJobId)
        )
      )
      .limit(1)
      .for("update");
    const failed = failedRows[0];
    if (!failed) throw new IngestionNotFoundError();
    if (failed.status !== "failed" || !failed.retryable) {
      throw new IngestionStateError("INGESTION_NOT_RETRYABLE", "该失败无法安全重试。");
    }
    const jobId = randomUUID();
    await transaction.insert(ingestionJobs).values({
      id: jobId,
      workspaceId: scope.workspaceId,
      boardId,
      nodeId: failed.nodeId,
      assetId: failed.assetId,
      submissionMutationId: command.mutationId,
      retryOfJobId: failed.id
    });
    await dispatchInTransaction(queue, transaction, jobId);
    return readOneIngestionStatus(transaction, scope, boardId, jobId);
  });
}

export interface ClaimedIngestionAttempt {
  readonly scope: WorkspaceScope;
  readonly boardId: string;
  readonly jobId: string;
  readonly attemptId: string;
  readonly attemptNumber: number;
  readonly leaseToken: string;
  readonly asset: {
    readonly id: string;
    readonly workspaceId: string;
    readonly sourceType: AssetSourceType;
    readonly objectKey: string | null;
    readonly originalFileName: string | null;
    readonly sourceUrl: string | null;
    readonly declaredMime: string | null;
    readonly contentHash: string | null;
  };
}

export async function resolveIngestionWorkerScope(
  database: SiftloomDatabase,
  jobId: string
): Promise<WorkspaceScope & { readonly boardId: string }> {
  const result = await database.execute(
    sql<{
      workspace_id: string;
      board_id: string;
      actor_user_id: string;
    }>`select * from resolve_ingestion_job_scope(${jobId}::uuid)`
  );
  const row = result.rows[0];
  if (!row) throw new IngestionNotFoundError();
  return {
    workspaceId: String(row.workspace_id),
    actorUserId: String(row.actor_user_id),
    boardId: String(row.board_id)
  };
}

export async function claimIngestionAttempt(
  database: SiftloomDatabase,
  jobId: string
): Promise<ClaimedIngestionAttempt | null> {
  const resolved = await resolveIngestionWorkerScope(database, jobId);
  const scope: WorkspaceScope = {
    workspaceId: resolved.workspaceId,
    actorUserId: resolved.actorUserId
  };
  return withTenantTransaction(database, scope, async (transaction) => {
    const jobRows = await transaction
      .select({
        job: ingestionJobs,
        asset: assets,
        nodeDeletedAt: nodes.deletedAt,
        boardArchivedAt: boards.archivedAt
      })
      .from(ingestionJobs)
      .innerJoin(
        assets,
        and(
          eq(assets.workspaceId, ingestionJobs.workspaceId),
          eq(assets.id, ingestionJobs.assetId)
        )
      )
      .innerJoin(
        nodes,
        and(
          eq(nodes.workspaceId, ingestionJobs.workspaceId),
          eq(nodes.id, ingestionJobs.nodeId)
        )
      )
      .innerJoin(
        boards,
        and(
          eq(boards.workspaceId, ingestionJobs.workspaceId),
          eq(boards.id, ingestionJobs.boardId)
        )
      )
      .where(
        and(eq(ingestionJobs.workspaceId, scope.workspaceId), eq(ingestionJobs.id, jobId))
      )
      .limit(1)
      .for("update", { of: ingestionJobs });
    const value = jobRows[0];
    if (!value) throw new IngestionNotFoundError();
    if (["succeeded", "failed", "cancelled"].includes(value.job.status)) return null;
    if (value.nodeDeletedAt || value.boardArchivedAt) {
      const now = new Date();
      await transaction
        .update(ingestionJobs)
        .set({
          status: "cancelled",
          errorCode: "source_unavailable",
          errorMessage: "来源已被删除或 Board 已归档。",
          retryable: false,
          finishedAt: now,
          updatedAt: now,
          revision: sql`${ingestionJobs.revision} + 1`
        })
        .where(
          and(eq(ingestionJobs.workspaceId, scope.workspaceId), eq(ingestionJobs.id, jobId))
        );
      return null;
    }
    const runningAttemptRows = await transaction
      .select({ id: ingestionAttempts.id, updatedAt: ingestionAttempts.updatedAt })
      .from(ingestionAttempts)
      .where(
        and(
          eq(ingestionAttempts.workspaceId, scope.workspaceId),
          eq(ingestionAttempts.jobId, jobId),
          eq(ingestionAttempts.status, "running")
        )
      )
      .orderBy(desc(ingestionAttempts.attemptNumber))
      .limit(1)
      .for("update");
    const runningAttempt = runningAttemptRows[0];
    if (runningAttempt) {
      const leaseAgeMs = Date.now() - runningAttempt.updatedAt.getTime();
      if (leaseAgeMs < 110_000) return null;
      const leaseExpiredAt = new Date();
      await transaction
        .update(ingestionAttempts)
        .set({
          status: "cancelled",
          errorCode: "lease_expired",
          errorMessage: "处理租约已过期，已由新尝试接管。",
          retryable: true,
          finishedAt: leaseExpiredAt,
          updatedAt: leaseExpiredAt
        })
        .where(
          and(
            eq(ingestionAttempts.workspaceId, scope.workspaceId),
            eq(ingestionAttempts.id, runningAttempt.id),
            eq(ingestionAttempts.status, "running")
          )
        );
    }
    const attemptCountRows = await transaction
      .select({ value: count() })
      .from(ingestionAttempts)
      .where(
        and(
          eq(ingestionAttempts.workspaceId, scope.workspaceId),
          eq(ingestionAttempts.jobId, jobId)
        )
      );
    const attemptNumber = Number(attemptCountRows[0]?.value ?? 0) + 1;
    if (attemptNumber > PHASE_1_LIMITS.ingestion.maxAutomaticAttempts) {
      const now = new Date();
      await transaction
        .update(ingestionJobs)
        .set({
          status: "failed",
          errorCode: "attempts_exhausted",
          errorMessage: "自动重试次数已用完。",
          retryable: true,
          finishedAt: now,
          updatedAt: now,
          revision: sql`${ingestionJobs.revision} + 1`
        })
        .where(
          and(eq(ingestionJobs.workspaceId, scope.workspaceId), eq(ingestionJobs.id, jobId))
        );
      return null;
    }
    const attemptId = randomUUID();
    const leaseToken = randomUUID();
    const now = new Date();
    await transaction.insert(ingestionAttempts).values({
      id: attemptId,
      workspaceId: scope.workspaceId,
      boardId: value.job.boardId,
      jobId,
      attemptNumber,
      status: "running",
      stage: "validating",
      progress: 5,
      leaseToken,
      startedAt: now,
      updatedAt: now
    });
    await transaction
      .update(ingestionJobs)
      .set({
        status: "running",
        errorCode: null,
        errorMessage: null,
        retryable: false,
        updatedAt: now,
        revision: sql`${ingestionJobs.revision} + 1`
      })
      .where(
        and(eq(ingestionJobs.workspaceId, scope.workspaceId), eq(ingestionJobs.id, jobId))
      );
    return {
      scope,
      boardId: value.job.boardId,
      jobId,
      attemptId,
      attemptNumber,
      leaseToken,
      asset: {
        id: value.asset.id,
        workspaceId: value.asset.workspaceId,
        sourceType: value.asset.sourceType,
        objectKey: value.asset.objectKey,
        originalFileName: value.asset.originalFileName,
        sourceUrl: value.asset.sourceUrl,
        declaredMime: value.asset.declaredMime,
        contentHash: value.asset.contentHash
      }
    };
  });
}

export async function updateIngestionAttemptStage(
  database: SiftloomDatabase,
  claimed: ClaimedIngestionAttempt,
  stage: IngestionAttemptStage,
  progress: number
): Promise<void> {
  await withTenantTransaction(database, claimed.scope, async (transaction) => {
    const updated = await transaction
      .update(ingestionAttempts)
      .set({
        stage,
        progress: Math.max(0, Math.min(99, Math.round(progress))),
        updatedAt: new Date()
      })
      .where(
        and(
          eq(ingestionAttempts.workspaceId, claimed.scope.workspaceId),
          eq(ingestionAttempts.id, claimed.attemptId),
          eq(ingestionAttempts.leaseToken, claimed.leaseToken),
          eq(ingestionAttempts.status, "running")
        )
      )
      .returning({ id: ingestionAttempts.id });
    if (updated.length !== 1) throw new StaleIngestionAttemptError();
  });
}

export async function completeIngestionAttempt(
  database: SiftloomDatabase,
  claimed: ClaimedIngestionAttempt,
  extracted: PersistedExtractedSource
): Promise<void> {
  await withTenantTransaction(database, claimed.scope, async (transaction) => {
    const now = new Date();
    const attemptRows = await transaction
      .select({ status: ingestionAttempts.status })
      .from(ingestionAttempts)
      .where(
        and(
          eq(ingestionAttempts.workspaceId, claimed.scope.workspaceId),
          eq(ingestionAttempts.id, claimed.attemptId),
          eq(ingestionAttempts.leaseToken, claimed.leaseToken)
        )
      )
      .limit(1)
      .for("update");
    if (attemptRows[0]?.status === "succeeded") return;
    if (attemptRows[0]?.status !== "running") throw new StaleIngestionAttemptError();
    const authorityRows = await transaction
      .select({ nodeDeletedAt: nodes.deletedAt, boardArchivedAt: boards.archivedAt })
      .from(ingestionJobs)
      .innerJoin(
        nodes,
        and(
          eq(nodes.workspaceId, ingestionJobs.workspaceId),
          eq(nodes.id, ingestionJobs.nodeId)
        )
      )
      .innerJoin(
        boards,
        and(
          eq(boards.workspaceId, ingestionJobs.workspaceId),
          eq(boards.id, ingestionJobs.boardId)
        )
      )
      .where(
        and(
          eq(ingestionJobs.workspaceId, claimed.scope.workspaceId),
          eq(ingestionJobs.id, claimed.jobId)
        )
      )
      .limit(1);
    const authority = authorityRows[0];
    if (!authority || authority.nodeDeletedAt || authority.boardArchivedAt) {
      await transaction
        .update(ingestionAttempts)
        .set({
          status: "cancelled",
          errorCode: "source_unavailable",
          errorMessage: "来源已被删除或 Board 已归档。",
          retryable: false,
          finishedAt: now,
          updatedAt: now
        })
        .where(
          and(
            eq(ingestionAttempts.workspaceId, claimed.scope.workspaceId),
            eq(ingestionAttempts.id, claimed.attemptId),
            eq(ingestionAttempts.leaseToken, claimed.leaseToken),
            eq(ingestionAttempts.status, "running")
          )
        );
      await transaction
        .update(ingestionJobs)
        .set({
          status: "cancelled",
          errorCode: "source_unavailable",
          errorMessage: "来源已被删除或 Board 已归档。",
          retryable: false,
          finishedAt: now,
          updatedAt: now,
          revision: sql`${ingestionJobs.revision} + 1`
        })
        .where(
          and(
            eq(ingestionJobs.workspaceId, claimed.scope.workspaceId),
            eq(ingestionJobs.id, claimed.jobId),
            inArray(ingestionJobs.status, ["queued", "running"])
          )
        );
      return;
    }
    const versionRows = await transaction
      .select({ value: count() })
      .from(extractionArtifacts)
      .where(
        and(
          eq(extractionArtifacts.workspaceId, claimed.scope.workspaceId),
          eq(extractionArtifacts.assetId, claimed.asset.id)
        )
      );
    const artifactId = randomUUID();
    const extractedCharacters = extracted.segments.reduce(
      (total, segment) => total + segment.text.length,
      0
    );
    await transaction.insert(extractionArtifacts).values({
      id: artifactId,
      workspaceId: claimed.scope.workspaceId,
      boardId: claimed.boardId,
      assetId: claimed.asset.id,
      jobId: claimed.jobId,
      attemptId: claimed.attemptId,
      version: Number(versionRows[0]?.value ?? 0) + 1,
      title: extracted.title,
      sourceMime: extracted.sourceMime,
      contentHash: extracted.contentHash,
      extractorVersion: extracted.extractorVersion,
      extractedCharacters,
      warningCodes: [...extracted.warnings],
      provenance: extracted.provenance
    });
    if (extracted.segments.length > 0) {
      await transaction.insert(extractionSegments).values(
        extracted.segments.map((segment, ordinal) => ({
          id: randomUUID(),
          workspaceId: claimed.scope.workspaceId,
          boardId: claimed.boardId,
          artifactId,
          ordinal,
          text: segment.text,
          location: segment.location,
          contentHash: segment.contentHash
        }))
      );
    }
    const completedAttempt = await transaction
      .update(ingestionAttempts)
      .set({
        status: "succeeded",
        stage: "storing",
        progress: 100,
        finishedAt: now,
        updatedAt: now
      })
      .where(
        and(
          eq(ingestionAttempts.workspaceId, claimed.scope.workspaceId),
          eq(ingestionAttempts.id, claimed.attemptId),
          eq(ingestionAttempts.leaseToken, claimed.leaseToken),
          eq(ingestionAttempts.status, "running")
        )
      )
      .returning({ id: ingestionAttempts.id });
    if (completedAttempt.length !== 1) throw new StaleIngestionAttemptError();
    await transaction
      .update(ingestionJobs)
      .set({
        status: "succeeded",
        warningCodes: [...extracted.warnings],
        errorCode: null,
        errorMessage: null,
        retryable: false,
        finishedAt: now,
        updatedAt: now,
        revision: sql`${ingestionJobs.revision} + 1`
      })
      .where(
        and(
          eq(ingestionJobs.workspaceId, claimed.scope.workspaceId),
          eq(ingestionJobs.id, claimed.jobId),
          inArray(ingestionJobs.status, ["queued", "running"])
        )
      );
    await transaction
      .update(assets)
      .set({
        status: "ready",
        contentHash: extracted.contentHash,
        detectedMime: extracted.sourceMime,
        updatedAt: now
      })
      .where(
        and(
          eq(assets.workspaceId, claimed.scope.workspaceId),
          eq(assets.id, claimed.asset.id)
        )
      );
  });
}

export async function failIngestionAttempt(
  database: SiftloomDatabase,
  claimed: ClaimedIngestionAttempt,
  error: NormalizedIngestionFailure
): Promise<{ readonly shouldRetry: boolean }> {
  return withTenantTransaction(database, claimed.scope, async (transaction) => {
    const now = new Date();
    const failed = await transaction
      .update(ingestionAttempts)
      .set({
        status: "failed",
        errorCode: error.code,
        errorMessage: error.message,
        retryable: error.retryable,
        finishedAt: now,
        updatedAt: now
      })
      .where(
        and(
          eq(ingestionAttempts.workspaceId, claimed.scope.workspaceId),
          eq(ingestionAttempts.id, claimed.attemptId),
          eq(ingestionAttempts.leaseToken, claimed.leaseToken),
          eq(ingestionAttempts.status, "running")
        )
      )
      .returning({ id: ingestionAttempts.id });
    if (failed.length !== 1) throw new StaleIngestionAttemptError();
    const shouldRetry =
      error.retryable &&
      claimed.attemptNumber < PHASE_1_LIMITS.ingestion.maxAutomaticAttempts;
    await transaction
      .update(ingestionJobs)
      .set({
        status: shouldRetry ? "queued" : "failed",
        errorCode: error.code,
        errorMessage: error.message,
        retryable: error.retryable,
        finishedAt: shouldRetry ? null : now,
        updatedAt: now,
        revision: sql`${ingestionJobs.revision} + 1`
      })
      .where(
        and(
          eq(ingestionJobs.workspaceId, claimed.scope.workspaceId),
          eq(ingestionJobs.id, claimed.jobId),
          inArray(ingestionJobs.status, ["queued", "running"])
        )
      );
    if (!shouldRetry)
      await transaction
        .update(assets)
        .set({ status: "failed", updatedAt: now })
        .where(
          and(
            eq(assets.workspaceId, claimed.scope.workspaceId),
            eq(assets.id, claimed.asset.id)
          )
        );
    return { shouldRetry };
  });
}

export async function listStaleUploadCleanupCandidates(
  database: SiftloomDatabase,
  limit = 50
): Promise<StaleUploadCleanupCandidate[]> {
  const boundedLimit = Math.max(1, Math.min(100, Math.round(limit)));
  const result = await database.execute(
    sql<{
      workspace_id: string;
      actor_user_id: string;
      asset_id: string;
    }>`select * from resolve_stale_upload_cleanup_candidates(${boundedLimit})`
  );
  return result.rows.map((row) => ({
    scope: {
      workspaceId: String(row.workspace_id),
      actorUserId: String(row.actor_user_id)
    },
    assetId: String(row.asset_id)
  }));
}

export async function claimStaleUploadForCleanup(
  database: SiftloomDatabase,
  candidate: StaleUploadCleanupCandidate
): Promise<string | null> {
  return withTenantTransaction(database, candidate.scope, async (transaction) => {
    const cutoff = new Date(Date.now() - 60 * 60 * 1_000);
    const rows = await transaction
      .select({ objectKey: assets.objectKey })
      .from(assets)
      .where(
        and(
          eq(assets.workspaceId, candidate.scope.workspaceId),
          eq(assets.id, candidate.assetId),
          eq(assets.sourceType, "upload"),
          inArray(assets.status, ["pending", "quarantined"]),
          lt(assets.updatedAt, cutoff)
        )
      )
      .limit(1)
      .for("update");
    const objectKey = rows[0]?.objectKey;
    if (!objectKey) return null;
    await transaction
      .update(assets)
      .set({ status: "quarantined" })
      .where(
        and(
          eq(assets.workspaceId, candidate.scope.workspaceId),
          eq(assets.id, candidate.assetId)
        )
      );
    return objectKey;
  });
}

export async function deleteQuarantinedUploadRecord(
  database: SiftloomDatabase,
  candidate: StaleUploadCleanupCandidate
): Promise<boolean> {
  return withTenantTransaction(database, candidate.scope, async (transaction) => {
    const deleted = await transaction
      .delete(assets)
      .where(
        and(
          eq(assets.workspaceId, candidate.scope.workspaceId),
          eq(assets.id, candidate.assetId),
          eq(assets.sourceType, "upload"),
          eq(assets.status, "quarantined")
        )
      )
      .returning({ id: assets.id });
    return deleted.length === 1;
  });
}

export type IngestionQueue = PgBoss;
