import { and, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";

import {
  UNTITLED_BOARD_NAME,
  boardListViewSchema,
  boardMutationSchema,
  createBoardCommandSchema,
  type BoardListView,
  type BoardMutation,
  type BoardSnapshot,
  type BoardSummary,
  type CreateBoardCommand,
  type WorkspaceScope
} from "@siftloom/shared";

import type { SiftloomDatabase } from "./client.js";
import { boards, edges, nodes } from "./schema.js";
import { withTenantTransaction } from "./tenant.js";

export class BoardNotFoundError extends Error {
  constructor() {
    super("Board not found");
    this.name = "BoardNotFoundError";
  }
}

type BoardRow = typeof boards.$inferSelect;

function toBoardSummary(board: BoardRow): BoardSummary {
  return {
    id: board.id,
    name: board.name,
    revision: board.revision,
    archivedAt: board.archivedAt?.toISOString() ?? null,
    createdAt: board.createdAt.toISOString(),
    updatedAt: board.updatedAt.toISOString()
  };
}

export async function listBoards(
  database: SiftloomDatabase,
  scope: WorkspaceScope,
  view: BoardListView
): Promise<readonly BoardSummary[]> {
  const parsedView = boardListViewSchema.parse(view);
  return withTenantTransaction(database, scope, async (transaction) => {
    const archivePredicate =
      parsedView === "active" ? isNull(boards.archivedAt) : isNotNull(boards.archivedAt);
    const rows = await transaction
      .select()
      .from(boards)
      .where(and(eq(boards.workspaceId, scope.workspaceId), archivePredicate))
      .orderBy(desc(boards.updatedAt), desc(boards.id));

    return rows.map(toBoardSummary);
  });
}

export async function createBoard(
  database: SiftloomDatabase,
  scope: WorkspaceScope,
  command: CreateBoardCommand
): Promise<BoardSummary> {
  const parsedCommand = createBoardCommandSchema.parse(command);
  return withTenantTransaction(database, scope, async (transaction) => {
    const inserted = await transaction
      .insert(boards)
      .values({
        workspaceId: scope.workspaceId,
        name: parsedCommand.name ?? UNTITLED_BOARD_NAME,
        createMutationId: parsedCommand.mutationId
      })
      .onConflictDoNothing({ target: [boards.workspaceId, boards.createMutationId] })
      .returning();

    const created = inserted[0];
    if (created) return toBoardSummary(created);

    const existing = await transaction
      .select()
      .from(boards)
      .where(
        and(
          eq(boards.workspaceId, scope.workspaceId),
          eq(boards.createMutationId, parsedCommand.mutationId)
        )
      )
      .limit(1);

    const duplicate = existing[0];
    if (!duplicate) throw new BoardNotFoundError();
    return toBoardSummary(duplicate);
  });
}

export async function mutateBoard(
  database: SiftloomDatabase,
  scope: WorkspaceScope,
  boardId: string,
  mutation: BoardMutation
): Promise<BoardSummary> {
  const parsedMutation = boardMutationSchema.parse(mutation);
  return withTenantTransaction(database, scope, async (transaction) => {
    const rows = await transaction
      .select()
      .from(boards)
      .where(and(eq(boards.workspaceId, scope.workspaceId), eq(boards.id, boardId)))
      .limit(1);
    const current = rows[0];
    if (!current) throw new BoardNotFoundError();

    if (
      (parsedMutation.action === "rename" && current.name === parsedMutation.name) ||
      (parsedMutation.action === "archive" && current.archivedAt !== null) ||
      (parsedMutation.action === "restore" && current.archivedAt === null)
    ) {
      return toBoardSummary(current);
    }

    const updatedAt = new Date();
    const changes =
      parsedMutation.action === "rename"
        ? { name: parsedMutation.name, updatedAt }
        : parsedMutation.action === "archive"
          ? { archivedAt: updatedAt, updatedAt }
          : { archivedAt: null, updatedAt };

    const updated = await transaction
      .update(boards)
      .set({
        ...changes,
        revision: sql`${boards.revision} + 1`
      })
      .where(and(eq(boards.workspaceId, scope.workspaceId), eq(boards.id, boardId)))
      .returning();

    const board = updated[0];
    if (!board) throw new BoardNotFoundError();
    return toBoardSummary(board);
  });
}

export async function getBoardSnapshot(
  database: SiftloomDatabase,
  scope: WorkspaceScope,
  boardId: string
): Promise<BoardSnapshot> {
  return withTenantTransaction(database, scope, async (transaction) => {
    const boardRows = await transaction
      .select()
      .from(boards)
      .where(and(eq(boards.workspaceId, scope.workspaceId), eq(boards.id, boardId)))
      .limit(1);
    const board = boardRows[0];
    if (!board) throw new BoardNotFoundError();

    const [boardNodes, boardEdges] = await Promise.all([
      transaction
        .select()
        .from(nodes)
        .where(
          and(
            eq(nodes.workspaceId, scope.workspaceId),
            eq(nodes.boardId, boardId),
            isNull(nodes.deletedAt)
          )
        ),
      transaction
        .select()
        .from(edges)
        .where(
          and(
            eq(edges.workspaceId, scope.workspaceId),
            eq(edges.boardId, boardId),
            isNull(edges.deletedAt)
          )
        )
    ]);

    return {
      ...toBoardSummary(board),
      nodes: boardNodes,
      edges: boardEdges
    };
  });
}
