import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid
} from "drizzle-orm/pg-core";

export const membershipRole = pgEnum("membership_role", ["owner", "member"]);
export const membershipStatus = pgEnum("membership_status", ["active", "suspended"]);
export const canvasNodeKind = pgEnum("canvas_node_kind", [
  "note",
  "text",
  "pdf",
  "webpage",
  "video",
  "chat",
  "group"
]);
export const assetSourceType = pgEnum("asset_source_type", [
  "upload",
  "webpage",
  "youtube"
]);
export const assetStatus = pgEnum("asset_status", [
  "pending",
  "verified",
  "ready",
  "failed",
  "quarantined"
]);
export const ingestionJobStatus = pgEnum("ingestion_job_status", [
  "queued",
  "running",
  "succeeded",
  "failed",
  "cancelled"
]);
export const ingestionAttemptStatus = pgEnum("ingestion_attempt_status", [
  "queued",
  "running",
  "succeeded",
  "failed",
  "cancelled"
]);
export const ingestionAttemptStage = pgEnum("ingestion_attempt_stage", [
  "validating",
  "fetching",
  "extracting",
  "transcribing",
  "normalizing",
  "storing"
]);
export const chatRunStatus = pgEnum("chat_run_status", [
  "queued",
  "running",
  "completed",
  "cancelled",
  "failed",
  "reconciliation_required"
]);
export const chatMessageRole = pgEnum("chat_message_role", ["user", "assistant"]);
export const providerAttemptStatus = pgEnum("provider_attempt_status", [
  "pending",
  "running",
  "succeeded",
  "failed",
  "indeterminate",
  "cancelled"
]);
export const operationalEventKind = pgEnum("operational_event_kind", [
  "canvas_save_failed",
  "canvas_save_conflict"
]);

export const authUsers = pgTable(
  "user",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    emailVerified: boolean("email_verified").notNull().default(false),
    image: text("image"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [uniqueIndex("user_email_unique").on(table.email)]
);

export const authSessions = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    token: text("token").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" })
  },
  (table) => [
    uniqueIndex("session_token_unique").on(table.token),
    index("session_user_idx").on(table.userId)
  ]
);

export const authAccounts = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    index("account_user_idx").on(table.userId),
    uniqueIndex("account_provider_account_unique").on(table.providerId, table.accountId)
  ]
);

export const authVerifications = pgTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [index("verification_identifier_idx").on(table.identifier)]
);

export const workspaces = pgTable(
  "workspace",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    personalOwnerUserId: text("personal_owner_user_id").references(() => authUsers.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    uniqueIndex("workspace_personal_owner_unique").on(table.personalOwnerUserId),
    check("workspace_name_length", sql`char_length(btrim(${table.name})) BETWEEN 1 AND 120`)
  ]
);

export const workspaceMemberships = pgTable(
  "workspace_membership",
  {
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    role: membershipRole("role").notNull().default("member"),
    status: membershipStatus("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.userId] }),
    index("workspace_membership_user_idx").on(table.userId)
  ]
);

export const boards = pgTable(
  "board",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    createMutationId: uuid("create_mutation_id"),
    revision: bigint("revision", { mode: "number" }).notNull().default(0),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    uniqueIndex("board_workspace_id_unique").on(table.workspaceId, table.id),
    uniqueIndex("board_workspace_create_mutation_unique").on(
      table.workspaceId,
      table.createMutationId
    ),
    index("board_workspace_updated_idx").on(table.workspaceId, table.updatedAt),
    check("board_name_length", sql`char_length(btrim(${table.name})) BETWEEN 1 AND 120`),
    check("board_revision_nonnegative", sql`${table.revision} >= 0`)
  ]
);

