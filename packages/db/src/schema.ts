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
