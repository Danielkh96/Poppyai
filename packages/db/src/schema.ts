import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
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
