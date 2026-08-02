import { createHash, randomUUID } from "node:crypto";

import {
  CHAT_TOKEN_BUDGET,
  assembleContext,
  type ContextCandidate,
  type ContextSnapshot,
  type HistoryMessage
} from "@siftloom/ai";
import {
  chatRunSchema,
  chatSourceSnapshotSchema,
  chatThreadSchema,
  canvasNodePayloadSchema,
  PHASE_1_LIMITS,
  type ChatRun,
  type ChatRunCreateCommand,
  type ChatSourceSnapshot,
  type ChatStreamEvent,
  type ChatThread,
  type WorkspaceScope
} from "@siftloom/shared";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";

import type { SiftloomDatabase } from "./client.js";
import {
  chatMessageSources,
  chatMessages,
  chatRunEvents,
  chatRuns,
  chats,
  contextManifests,
  contextSourceSnapshots,
  edges,
  extractionArtifacts,
  extractionSegments,
  ingestionJobs,
  nodes,
  providerAttempts,
  usageEvents
} from "./schema.js";
import { withTenantTransaction, type TenantTransaction } from "./tenant.js";

export class ChatNotFoundError extends Error {}
export class ChatSourceRequiredError extends Error {
  public constructor(public readonly exclusions: readonly SourceExclusion[]) {
    super("At least one eligible source is required");
  }
}
export class ChatRunActiveError extends Error {}
export class ChatRunStateError extends Error {}
export class ChatLimitError extends Error {
  public constructor(
    public readonly code: string,
    public readonly httpStatus: number,
    message: string
  ) {
    super(message);
  }
}

interface SourceExclusion {
  readonly nodeId: string | null;
  readonly title: string;
  readonly reason: string;
}

interface FrozenSource {
  readonly candidate: ContextCandidate;
  readonly nodeId: string;
  readonly nodeRevision: number;
  readonly title: string;
  readonly sourceKind: "note" | "text" | "pdf" | "webpage" | "video";
  readonly artifactId: string | null;
  readonly artifactVersion: number | null;
}

export interface CreatedChatRun {
  readonly run: ChatRun;
  readonly chatId: string;
  readonly userMessageId: string;
}