export const nodes = pgTable(
  "node",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull(),
    boardId: uuid("board_id").notNull(),
    parentNodeId: uuid("parent_node_id"),
    kind: canvasNodeKind("kind").notNull(),
    x: real("x").notNull(),
    y: real("y").notNull(),
    width: real("width").notNull(),
    height: real("height").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    revision: bigint("revision", { mode: "number" }).notNull().default(0),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    uniqueIndex("node_workspace_board_id_unique").on(
      table.workspaceId,
      table.boardId,
      table.id
    ),
    index("node_workspace_board_idx").on(table.workspaceId, table.boardId),
    foreignKey({
      columns: [table.workspaceId, table.boardId],
      foreignColumns: [boards.workspaceId, boards.id],
      name: "node_board_scope_fk"
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.workspaceId, table.boardId, table.parentNodeId],
      foreignColumns: [table.workspaceId, table.boardId, table.id],
      name: "node_parent_scope_fk"
    }).onDelete("cascade"),
    check("node_revision_nonnegative", sql`${table.revision} >= 0`),
    check(
      "node_geometry_finite_bounds",
      sql`
      ${table.x} BETWEEN -1000000 AND 1000000 AND
      ${table.y} BETWEEN -1000000 AND 1000000 AND
      ${table.width} BETWEEN 80 AND 4000 AND
      ${table.height} BETWEEN 60 AND 4000
    `
    )
  ]
);

export const edges = pgTable(
  "edge",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull(),
    boardId: uuid("board_id").notNull(),
    sourceNodeId: uuid("source_node_id").notNull(),
    targetNodeId: uuid("target_node_id").notNull(),
    rank: bigint("rank", { mode: "number" }).notNull().default(0),
    revision: bigint("revision", { mode: "number" }).notNull().default(0),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    uniqueIndex("edge_workspace_board_id_unique").on(
      table.workspaceId,
      table.boardId,
      table.id
    ),
    index("edge_workspace_board_idx").on(table.workspaceId, table.boardId),
    foreignKey({
      columns: [table.workspaceId, table.boardId],
      foreignColumns: [boards.workspaceId, boards.id],
      name: "edge_board_scope_fk"
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.workspaceId, table.boardId, table.sourceNodeId],
      foreignColumns: [nodes.workspaceId, nodes.boardId, nodes.id],
      name: "edge_source_scope_fk"
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.workspaceId, table.boardId, table.targetNodeId],
      foreignColumns: [nodes.workspaceId, nodes.boardId, nodes.id],
      name: "edge_target_scope_fk"
    }).onDelete("cascade"),
    check("edge_not_self", sql`${table.sourceNodeId} <> ${table.targetNodeId}`),
    check("edge_revision_nonnegative", sql`${table.revision} >= 0`)
  ]
);

export const mutationReceipts = pgTable(
  "mutation_receipt",
  {
    workspaceId: uuid("workspace_id").notNull(),
    boardId: uuid("board_id").notNull(),
    mutationId: uuid("mutation_id").notNull(),
    baseRevision: bigint("base_revision", { mode: "number" }).notNull(),
    resultRevision: bigint("result_revision", { mode: "number" }).notNull(),
    responsePayload: jsonb("response_payload").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.boardId, table.mutationId] }),
    foreignKey({
      columns: [table.workspaceId, table.boardId],
      foreignColumns: [boards.workspaceId, boards.id],
      name: "mutation_receipt_board_scope_fk"
    }).onDelete("cascade"),
    check("mutation_revision_order", sql`${table.resultRevision} >= ${table.baseRevision}`)
  ]
);

export const assets = pgTable(
  "asset",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull(),
    boardId: uuid("board_id").notNull(),
    sourceType: assetSourceType("source_type").notNull(),
    status: assetStatus("status").notNull().default("pending"),
    objectKey: text("object_key"),
    originalFileName: text("original_file_name"),
    sourceUrl: text("source_url"),
    declaredMime: text("declared_mime"),
    detectedMime: text("detected_mime"),
    declaredSize: bigint("declared_size", { mode: "number" }),
    actualSize: bigint("actual_size", { mode: "number" }),
    contentHash: text("content_hash"),
    uploadMutationId: uuid("upload_mutation_id"),
    completionMutationId: uuid("completion_mutation_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    uniqueIndex("asset_workspace_board_id_unique").on(
      table.workspaceId,
      table.boardId,
      table.id
    ),
    uniqueIndex("asset_workspace_upload_mutation_unique")
      .on(table.workspaceId, table.uploadMutationId)
      .where(sql`${table.uploadMutationId} is not null`),
    uniqueIndex("asset_workspace_object_key_unique")
      .on(table.workspaceId, table.objectKey)
      .where(sql`${table.objectKey} is not null`),
    index("asset_workspace_board_created_idx").on(
      table.workspaceId,
      table.boardId,
      table.createdAt
    ),
    foreignKey({
      columns: [table.workspaceId, table.boardId],
      foreignColumns: [boards.workspaceId, boards.id],
      name: "asset_board_scope_fk"
    }).onDelete("cascade"),
    check(
      "asset_source_locator_present",
      sql`(${table.sourceType} = 'upload' AND ${table.objectKey} IS NOT NULL AND ${table.sourceUrl} IS NULL)
        OR (${table.sourceType} IN ('webpage', 'youtube') AND ${table.sourceUrl} IS NOT NULL AND ${table.objectKey} IS NULL)`
    ),
    check(
      "asset_size_nonnegative",
      sql`${table.declaredSize} IS NULL OR ${table.declaredSize} > 0`
    ),
    check(
      "asset_actual_size_nonnegative",
      sql`${table.actualSize} IS NULL OR ${table.actualSize} > 0`
    )
  ]
);

