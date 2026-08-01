import { sql } from "drizzle-orm";
import {
  bigint,
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

export const workspaces = pgTable("workspace", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
});

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
    revision: bigint("revision", { mode: "number" }).notNull().default(0),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    uniqueIndex("board_workspace_id_unique").on(table.workspaceId, table.id),
    index("board_workspace_updated_idx").on(table.workspaceId, table.updatedAt),
    check("board_revision_nonnegative", sql`${table.revision} >= 0`)
  ]
);

export const nodes = pgTable(
  "node",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull(),
    boardId: uuid("board_id").notNull(),
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