export interface ClaimedChatRun {
  readonly runId: string;
  readonly attemptId: string;
  readonly providerName: string;
  readonly model: string;
  readonly prompt: string;
  readonly context: readonly ContextSnapshot[];
  readonly history: readonly HistoryMessage[];
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function databaseConstraint(error: unknown): string | null {
  let current = error;
  for (let depth = 0; depth < 5; depth += 1) {
    if (!current || typeof current !== "object") return null;
    if ("constraint" in current && typeof current.constraint === "string") {
      return current.constraint;
    }
    current = "cause" in current ? current.cause : null;
  }
  return null;
}

async function resolveFrozenSources(
  transaction: TenantTransaction,
  scope: WorkspaceScope,
  boardId: string,
  chatNodeId: string,
  selectedSourceNodeIds: readonly string[]
): Promise<{ sources: FrozenSource[]; exclusions: SourceExclusion[] }> {
  const chatNode = await transaction
    .select()
    .from(nodes)
    .where(
      and(
        eq(nodes.workspaceId, scope.workspaceId),
        eq(nodes.boardId, boardId),
        eq(nodes.id, chatNodeId),
        eq(nodes.kind, "chat"),
        isNull(nodes.deletedAt)
      )
    )
    .limit(1);
  if (!chatNode[0]) throw new ChatNotFoundError();

  const incoming = await transaction
    .select({ sourceNodeId: edges.sourceNodeId })
    .from(edges)
    .where(
      and(
        eq(edges.workspaceId, scope.workspaceId),
        eq(edges.boardId, boardId),
        eq(edges.targetNodeId, chatNodeId),
        isNull(edges.deletedAt)
      )
    )
    .orderBy(asc(edges.rank), asc(edges.id));
  const requestedIds = [
    ...incoming.map((edge) => edge.sourceNodeId),
    ...selectedSourceNodeIds
  ];
  const requestedRows =
    requestedIds.length === 0
      ? []
      : await transaction
          .select()
          .from(nodes)
          .where(
            and(
              eq(nodes.workspaceId, scope.workspaceId),
              eq(nodes.boardId, boardId),
              inArray(nodes.id, requestedIds),
              isNull(nodes.deletedAt)
            )
          );
  const requestedById = new Map(requestedRows.map((row) => [row.id, row]));
  const expandedIds: string[] = [];
  const exclusions: SourceExclusion[] = [];

  for (const requestedId of requestedIds) {
    const row = requestedById.get(requestedId);
    if (!row) {
      exclusions.push({
        nodeId: requestedId,
        title: "不可用来源",
        reason: "来源已删除或无权访问"
      });
      continue;
    }
    if (row.kind !== "group") {
      expandedIds.push(row.id);
      continue;
    }
    const children = await transaction
      .select({ id: nodes.id })
      .from(nodes)
      .where(
        and(
          eq(nodes.workspaceId, scope.workspaceId),
          eq(nodes.boardId, boardId),
          eq(nodes.parentNodeId, row.id),
          isNull(nodes.deletedAt)
        )
      )
      .orderBy(asc(nodes.createdAt), asc(nodes.id));
    if (children.length === 0) {
      const payload = canvasNodePayloadSchema.parse(row.payload);
      exclusions.push({
        nodeId: row.id,
        title: payload.title,
        reason: "分组中没有可用来源"
      });
    }
    expandedIds.push(...children.map((child) => child.id));
  }

  const deduplicatedIds = [...new Set(expandedIds)];
  if (deduplicatedIds.length > PHASE_1_LIMITS.ai.maxSourcesPerRun) {
    throw new ChatLimitError(
      "CHAT_SOURCE_LIMIT",
      422,
      `每次生成最多使用 ${PHASE_1_LIMITS.ai.maxSourcesPerRun} 个来源。`
    );
  }
  const sourceRows =
    deduplicatedIds.length === 0
      ? []
      : await transaction
          .select()
          .from(nodes)
          .where(
            and(
              eq(nodes.workspaceId, scope.workspaceId),
              eq(nodes.boardId, boardId),
              inArray(nodes.id, deduplicatedIds),
              isNull(nodes.deletedAt)
            )
          );
  const sourceById = new Map(sourceRows.map((row) => [row.id, row]));
  const sources: FrozenSource[] = [];

  for (const nodeId of deduplicatedIds) {
    const row = sourceById.get(nodeId);
    if (!row || row.kind === "chat" || row.kind === "group") continue;
    const payload = canvasNodePayloadSchema.parse(row.payload);
    const sourceHandle = `S${sources.length + 1}`;
    const snapshotId = randomUUID();

    if (payload.kind === "note" || payload.kind === "text") {
      const body = payload.body.trim();
      if (!body) {
        exclusions.push({ nodeId, title: payload.title, reason: "来源没有正文" });
        continue;
      }
      sources.push({
        candidate: {
          snapshotId,
          sourceHandle,
          title: payload.title,
          contentHash: hash(body),
          fragments: [{ id: `node:${nodeId}:${row.revision}`, ordinal: 0, text: body }]
        },
        nodeId,
        nodeRevision: row.revision,
        title: payload.title,
        sourceKind: payload.kind,
        artifactId: null,
        artifactVersion: null
      });
      continue;
    }

    const jobs = await transaction
      .select({ id: ingestionJobs.id })
      .from(ingestionJobs)
      .where(
        and(
          eq(ingestionJobs.workspaceId, scope.workspaceId),
          eq(ingestionJobs.boardId, boardId),
          eq(ingestionJobs.nodeId, nodeId),
          eq(ingestionJobs.status, "succeeded")
        )
      )
      .orderBy(desc(ingestionJobs.finishedAt), desc(ingestionJobs.createdAt))
      .limit(1);
    const artifacts = jobs[0]
      ? await transaction
          .select()
          .from(extractionArtifacts)
          .where(
            and(
              eq(extractionArtifacts.workspaceId, scope.workspaceId),
              eq(extractionArtifacts.boardId, boardId),
              eq(extractionArtifacts.jobId, jobs[0].id)
            )
          )
          .orderBy(desc(extractionArtifacts.version))
          .limit(1)
      : [];
    const artifact = artifacts[0];
    const segments = artifact
      ? await transaction
          .select()
          .from(extractionSegments)
          .where(
            and(
              eq(extractionSegments.workspaceId, scope.workspaceId),
              eq(extractionSegments.boardId, boardId),
              eq(extractionSegments.artifactId, artifact.id)
            )
          )
          .orderBy(asc(extractionSegments.ordinal), asc(extractionSegments.id))
      : [];
    if (!artifact || segments.length === 0) {
      exclusions.push({ nodeId, title: payload.title, reason: "来源尚未完成提取" });
      continue;
    }
    sources.push({
      candidate: {
        snapshotId,
        sourceHandle,
        title: artifact.title?.trim() || payload.title,
        contentHash: artifact.contentHash,
        fragments: segments.map((segment) => ({
          id: segment.id,
          ordinal: segment.ordinal,
          text: segment.text
        }))
      },
      nodeId,
      nodeRevision: row.revision,
      title: artifact.title?.trim() || payload.title,
      sourceKind: row.kind as FrozenSource["sourceKind"],
      artifactId: artifact.id,
      artifactVersion: artifact.version
    });
  }

  // Handles are assigned after exclusions so [S1..Sn] are contiguous.
  return {
    sources: sources.map((source, index) => ({
      ...source,
      candidate: { ...source.candidate, sourceHandle: `S${index + 1}` }
    })),
    exclusions
  };
}

async function eligibleHistory(
  transaction: TenantTransaction,
  scope: WorkspaceScope,
  boardId: string,
  chatId: string,
  sources: readonly FrozenSource[]
): Promise<{ messages: HistoryMessage[]; ids: string[] }> {
  const rows = await transaction
    .select()
    .from(chatMessages)
    .where(
      and(
        eq(chatMessages.workspaceId, scope.workspaceId),
        eq(chatMessages.boardId, boardId),
        eq(chatMessages.chatId, chatId)
      )
    )
    .orderBy(desc(chatMessages.sequence))
    .limit(40);
  rows.reverse();
  const assistantRows = rows.filter((row) => row.role === "assistant");
  const assistantRunIds = assistantRows.map((row) => row.runId);
  const messageIdByRunId = new Map(assistantRows.map((row) => [row.runId, row.id]));
  const lineageRows =
    assistantRunIds.length === 0
      ? []
      : await transaction
          .select({
            runId: contextSourceSnapshots.runId,
            nodeId: contextSourceSnapshots.nodeId,
            nodeRevision: contextSourceSnapshots.nodeRevision,
            contentHash: contextSourceSnapshots.contentHash
          })
          .from(contextSourceSnapshots)
          .where(inArray(contextSourceSnapshots.runId, assistantRunIds));
  const current = new Set(
    sources.map(
      (source) => `${source.nodeId}:${source.nodeRevision}:${source.candidate.contentHash}`
    )
  );
  const lineageByMessage = new Map<string, string[]>();
  for (const row of lineageRows) {
    const messageId = messageIdByRunId.get(row.runId);
    if (!messageId) continue;
    const values = lineageByMessage.get(messageId) ?? [];
    values.push(`${row.nodeId}:${row.nodeRevision}:${row.contentHash}`);
    lineageByMessage.set(messageId, values);
  }
  const included: typeof rows = [];
  for (let index = 0; index < rows.length - 1; index += 1) {
    const user = rows[index];
    const assistant = rows[index + 1];
    if (user?.role !== "user" || assistant?.role !== "assistant") continue;
    const lineage = lineageByMessage.get(assistant.id) ?? [];
    if (lineage.length > 0 && lineage.every((item) => current.has(item))) {
      included.push(user, assistant);
      index += 1;
    }
  }
  return {
    messages: included.map((row) => ({ role: row.role, content: row.content })),
    ids: included.map((row) => row.id)
  };
}

function toRun(
  row: typeof chatRuns.$inferSelect,
  exclusions: SourceExclusion[],
  sourceCount: number
): ChatRun {
  return chatRunSchema.parse({
    id: row.id,
    status: row.status,
    error: row.errorCode
      ? {
          code: row.errorCode,
          message: row.errorMessage ?? "生成失败",
          retryable: row.retryable
        }
      : null,
    exclusions,
    sourceCount,
    createdAt: row.createdAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString() ?? null
  });
}

export async function createChatRun(
  database: SiftloomDatabase,
  scope: WorkspaceScope,
  boardId: string,
  chatNodeId: string,
  command: ChatRunCreateCommand,
  provider: { readonly name: string; readonly model: string }
): Promise<CreatedChatRun> {
  try {
    return await withTenantTransaction(database, scope, async (transaction) => {
      const requestHash = hash(
        JSON.stringify({
          boardId,
          chatNodeId,
          prompt: command.prompt,
          retryOfRunId: command.retryOfRunId,
          selectedSourceNodeIds: command.selectedSourceNodeIds
        })
      );
      const existing = await transaction
        .select()
        .from(chatRuns)
        .where(
          and(
            eq(chatRuns.workspaceId, scope.workspaceId),
            eq(chatRuns.mutationId, command.mutationId)
          )
        )
        .limit(1);
      if (existing[0]) {
        if (existing[0].requestHash !== requestHash) throw new ChatRunStateError();
        const manifest = await transaction
          .select()
          .from(contextManifests)
          .where(eq(contextManifests.runId, existing[0].id))
          .limit(1);
        const message = await transaction
          .select({ id: chatMessages.id })
          .from(chatMessages)
          .where(and(eq(chatMessages.runId, existing[0].id), eq(chatMessages.role, "user")))
          .limit(1);
        return {
          run: toRun(existing[0], manifest[0]?.exclusions ?? [], 0),
          chatId: existing[0].chatId,
          userMessageId: message[0]?.id ?? randomUUID()
        };
      }

      const recentRuns = await transaction
        .select({ count: sql<number>`count(*)::int` })
        .from(chatRuns)
        .where(
          and(
            eq(chatRuns.workspaceId, scope.workspaceId),
            sql`${chatRuns.createdAt} >= now() - interval '1 hour'`
          )
        );
      if ((recentRuns[0]?.count ?? 0) >= PHASE_1_LIMITS.ai.chatRunsPerWorkspaceHour) {
        throw new ChatLimitError(
          "CHAT_RATE_LIMIT",
          429,
          `每个工作区每小时最多创建 ${PHASE_1_LIMITS.ai.chatRunsPerWorkspaceHour} 次生成。`
        );
      }
      const workspaceActive = await transaction
        .select({ id: chatRuns.id })
        .from(chatRuns)
        .where(
          and(
            eq(chatRuns.workspaceId, scope.workspaceId),
            inArray(chatRuns.status, ["queued", "running"])
          )
        )
        .limit(1);
      if (workspaceActive[0]) throw new ChatRunActiveError();

      const frozen = await resolveFrozenSources(
        transaction,
        scope,
        boardId,
        chatNodeId,
        command.selectedSourceNodeIds
      );
      if (frozen.sources.length === 0) throw new ChatSourceRequiredError(frozen.exclusions);

      await transaction
        .insert(chats)
        .values({ workspaceId: scope.workspaceId, boardId, nodeId: chatNodeId })
        .onConflictDoNothing();
      const chatRows = await transaction
        .select()
        .from(chats)
        .where(
          and(
            eq(chats.workspaceId, scope.workspaceId),
            eq(chats.boardId, boardId),
            eq(chats.nodeId, chatNodeId)
          )
        )
        .limit(1);
      const chat = chatRows[0];
      if (!chat) throw new ChatNotFoundError();
      const active = await transaction
        .select({ id: chatRuns.id })
        .from(chatRuns)
        .where(
          and(
            eq(chatRuns.workspaceId, scope.workspaceId),
            eq(chatRuns.chatId, chat.id),
            inArray(chatRuns.status, ["queued", "running"])
          )
        )
        .limit(1);
      if (active[0]) throw new ChatRunActiveError();
      if (command.retryOfRunId) {
        const retryTarget = await transaction
          .select({ id: chatRuns.id, status: chatRuns.status })
          .from(chatRuns)
          .where(
            and(
              eq(chatRuns.workspaceId, scope.workspaceId),
              eq(chatRuns.boardId, boardId),
              eq(chatRuns.chatId, chat.id),
              eq(chatRuns.id, command.retryOfRunId)
            )
          )
          .limit(1);
        if (!retryTarget[0] || !["failed", "cancelled"].includes(retryTarget[0].status)) {
          throw new ChatRunStateError();
        }
      }

      const priorHistory = await eligibleHistory(
        transaction,
        scope,
        boardId,
        chat.id,
        frozen.sources
      );
      const assembled = assembleContext(
        frozen.sources.map((source) => source.candidate),
        priorHistory.messages
      );
      if (assembled.snapshots.length === 0)
        throw new ChatSourceRequiredError(frozen.exclusions);
      const runId = randomUUID();
      const userMessageId = randomUUID();
      const manifestId = randomUUID();
      const runRows = await transaction
        .insert(chatRuns)
        .values({
          id: runId,
          workspaceId: scope.workspaceId,
          boardId,
          chatId: chat.id,
          mutationId: command.mutationId,
          requestHash,
          retryOfRunId: command.retryOfRunId,
          providerName: provider.name,
          model: provider.model
        })
        .returning();
      const sequence = chat.nextMessageSequence;
      await transaction.insert(chatMessages).values({
        id: userMessageId,
        workspaceId: scope.workspaceId,
        boardId,
        chatId: chat.id,
        runId,
        role: "user",
        sequence,
        content: command.prompt
      });
      await transaction
        .update(chats)
        .set({ nextMessageSequence: sequence + 1, updatedAt: new Date() })
        .where(eq(chats.id, chat.id));
      const includedHistoryIds =
        assembled.history.length === 0
          ? []
          : priorHistory.ids.slice(-assembled.history.length);
      await transaction.insert(contextManifests).values({
        id: manifestId,
        workspaceId: scope.workspaceId,
        boardId,
        runId,
        scopeHash: hash(
          assembled.snapshots
            .map((item) => `${item.sourceHandle}:${item.contentHash}`)
            .join("|")
        ),
        sourceTokens: assembled.sourceTokens,
        historyTokens: assembled.historyTokens,
        outputReserveTokens: CHAT_TOKEN_BUDGET.outputReserveTokens,
        includedHistoryMessageIds: includedHistoryIds,
        exclusions: frozen.exclusions
      });
      const frozenByHandle = new Map(
        frozen.sources.map((source) => [source.candidate.sourceHandle, source])
      );
      await transaction.insert(contextSourceSnapshots).values(
        assembled.snapshots.map((snapshot) => {
          const source = frozenByHandle.get(snapshot.sourceHandle)!;
          return {
            id: snapshot.snapshotId,
            workspaceId: scope.workspaceId,
            boardId,
            manifestId,
            runId,
            nodeId: source.nodeId,
            nodeRevision: source.nodeRevision,
            sourceHandle: snapshot.sourceHandle,
            title: source.title,
            sourceKind: source.sourceKind,
            exactText: snapshot.exactText,
            contentHash: snapshot.contentHash,
            artifactId: source.artifactId,
            artifactVersion: source.artifactVersion,
            segmentIds: source.artifactId
              ? [...(assembled.selectedFragmentIds.get(snapshot.sourceHandle) ?? [])]
              : [],
            truncated: assembled.truncatedSourceHandles.includes(snapshot.sourceHandle)
          };
        })
      );
      await transaction.insert(providerAttempts).values({
        workspaceId: scope.workspaceId,
        boardId,
        runId,
        idempotencyKey: runId,
        providerName: provider.name,
        model: provider.model
      });
      return {
        run: toRun(runRows[0]!, frozen.exclusions, assembled.snapshots.length),
        chatId: chat.id,
        userMessageId
      };
    });
  } catch (error) {
    if (
      databaseConstraint(error) === "chat_run_one_active_per_workspace_unique" ||
      databaseConstraint(error) === "chat_run_one_active_per_chat_unique"
    ) {
      throw new ChatRunActiveError();
    }
    throw error;
  }
}

export async function getChatThread(
  database: SiftloomDatabase,
  scope: WorkspaceScope,
  boardId: string,
  chatNodeId: string
): Promise<ChatThread> {
  return withTenantTransaction(database, scope, async (transaction) => {
    const node = await transaction
      .select({ id: nodes.id })
      .from(nodes)
      .where(
        and(
          eq(nodes.workspaceId, scope.workspaceId),
          eq(nodes.boardId, boardId),
          eq(nodes.id, chatNodeId),
          eq(nodes.kind, "chat"),
          isNull(nodes.deletedAt)
        )
      )
      .limit(1);
    if (!node[0]) throw new ChatNotFoundError();
    const chat = await transaction
      .select()
      .from(chats)
      .where(
        and(
          eq(chats.workspaceId, scope.workspaceId),
          eq(chats.boardId, boardId),
          eq(chats.nodeId, chatNodeId)
        )
      )
      .limit(1);
    if (!chat[0])
      return chatThreadSchema.parse({
        chatId: null,
        nodeId: chatNodeId,
        messages: [],
        activeRun: null,
        latestRun: null
      });
    const [messageRows, runRows] = await Promise.all([
      transaction
        .select()
        .from(chatMessages)
        .where(eq(chatMessages.chatId, chat[0].id))
        .orderBy(asc(chatMessages.sequence)),
      transaction
        .select()
        .from(chatRuns)
        .where(eq(chatRuns.chatId, chat[0].id))
        .orderBy(desc(chatRuns.createdAt))
        .limit(20)
    ]);
    const messageIds = messageRows.map((message) => message.id);
    const sourceRows =
      messageIds.length === 0
        ? []
        : await transaction
            .select({
              messageId: chatMessageSources.messageId,
              handle: chatMessageSources.sourceHandle,
              snapshotId: contextSourceSnapshots.id,
              nodeId: contextSourceSnapshots.nodeId,
              nodeRevision: contextSourceSnapshots.nodeRevision,
              title: contextSourceSnapshots.title,
              currentRevision: nodes.revision,
              deletedAt: nodes.deletedAt
            })
            .from(chatMessageSources)
            .innerJoin(
              contextSourceSnapshots,
              eq(chatMessageSources.snapshotId, contextSourceSnapshots.id)
            )
            .leftJoin(nodes, eq(contextSourceSnapshots.nodeId, nodes.id))
            .where(inArray(chatMessageSources.messageId, messageIds))
            .orderBy(asc(chatMessageSources.ordinal));
    const citationsByMessage = new Map<string, typeof sourceRows>();
    for (const source of sourceRows) {
      const values = citationsByMessage.get(source.messageId) ?? [];
      values.push(source);
      citationsByMessage.set(source.messageId, values);
    }
    const manifestRows =
      runRows.length === 0
        ? []
        : await transaction
            .select()
            .from(contextManifests)
            .where(
              inArray(
                contextManifests.runId,
                runRows.map((run) => run.id)
              )
            );
    const manifestByRun = new Map(
      manifestRows.map((manifest) => [manifest.runId, manifest])
    );
    const countRows =
      runRows.length === 0
        ? []
        : await transaction
            .select({
              runId: contextSourceSnapshots.runId,
              count: sql<number>`count(*)::int`
            })
            .from(contextSourceSnapshots)
            .where(
              inArray(
                contextSourceSnapshots.runId,
                runRows.map((run) => run.id)
              )
            )
            .groupBy(contextSourceSnapshots.runId);
    const counts = new Map(countRows.map((row) => [row.runId, row.count]));
    const parsedRuns = runRows.map((run) =>
      toRun(run, manifestByRun.get(run.id)?.exclusions ?? [], counts.get(run.id) ?? 0)
    );
    return chatThreadSchema.parse({
      chatId: chat[0].id,
      nodeId: chatNodeId,
      messages: messageRows.map((message) => ({
        id: message.id,
        role: message.role,
        content: message.content,
        sequence: message.sequence,
        runId: message.runId,
        citations: (citationsByMessage.get(message.id) ?? []).map((source) => ({
          handle: source.handle,
          snapshotId: source.snapshotId,
          nodeId: source.nodeId,
          nodeRevision: source.nodeRevision,
          title: source.title,
          sourceChanged:
            source.deletedAt !== null || source.currentRevision !== source.nodeRevision
        })),
        createdAt: message.createdAt.toISOString()
      })),
      activeRun:
        parsedRuns.find((run) => run.status === "queued" || run.status === "running") ??
        null,
      latestRun: parsedRuns[0] ?? null
    });
  });
}

export async function claimChatRun(
  database: SiftloomDatabase,
  scope: WorkspaceScope,
  boardId: string,
  runId: string
): Promise<ClaimedChatRun | null> {
  return withTenantTransaction(database, scope, async (transaction) => {
    const now = new Date();
    const claimed = await transaction
      .update(chatRuns)
      .set({ status: "running", startedAt: now, updatedAt: now })
      .where(
        and(
          eq(chatRuns.workspaceId, scope.workspaceId),
          eq(chatRuns.boardId, boardId),
          eq(chatRuns.id, runId),
          eq(chatRuns.status, "queued"),
          isNull(chatRuns.cancellationRequestedAt)
        )
      )
      .returning();
    if (!claimed[0]) return null;
    const attempts = await transaction
      .update(providerAttempts)
      .set({ status: "running", startedAt: now })
      .where(and(eq(providerAttempts.runId, runId), eq(providerAttempts.status, "pending")))
      .returning();
    if (!attempts[0]) throw new ChatRunStateError();
    await appendEvent(transaction, claimed[0], "started", {});
    const [userMessages, snapshots, manifests] = await Promise.all([
      transaction
        .select()
        .from(chatMessages)
        .where(and(eq(chatMessages.runId, runId), eq(chatMessages.role, "user")))
        .limit(1),
      transaction
        .select()
        .from(contextSourceSnapshots)
        .where(eq(contextSourceSnapshots.runId, runId))
        .orderBy(asc(contextSourceSnapshots.sourceHandle)),
      transaction
        .select()
        .from(contextManifests)
        .where(eq(contextManifests.runId, runId))
        .limit(1)
    ]);
    const historyIds = manifests[0]?.includedHistoryMessageIds ?? [];
    const historyRows =
      historyIds.length === 0
        ? []
        : await transaction
            .select()
            .from(chatMessages)
            .where(inArray(chatMessages.id, historyIds))
            .orderBy(asc(chatMessages.sequence));
    return {
      runId,
      attemptId: attempts[0].id,
      providerName: claimed[0].providerName,
      model: claimed[0].model,
      prompt: userMessages[0]?.content ?? "",
      context: snapshots.map((snapshot) => ({
        snapshotId: snapshot.id,
        sourceHandle: snapshot.sourceHandle,
        title: snapshot.title,
        exactText: snapshot.exactText,
        contentHash: snapshot.contentHash
      })),
      history: historyRows.map((message) => ({
        role: message.role,
        content: message.content
      }))
    };
  });
}

async function appendEvent(
  transaction: TenantTransaction,
  run: typeof chatRuns.$inferSelect,
  type: ChatStreamEvent["type"],
  data: Record<string, unknown>,
  delta = ""
): Promise<ChatStreamEvent> {
  const sequence = run.streamSequence + 1;
  await transaction.insert(chatRunEvents).values({
    workspaceId: run.workspaceId,
    boardId: run.boardId,
    runId: run.id,
    sequence,
    type,
    data
  });
  await transaction
    .update(chatRuns)
    .set({
      streamSequence: sequence,
      ...(delta ? { streamedText: sql`${chatRuns.streamedText} || ${delta}` } : {}),
      updatedAt: new Date()
    })
    .where(eq(chatRuns.id, run.id));
  run.streamSequence = sequence;
  if (delta) run.streamedText += delta;
  return { sequence, type, data } as ChatStreamEvent;
}

export async function appendChatDelta(
  database: SiftloomDatabase,
  scope: WorkspaceScope,
  boardId: string,
  runId: string,
  delta: string,
  providerRequestId?: string
): Promise<ChatStreamEvent> {
  return withTenantTransaction(database, scope, async (transaction) => {
    const run = await transaction
      .select()
      .from(chatRuns)
      .where(
        and(
          eq(chatRuns.workspaceId, scope.workspaceId),
          eq(chatRuns.boardId, boardId),
          eq(chatRuns.id, runId),
          eq(chatRuns.status, "running")
        )
      )
      .limit(1);
    if (!run[0]) throw new ChatRunStateError();
    if (providerRequestId) {
      await transaction
        .update(providerAttempts)
        .set({ providerRequestId })
        .where(eq(providerAttempts.runId, runId));
    }
    return appendEvent(transaction, run[0], "delta", { text: delta }, delta);
  });
}

export async function recordChatProviderRequest(
  database: SiftloomDatabase,
  scope: WorkspaceScope,
  boardId: string,
  runId: string,
  providerRequestId: string
): Promise<void> {
  await withTenantTransaction(database, scope, async (transaction) => {
    const changed = await transaction
      .update(providerAttempts)
      .set({ providerRequestId })
      .where(
        and(
          eq(providerAttempts.workspaceId, scope.workspaceId),
          eq(providerAttempts.boardId, boardId),
          eq(providerAttempts.runId, runId),
          eq(providerAttempts.status, "running")
        )
      )
      .returning({ id: providerAttempts.id });
    if (!changed[0]) throw new ChatRunStateError();
  });
}

export async function finalizeChatRun(
  database: SiftloomDatabase,
  scope: WorkspaceScope,
  boardId: string,
  runId: string,
  usage: { inputTokens: number; cachedInputTokens: number; outputTokens: number },
  citedHandles: readonly string[],
  citationsValid: boolean
): Promise<void> {
  await withTenantTransaction(database, scope, async (transaction) => {
    const runs = await transaction
      .select()
      .from(chatRuns)
      .where(
        and(
          eq(chatRuns.workspaceId, scope.workspaceId),
          eq(chatRuns.boardId, boardId),
          eq(chatRuns.id, runId),
          eq(chatRuns.status, "running")
        )
      )
      .limit(1);
    const run = runs[0];
    if (!run) return;
    const attempt = await transaction
      .select()
      .from(providerAttempts)
      .where(eq(providerAttempts.runId, runId))
      .limit(1);
    if (!attempt[0]) throw new ChatRunStateError();
    const now = new Date();
    await transaction
      .update(providerAttempts)
      .set({ status: "succeeded", ...usage, finishedAt: now })
      .where(eq(providerAttempts.id, attempt[0].id));
    await transaction
      .insert(usageEvents)
      .values({
        workspaceId: scope.workspaceId,
        boardId,
        runId,
        providerAttemptId: attempt[0].id,
        idempotencyKey: `chat:${runId}:provider-usage`,
        ...usage
      })
      .onConflictDoNothing();
    if (!citationsValid) {
      await transaction
        .update(chatRuns)
        .set({
          status: "failed",
          errorCode: "citation_validation_failed",
          errorMessage: "回答未包含有效来源引用。",
          retryable: true,
          finishedAt: now,
          updatedAt: now
        })
        .where(eq(chatRuns.id, runId));
      await appendEvent(transaction, run, "failed", {
        errorCode: "citation_validation_failed",
        retryable: true
      });
      return;
    }
    const chat = await transaction
      .select()
      .from(chats)
      .where(eq(chats.id, run.chatId))
      .limit(1);
    if (!chat[0]) throw new ChatRunStateError();
    const messageRows = await transaction
      .insert(chatMessages)
      .values({
        workspaceId: scope.workspaceId,
        boardId,
        chatId: run.chatId,
        runId,
        role: "assistant",
        sequence: chat[0].nextMessageSequence,
        content: run.streamedText
      })
      .onConflictDoNothing()
      .returning({ id: chatMessages.id });
    const messageId = messageRows[0]?.id;
    if (!messageId) return;
    const snapshots = await transaction
      .select()
      .from(contextSourceSnapshots)
      .where(
        and(
          eq(contextSourceSnapshots.runId, runId),
          inArray(contextSourceSnapshots.sourceHandle, [...citedHandles])
        )
      )
      .orderBy(asc(contextSourceSnapshots.sourceHandle));
    if (snapshots.length > 0) {
      await transaction.insert(chatMessageSources).values(
        snapshots.map((snapshot, ordinal) => ({
          workspaceId: scope.workspaceId,
          boardId,
          messageId,
          snapshotId: snapshot.id,
          sourceHandle: snapshot.sourceHandle,
          ordinal
        }))
      );
    }
    await transaction
      .update(chats)
      .set({ nextMessageSequence: chat[0].nextMessageSequence + 1, updatedAt: now })
      .where(eq(chats.id, run.chatId));
    await transaction
      .update(chatRuns)
      .set({ status: "completed", finishedAt: now, updatedAt: now })
      .where(eq(chatRuns.id, runId));
    await appendEvent(transaction, run, "completed", { messageId });
  });
}

export async function failChatRun(
  database: SiftloomDatabase,
  scope: WorkspaceScope,
  boardId: string,
  runId: string,
  outcome: "failed" | "cancelled" | "reconciliation_required",
  code: string,
  message: string,
  retryable: boolean
): Promise<void> {
  await withTenantTransaction(database, scope, async (transaction) => {
    const rows = await transaction
      .select()
      .from(chatRuns)
      .where(
        and(
          eq(chatRuns.workspaceId, scope.workspaceId),
          eq(chatRuns.boardId, boardId),
          eq(chatRuns.id, runId),
          inArray(chatRuns.status, ["queued", "running"])
        )
      )
      .limit(1);
    const run = rows[0];
    if (!run) return;
    const now = new Date();
    const attemptStatus =
      outcome === "reconciliation_required"
        ? "indeterminate"
        : outcome === "cancelled"
          ? "cancelled"
          : "failed";
    await transaction
      .update(providerAttempts)
      .set({ status: attemptStatus, finishedAt: now })
      .where(eq(providerAttempts.runId, runId));
    await transaction
      .update(chatRuns)
      .set({
        status: outcome,
        errorCode: code,
        errorMessage: message,
        retryable,
        finishedAt: now,
        updatedAt: now
      })
      .where(eq(chatRuns.id, runId));
    await appendEvent(transaction, run, outcome, { errorCode: code, retryable });
  });
}

export async function requestChatCancellation(
  database: SiftloomDatabase,
  scope: WorkspaceScope,
  boardId: string,
  runId: string
): Promise<boolean> {
  return withTenantTransaction(database, scope, async (transaction) => {
    const now = new Date();
    const rows = await transaction
      .update(chatRuns)
      .set({ cancellationRequestedAt: now, updatedAt: now })
      .where(
        and(
          eq(chatRuns.workspaceId, scope.workspaceId),
          eq(chatRuns.boardId, boardId),
          eq(chatRuns.id, runId),
          inArray(chatRuns.status, ["queued", "running"])
        )
      )
      .returning({ status: chatRuns.status });
    if (!rows[0]) return false;
    if (rows[0].status === "queued") {
      const run = await transaction
        .select()
        .from(chatRuns)
        .where(eq(chatRuns.id, runId))
        .limit(1);
      if (run[0]) {
        const finishedAt = new Date();
        await transaction
          .update(chatRuns)
          .set({
            status: "cancelled",
            errorCode: "cancelled",
            errorMessage: "生成已取消。",
            finishedAt,
            updatedAt: finishedAt
          })
          .where(eq(chatRuns.id, runId));
        await transaction
          .update(providerAttempts)
          .set({ status: "cancelled", finishedAt })
          .where(eq(providerAttempts.runId, runId));
        await appendEvent(transaction, run[0], "cancelled", {
          errorCode: "cancelled",
          retryable: true
        });
      }
    }
    return true;
  });
}

export async function authorizeChatRunNode(
  database: SiftloomDatabase,
  scope: WorkspaceScope,
  boardId: string,
  chatNodeId: string,
  runId: string
): Promise<void> {
  await withTenantTransaction(database, scope, async (transaction) => {
    const rows = await transaction
      .select({ id: chatRuns.id })
      .from(chatRuns)
      .innerJoin(chats, eq(chatRuns.chatId, chats.id))
      .where(
        and(
          eq(chatRuns.workspaceId, scope.workspaceId),
          eq(chatRuns.boardId, boardId),
          eq(chatRuns.id, runId),
          eq(chats.nodeId, chatNodeId)
        )
      )
      .limit(1);
    if (!rows[0]) throw new ChatNotFoundError();
  });
}

export async function listChatRunEvents(
  database: SiftloomDatabase,
  scope: WorkspaceScope,
  boardId: string,
  runId: string,
  afterSequence: number
): Promise<{ events: ChatStreamEvent[]; status: ChatRun["status"]; streamedText: string }> {
  return withTenantTransaction(database, scope, async (transaction) => {
    const run = await transaction
      .select()
      .from(chatRuns)
      .where(
        and(
          eq(chatRuns.workspaceId, scope.workspaceId),
          eq(chatRuns.boardId, boardId),
          eq(chatRuns.id, runId)
        )
      )
      .limit(1);
    if (!run[0]) throw new ChatNotFoundError();
    const rows = await transaction
      .select()
      .from(chatRunEvents)
      .where(
        and(
          eq(chatRunEvents.runId, runId),
          sql`${chatRunEvents.sequence} > ${afterSequence}`
        )
      )
      .orderBy(asc(chatRunEvents.sequence))
      .limit(200);
    return {
      events: rows.map(
        (row) =>
          ({ sequence: row.sequence, type: row.type, data: row.data }) as ChatStreamEvent
      ),
      status: run[0].status,
      streamedText: run[0].streamedText
    };
  });
}

export async function getChatSourceSnapshot(
  database: SiftloomDatabase,
  scope: WorkspaceScope,
  boardId: string,
  chatNodeId: string,
  snapshotId: string
): Promise<ChatSourceSnapshot> {
  return withTenantTransaction(database, scope, async (transaction) => {
    const rows = await transaction
      .select({
        snapshot: contextSourceSnapshots,
        currentRevision: nodes.revision,
        deletedAt: nodes.deletedAt
      })
      .from(contextSourceSnapshots)
      .innerJoin(chatRuns, eq(contextSourceSnapshots.runId, chatRuns.id))
      .innerJoin(chats, eq(chatRuns.chatId, chats.id))
      .leftJoin(nodes, eq(contextSourceSnapshots.nodeId, nodes.id))
      .where(
        and(
          eq(contextSourceSnapshots.workspaceId, scope.workspaceId),
          eq(contextSourceSnapshots.boardId, boardId),
          eq(contextSourceSnapshots.id, snapshotId),
          eq(chats.nodeId, chatNodeId)
        )
      )
      .limit(1);
    const row = rows[0];
    if (!row) throw new ChatNotFoundError();
    return chatSourceSnapshotSchema.parse({
      id: row.snapshot.id,
      handle: row.snapshot.sourceHandle,
      nodeId: row.snapshot.nodeId,
      nodeRevision: row.snapshot.nodeRevision,
      title: row.snapshot.title,
      exactText: row.snapshot.exactText,
      contentHash: row.snapshot.contentHash,
      artifactId: row.snapshot.artifactId,
      artifactVersion: row.snapshot.artifactVersion,
      segmentIds: row.snapshot.segmentIds,
      truncated: row.snapshot.truncated,
      sourceChanged:
        row.deletedAt !== null || row.currentRevision !== row.snapshot.nodeRevision
    });
  });
}