export const ingestionJobs = pgTable(
  "ingestion_job",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull(),
    boardId: uuid("board_id").notNull(),
    nodeId: uuid("node_id").notNull(),
    assetId: uuid("asset_id").notNull(),
    submissionMutationId: uuid("submission_mutation_id").notNull(),
    retryOfJobId: uuid("retry_of_job_id"),
    status: ingestionJobStatus("status").notNull().default("queued"),
    warningCodes: jsonb("warning_codes").$type<string[]>().notNull().default([]),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    retryable: boolean("retryable").notNull().default(false),
    revision: bigint("revision", { mode: "number" }).notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true })
  },
  (table) => [
    uniqueIndex("ingestion_job_workspace_board_id_unique").on(
      table.workspaceId,
      table.boardId,
      table.id
    ),
    uniqueIndex("ingestion_job_workspace_submission_unique").on(
      table.workspaceId,
      table.submissionMutationId
    ),
    index("ingestion_job_workspace_board_updated_idx").on(
      table.workspaceId,
      table.boardId,
      table.updatedAt
    ),
    index("ingestion_job_asset_idx").on(table.workspaceId, table.assetId),
    foreignKey({
      columns: [table.workspaceId, table.boardId],
      foreignColumns: [boards.workspaceId, boards.id],
      name: "ingestion_job_board_scope_fk"
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.workspaceId, table.boardId, table.nodeId],
      foreignColumns: [nodes.workspaceId, nodes.boardId, nodes.id],
      name: "ingestion_job_node_scope_fk"
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.workspaceId, table.boardId, table.assetId],
      foreignColumns: [assets.workspaceId, assets.boardId, assets.id],
      name: "ingestion_job_asset_scope_fk"
    }).onDelete("cascade"),
    check("ingestion_job_revision_nonnegative", sql`${table.revision} >= 0`),
    check(
      "ingestion_job_terminal_finished",
      sql`${table.status} NOT IN ('succeeded', 'failed', 'cancelled') OR ${table.finishedAt} IS NOT NULL`
    )
  ]
);

export const ingestionAttempts = pgTable(
  "ingestion_attempt",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull(),
    boardId: uuid("board_id").notNull(),
    jobId: uuid("job_id").notNull(),
    attemptNumber: integer("attempt_number").notNull(),
    status: ingestionAttemptStatus("status").notNull().default("queued"),
    stage: ingestionAttemptStage("stage").notNull().default("validating"),
    progress: integer("progress").notNull().default(0),
    leaseToken: uuid("lease_token").notNull(),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    retryable: boolean("retryable").notNull().default(false),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    uniqueIndex("ingestion_attempt_workspace_job_number_unique").on(
      table.workspaceId,
      table.jobId,
      table.attemptNumber
    ),
    uniqueIndex("ingestion_attempt_workspace_board_id_unique").on(
      table.workspaceId,
      table.boardId,
      table.id
    ),
    index("ingestion_attempt_job_created_idx").on(table.jobId, table.createdAt),
    foreignKey({
      columns: [table.workspaceId, table.boardId, table.jobId],
      foreignColumns: [ingestionJobs.workspaceId, ingestionJobs.boardId, ingestionJobs.id],
      name: "ingestion_attempt_job_scope_fk"
    }).onDelete("cascade"),
    check("ingestion_attempt_number_positive", sql`${table.attemptNumber} > 0`),
    check("ingestion_attempt_progress_bounds", sql`${table.progress} BETWEEN 0 AND 100`),
    check(
      "ingestion_attempt_terminal_finished",
      sql`${table.status} NOT IN ('succeeded', 'failed', 'cancelled') OR ${table.finishedAt} IS NOT NULL`
    )
  ]
);

export const extractionArtifacts = pgTable(
  "extraction_artifact",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull(),
    boardId: uuid("board_id").notNull(),
    assetId: uuid("asset_id").notNull(),
    jobId: uuid("job_id").notNull(),
    attemptId: uuid("attempt_id").notNull(),
    version: integer("version").notNull().default(1),
    title: text("title"),
    sourceMime: text("source_mime").notNull(),
    contentHash: text("content_hash").notNull(),
    extractorVersion: text("extractor_version").notNull(),
    extractedCharacters: integer("extracted_characters").notNull(),
    warningCodes: jsonb("warning_codes").$type<string[]>().notNull().default([]),
    provenance: jsonb("provenance").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    uniqueIndex("extraction_artifact_workspace_board_id_unique").on(
      table.workspaceId,
      table.boardId,
      table.id
    ),
    uniqueIndex("extraction_artifact_asset_version_unique").on(
      table.workspaceId,
      table.assetId,
      table.version
    ),
    uniqueIndex("extraction_artifact_attempt_unique").on(table.attemptId),
    foreignKey({
      columns: [table.workspaceId, table.boardId, table.assetId],
      foreignColumns: [assets.workspaceId, assets.boardId, assets.id],
      name: "extraction_artifact_asset_scope_fk"
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.workspaceId, table.boardId, table.jobId],
      foreignColumns: [ingestionJobs.workspaceId, ingestionJobs.boardId, ingestionJobs.id],
      name: "extraction_artifact_job_scope_fk"
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.workspaceId, table.boardId, table.attemptId],
      foreignColumns: [
        ingestionAttempts.workspaceId,
        ingestionAttempts.boardId,
        ingestionAttempts.id
      ],
      name: "extraction_artifact_attempt_scope_fk"
    }).onDelete("cascade"),
    check("extraction_artifact_version_positive", sql`${table.version} > 0`),
    check(
      "extraction_artifact_characters_nonnegative",
      sql`${table.extractedCharacters} >= 0`
    )
  ]
);

export const extractionSegments = pgTable(
  "extraction_segment",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull(),
    boardId: uuid("board_id").notNull(),
    artifactId: uuid("artifact_id").notNull(),
    ordinal: integer("ordinal").notNull(),
    text: text("text").notNull(),
    location: jsonb("location").$type<Record<string, unknown>>().notNull().default({}),
    contentHash: text("content_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    uniqueIndex("extraction_segment_artifact_ordinal_unique").on(
      table.artifactId,
      table.ordinal
    ),
    index("extraction_segment_workspace_artifact_idx").on(
      table.workspaceId,
      table.artifactId
    ),
    foreignKey({
      columns: [table.workspaceId, table.boardId, table.artifactId],
      foreignColumns: [
        extractionArtifacts.workspaceId,
        extractionArtifacts.boardId,
        extractionArtifacts.id
      ],
      name: "extraction_segment_artifact_scope_fk"
    }).onDelete("cascade"),
    check("extraction_segment_ordinal_nonnegative", sql`${table.ordinal} >= 0`),
    check("extraction_segment_text_not_empty", sql`char_length(${table.text}) > 0`)
  ]
);

export const chats = pgTable(
  "chat",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull(),
    boardId: uuid("board_id").notNull(),
    nodeId: uuid("node_id").notNull(),
    nextMessageSequence: bigint("next_message_sequence", { mode: "number" })
      .notNull()
      .default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    uniqueIndex("chat_workspace_board_id_unique").on(
      table.workspaceId,
      table.boardId,
      table.id
    ),
    uniqueIndex("chat_workspace_board_node_unique").on(
      table.workspaceId,
      table.boardId,
      table.nodeId
    ),
    foreignKey({
      columns: [table.workspaceId, table.boardId, table.nodeId],
      foreignColumns: [nodes.workspaceId, nodes.boardId, nodes.id],
      name: "chat_node_scope_fk"
    }).onDelete("cascade"),
    check("chat_next_sequence_nonnegative", sql`${table.nextMessageSequence} >= 0`)
  ]
);

export const chatRuns = pgTable(
  "chat_run",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull(),
    boardId: uuid("board_id").notNull(),
    chatId: uuid("chat_id").notNull(),
    mutationId: uuid("mutation_id").notNull(),
    requestHash: text("request_hash").notNull().default(""),
    retryOfRunId: uuid("retry_of_run_id"),
    status: chatRunStatus("status").notNull().default("queued"),
    providerName: text("provider_name").notNull(),
    model: text("model").notNull(),
    streamedText: text("streamed_text").notNull().default(""),
    streamSequence: bigint("stream_sequence", { mode: "number" }).notNull().default(0),
    cancellationRequestedAt: timestamp("cancellation_requested_at", {
      withTimezone: true
    }),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    retryable: boolean("retryable").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    uniqueIndex("chat_run_workspace_board_id_unique").on(
      table.workspaceId,
      table.boardId,
      table.id
    ),
    uniqueIndex("chat_run_workspace_mutation_unique").on(
      table.workspaceId,
      table.mutationId
    ),
    uniqueIndex("chat_run_one_active_per_chat_unique")
      .on(table.workspaceId, table.chatId)
      .where(sql`${table.status} IN ('queued', 'running')`),
    uniqueIndex("chat_run_one_active_per_workspace_unique")
      .on(table.workspaceId)
      .where(sql`${table.status} IN ('queued', 'running')`),
    index("chat_run_chat_created_idx").on(table.workspaceId, table.chatId, table.createdAt),
    foreignKey({
      columns: [table.workspaceId, table.boardId, table.chatId],
      foreignColumns: [chats.workspaceId, chats.boardId, chats.id],
      name: "chat_run_chat_scope_fk"
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.workspaceId, table.boardId, table.retryOfRunId],
      foreignColumns: [table.workspaceId, table.boardId, table.id],
      name: "chat_run_retry_scope_fk"
    }),
    check("chat_run_sequence_nonnegative", sql`${table.streamSequence} >= 0`),
    check(
      "chat_run_terminal_finished",
      sql`${table.status} NOT IN ('completed', 'cancelled', 'failed', 'reconciliation_required') OR ${table.finishedAt} IS NOT NULL`
    )
  ]
);

export const chatMessages = pgTable(
  "chat_message",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull(),
    boardId: uuid("board_id").notNull(),
    chatId: uuid("chat_id").notNull(),
    runId: uuid("run_id").notNull(),
    role: chatMessageRole("role").notNull(),
    sequence: bigint("sequence", { mode: "number" }).notNull(),
    content: text("content").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    uniqueIndex("chat_message_workspace_board_id_unique").on(
      table.workspaceId,
      table.boardId,
      table.id
    ),
    uniqueIndex("chat_message_chat_sequence_unique").on(
      table.workspaceId,
      table.chatId,
      table.sequence
    ),
    uniqueIndex("chat_message_assistant_run_unique")
      .on(table.runId)
      .where(sql`${table.role} = 'assistant'`),
    foreignKey({
      columns: [table.workspaceId, table.boardId, table.chatId],
      foreignColumns: [chats.workspaceId, chats.boardId, chats.id],
      name: "chat_message_chat_scope_fk"
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.workspaceId, table.boardId, table.runId],
      foreignColumns: [chatRuns.workspaceId, chatRuns.boardId, chatRuns.id],
      name: "chat_message_run_scope_fk"
    }).onDelete("cascade"),
    check("chat_message_sequence_nonnegative", sql`${table.sequence} >= 0`),
    check("chat_message_content_not_empty", sql`char_length(${table.content}) > 0`)
  ]
);

export const contextManifests = pgTable(
  "context_manifest",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull(),
    boardId: uuid("board_id").notNull(),
    runId: uuid("run_id").notNull(),
    scopeHash: text("scope_hash").notNull(),
    sourceTokens: integer("source_tokens").notNull(),
    historyTokens: integer("history_tokens").notNull(),
    outputReserveTokens: integer("output_reserve_tokens").notNull(),
    includedHistoryMessageIds: jsonb("included_history_message_ids")
      .$type<string[]>()
      .notNull()
      .default([]),
    exclusions: jsonb("exclusions")
      .$type<Array<{ nodeId: string | null; title: string; reason: string }>>()
      .notNull()
      .default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    uniqueIndex("context_manifest_workspace_board_id_unique").on(
      table.workspaceId,
      table.boardId,
      table.id
    ),
    uniqueIndex("context_manifest_run_unique").on(table.runId),
    foreignKey({
      columns: [table.workspaceId, table.boardId, table.runId],
      foreignColumns: [chatRuns.workspaceId, chatRuns.boardId, chatRuns.id],
      name: "context_manifest_run_scope_fk"
    }).onDelete("cascade"),
    check("context_manifest_source_tokens_nonnegative", sql`${table.sourceTokens} >= 0`),
    check("context_manifest_history_tokens_nonnegative", sql`${table.historyTokens} >= 0`),
    check("context_manifest_output_tokens_positive", sql`${table.outputReserveTokens} > 0`)
  ]
);

export const contextSourceSnapshots = pgTable(
  "context_source_snapshot",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull(),
    boardId: uuid("board_id").notNull(),
    manifestId: uuid("manifest_id").notNull(),
    runId: uuid("run_id").notNull(),
    nodeId: uuid("node_id").notNull(),
    nodeRevision: bigint("node_revision", { mode: "number" }).notNull(),
    sourceHandle: text("source_handle").notNull(),
    title: text("title").notNull(),
    sourceKind: canvasNodeKind("source_kind").notNull(),
    exactText: text("exact_text").notNull(),
    contentHash: text("content_hash").notNull(),
    artifactId: uuid("artifact_id"),
    artifactVersion: integer("artifact_version"),
    segmentIds: jsonb("segment_ids").$type<string[]>().notNull().default([]),
    truncated: boolean("truncated").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    uniqueIndex("context_snapshot_workspace_board_id_unique").on(
      table.workspaceId,
      table.boardId,
      table.id
    ),
    uniqueIndex("context_snapshot_run_handle_unique").on(table.runId, table.sourceHandle),
    foreignKey({
      columns: [table.workspaceId, table.boardId, table.manifestId],
      foreignColumns: [
        contextManifests.workspaceId,
        contextManifests.boardId,
        contextManifests.id
      ],
      name: "context_snapshot_manifest_scope_fk"
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.workspaceId, table.boardId, table.runId],
      foreignColumns: [chatRuns.workspaceId, chatRuns.boardId, chatRuns.id],
      name: "context_snapshot_run_scope_fk"
    }).onDelete("cascade"),
    check("context_snapshot_revision_nonnegative", sql`${table.nodeRevision} >= 0`),
    check("context_snapshot_text_not_empty", sql`char_length(${table.exactText}) > 0`),
    check("context_snapshot_handle_format", sql`${table.sourceHandle} ~ '^S[1-9][0-9]*$'`)
  ]
);

export const chatMessageSources = pgTable(
  "chat_message_source",
  {
    workspaceId: uuid("workspace_id").notNull(),
    boardId: uuid("board_id").notNull(),
    messageId: uuid("message_id").notNull(),
    snapshotId: uuid("snapshot_id").notNull(),
    sourceHandle: text("source_handle").notNull(),
    ordinal: integer("ordinal").notNull()
  },
  (table) => [
    primaryKey({ columns: [table.messageId, table.snapshotId] }),
    uniqueIndex("chat_message_source_handle_unique").on(
      table.messageId,
      table.sourceHandle
    ),
    foreignKey({
      columns: [table.workspaceId, table.boardId, table.messageId],
      foreignColumns: [chatMessages.workspaceId, chatMessages.boardId, chatMessages.id],
      name: "chat_message_source_message_scope_fk"
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.workspaceId, table.boardId, table.snapshotId],
      foreignColumns: [
        contextSourceSnapshots.workspaceId,
        contextSourceSnapshots.boardId,
        contextSourceSnapshots.id
      ],
      name: "chat_message_source_snapshot_scope_fk"
    }).onDelete("cascade"),
    check("chat_message_source_ordinal_nonnegative", sql`${table.ordinal} >= 0`)
  ]
);

export const providerAttempts = pgTable(
  "provider_attempt",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull(),
    boardId: uuid("board_id").notNull(),
    runId: uuid("run_id").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    providerName: text("provider_name").notNull(),
    model: text("model").notNull(),
    status: providerAttemptStatus("status").notNull().default("pending"),
    providerRequestId: text("provider_request_id"),
    inputTokens: integer("input_tokens"),
    cachedInputTokens: integer("cached_input_tokens"),
    outputTokens: integer("output_tokens"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true })
  },
  (table) => [
    uniqueIndex("provider_attempt_workspace_board_id_unique").on(
      table.workspaceId,
      table.boardId,
      table.id
    ),
    uniqueIndex("provider_attempt_run_unique").on(table.runId),
    uniqueIndex("provider_attempt_idempotency_unique").on(
      table.providerName,
      table.idempotencyKey
    ),
    foreignKey({
      columns: [table.workspaceId, table.boardId, table.runId],
      foreignColumns: [chatRuns.workspaceId, chatRuns.boardId, chatRuns.id],
      name: "provider_attempt_run_scope_fk"
    }).onDelete("cascade")
  ]
);

export const usageEvents = pgTable(
  "usage_event",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull(),
    boardId: uuid("board_id").notNull(),
    runId: uuid("run_id").notNull(),
    providerAttemptId: uuid("provider_attempt_id").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    inputTokens: integer("input_tokens").notNull(),
    cachedInputTokens: integer("cached_input_tokens").notNull(),
    outputTokens: integer("output_tokens").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    uniqueIndex("usage_event_workspace_board_id_unique").on(
      table.workspaceId,
      table.boardId,
      table.id
    ),
    uniqueIndex("usage_event_idempotency_unique").on(
      table.workspaceId,
      table.idempotencyKey
    ),
    uniqueIndex("usage_event_run_unique").on(table.runId),
    foreignKey({
      columns: [table.workspaceId, table.boardId, table.runId],
      foreignColumns: [chatRuns.workspaceId, chatRuns.boardId, chatRuns.id],
      name: "usage_event_run_scope_fk"
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.workspaceId, table.boardId, table.providerAttemptId],
      foreignColumns: [
        providerAttempts.workspaceId,
        providerAttempts.boardId,
        providerAttempts.id
      ],
      name: "usage_event_attempt_scope_fk"
    }).onDelete("cascade"),
    check("usage_input_tokens_nonnegative", sql`${table.inputTokens} >= 0`),
    check("usage_cached_tokens_nonnegative", sql`${table.cachedInputTokens} >= 0`),
    check("usage_output_tokens_nonnegative", sql`${table.outputTokens} >= 0`)
  ]
);

export const chatRunEvents = pgTable(
  "chat_run_event",
  {
    workspaceId: uuid("workspace_id").notNull(),
    boardId: uuid("board_id").notNull(),
    runId: uuid("run_id").notNull(),
    sequence: bigint("sequence", { mode: "number" }).notNull(),
    type: text("type").notNull(),
    data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    primaryKey({ columns: [table.runId, table.sequence] }),
    foreignKey({
      columns: [table.workspaceId, table.boardId, table.runId],
      foreignColumns: [chatRuns.workspaceId, chatRuns.boardId, chatRuns.id],
      name: "chat_run_event_run_scope_fk"
    }).onDelete("cascade"),
    check("chat_run_event_sequence_positive", sql`${table.sequence} > 0`),
    check(
      "chat_run_event_type_valid",
      sql`${table.type} IN ('started', 'delta', 'snapshot', 'completed', 'failed', 'cancelled', 'reconciliation_required')`
    )
  ]
);

export const operationalEvents = pgTable(
  "operational_event",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull(),
    boardId: uuid("board_id"),
    kind: operationalEventKind("kind").notNull(),
    errorCode: text("error_code").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    index("operational_event_workspace_created_idx").on(table.workspaceId, table.createdAt),
    foreignKey({
      columns: [table.workspaceId, table.boardId],
      foreignColumns: [boards.workspaceId, boards.id],
      name: "operational_event_board_scope_fk"
    }).onDelete("cascade"),
    check(
      "operational_event_error_code_format",
      sql`${table.errorCode} ~ '^[A-Z][A-Z0-9_]{2,63}$'`
    )
  ]
);
