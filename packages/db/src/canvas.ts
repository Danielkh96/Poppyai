import { and, asc, eq, isNull, sql } from "drizzle-orm";

import {
  canvasGraphSchema,
  canvasNodePayloadSchema,
  canvasSaveCommandSchema,
  canvasSaveResultSchema,
  canvasSnapshotSchema,
  type CanvasEdge,
  type CanvasGraph,
  type CanvasMutationOperation,
  type CanvasNode,
  type CanvasSaveCommand,
  type CanvasSaveResult,
  type CanvasSnapshot,
  type WorkspaceScope
} from "@siftloom/shared";

import { BoardNotFoundError } from "./boards.js";
import type { SiftloomDatabase } from "./client.js";
import { boards, edges, mutationReceipts, nodes } from "./schema.js";
import { withTenantTransaction, type TenantTransaction } from "./tenant.js";

export class CanvasConflictError extends Error {
  readonly latestRevision: number;
  readonly targetId: string | null;

  constructor(latestRevision: number, targetId: string | null = null) {
    super("Canvas revision conflict");
    this.name = "CanvasConflictError";
    this.latestRevision = latestRevision;
    this.targetId = targetId;
  }
}

type NodeRow = typeof nodes.$inferSelect;
type EdgeRow = typeof edges.$inferSelect;

function toCanvasNode(row: NodeRow): CanvasNode {
  return {
    id: row.id,
    kind: row.kind,
    parentId: row.parentNodeId,
    position: { x: row.x, y: row.y },
    size: { width: row.width, height: row.height },
    payload: canvasNodePayloadSchema.parse(row.payload),
    revision: row.revision
  };
}

function toCanvasEdge(row: EdgeRow): CanvasEdge {
  return {
    id: row.id,
    sourceId: row.sourceNodeId,
    targetId: row.targetNodeId,
    relation: "context",
    rank: row.rank,
    revision: row.revision
  };
}

async function readCanvasRows(
  transaction: TenantTransaction,
  scope: WorkspaceScope,
  boardId: string
): Promise<{ nodeRows: NodeRow[]; edgeRows: EdgeRow[] }> {
  const [nodeRows, edgeRows] = await Promise.all([
    transaction
      .select()
      .from(nodes)
      .where(and(eq(nodes.workspaceId, scope.workspaceId), eq(nodes.boardId, boardId)))
      .orderBy(asc(nodes.createdAt), asc(nodes.id)),
    transaction
      .select()
      .from(edges)
      .where(and(eq(edges.workspaceId, scope.workspaceId), eq(edges.boardId, boardId)))
      .orderBy(asc(edges.rank), asc(edges.createdAt), asc(edges.id))
  ]);
  return { nodeRows, edgeRows };
}

async function readCanvasSnapshot(
  transaction: TenantTransaction,
  scope: WorkspaceScope,
  boardId: string,
  boardRevision?: number
): Promise<CanvasSnapshot> {
  const boardRows =
    boardRevision === undefined
      ? await transaction
          .select({ revision: boards.revision })
          .from(boards)
          .where(and(eq(boards.workspaceId, scope.workspaceId), eq(boards.id, boardId)))
          .limit(1)
      : [{ revision: boardRevision }];
  const board = boardRows[0];
  if (!board) throw new BoardNotFoundError();
  const { nodeRows, edgeRows } = await readCanvasRows(transaction, scope, boardId);

  return canvasSnapshotSchema.parse({
    boardRevision: board.revision,
    graph: {
      nodes: nodeRows.filter((row) => row.deletedAt === null).map(toCanvasNode),
      edges: edgeRows.filter((row) => row.deletedAt === null).map(toCanvasEdge)
    },
    deleted: {
      nodes: nodeRows
        .filter((row) => row.deletedAt !== null)
        .map((row) => ({ ...toCanvasNode(row), deletedAt: row.deletedAt?.toISOString() })),
      edges: edgeRows
        .filter((row) => row.deletedAt !== null)
        .map((row) => ({ ...toCanvasEdge(row), deletedAt: row.deletedAt?.toISOString() }))
    }
  });
}

export async function getCanvasSnapshot(
  database: SiftloomDatabase,
  scope: WorkspaceScope,
  boardId: string
): Promise<CanvasSnapshot> {
  return withTenantTransaction(database, scope, (transaction) =>
    readCanvasSnapshot(transaction, scope, boardId)
  );
}

function operationTarget(operation: CanvasMutationOperation): string {
  if (operation.type === "node.upsert") return operation.node.id;
  if (operation.type === "node.delete") return operation.nodeId;
  if (operation.type === "edge.upsert") return operation.edge.id;
  return operation.edgeId;
}

function validateAndBuildFinalGraph(
  operations: readonly CanvasMutationOperation[],
  nodeRows: readonly NodeRow[],
  edgeRows: readonly EdgeRow[],
  latestBoardRevision: number
): CanvasGraph {
  const nodeRowsById = new Map(nodeRows.map((row) => [row.id, row]));
  const edgeRowsById = new Map(edgeRows.map((row) => [row.id, row]));
  const activeNodes = new Map(
    nodeRows
      .filter((row) => row.deletedAt === null)
      .map((row) => [row.id, toCanvasNode(row)])
  );
  const activeEdges = new Map(
    edgeRows
      .filter((row) => row.deletedAt === null)
      .map((row) => [row.id, toCanvasEdge(row)])
  );

  for (const operation of operations) {
    const targetId = operationTarget(operation);
    if (operation.type === "node.upsert") {
      const row = nodeRowsById.get(operation.node.id);
      if (
        (operation.expectedRevision === null && row) ||
        (operation.expectedRevision !== null &&
          (!row || row.revision !== operation.expectedRevision))
      ) {
        throw new CanvasConflictError(latestBoardRevision, targetId);
      }
      activeNodes.set(operation.node.id, {
        ...operation.node,
        revision: row ? row.revision + 1 : 0
      });
    } else if (operation.type === "node.delete") {
      const row = nodeRowsById.get(operation.nodeId);
      if (!row || row.deletedAt !== null || row.revision !== operation.expectedRevision) {
        throw new CanvasConflictError(latestBoardRevision, targetId);
      }
      activeNodes.delete(operation.nodeId);
    } else if (operation.type === "edge.upsert") {
      const row = edgeRowsById.get(operation.edge.id);
      if (
        (operation.expectedRevision === null && row) ||
        (operation.expectedRevision !== null &&
          (!row || row.revision !== operation.expectedRevision))
      ) {
        throw new CanvasConflictError(latestBoardRevision, targetId);
      }
      activeEdges.set(operation.edge.id, {
        ...operation.edge,
        revision: row ? row.revision + 1 : 0
      });
    } else {
      const row = edgeRowsById.get(operation.edgeId);
      if (!row || row.deletedAt !== null || row.revision !== operation.expectedRevision) {
        throw new CanvasConflictError(latestBoardRevision, targetId);
      }
      activeEdges.delete(operation.edgeId);
    }
  }

  return canvasGraphSchema.parse({
    nodes: [...activeNodes.values()],
    edges: [...activeEdges.values()]
  });
}

async function applyNodeDelete(
  transaction: TenantTransaction,
  scope: WorkspaceScope,
  boardId: string,
  operation: Extract<CanvasMutationOperation, { type: "node.delete" }>,
  updatedAt: Date
): Promise<void> {
  const changed = await transaction
    .update(nodes)
    .set({ deletedAt: updatedAt, updatedAt, revision: sql`${nodes.revision} + 1` })
    .where(
      and(
        eq(nodes.workspaceId, scope.workspaceId),
        eq(nodes.boardId, boardId),
        eq(nodes.id, operation.nodeId),
        eq(nodes.revision, operation.expectedRevision),
        isNull(nodes.deletedAt)
      )
    )
    .returning({ id: nodes.id });
  if (changed.length !== 1) throw new BoardNotFoundError();
}

async function applyEdgeDelete(
  transaction: TenantTransaction,
  scope: WorkspaceScope,
  boardId: string,
  operation: Extract<CanvasMutationOperation, { type: "edge.delete" }>,
  updatedAt: Date
): Promise<void> {
  const changed = await transaction
    .update(edges)
    .set({ deletedAt: updatedAt, updatedAt, revision: sql`${edges.revision} + 1` })
    .where(
      and(
        eq(edges.workspaceId, scope.workspaceId),
        eq(edges.boardId, boardId),
        eq(edges.id, operation.edgeId),
        eq(edges.revision, operation.expectedRevision),
        isNull(edges.deletedAt)
      )
    )
    .returning({ id: edges.id });
  if (changed.length !== 1) throw new BoardNotFoundError();
}

async function applyNodeUpsert(
  transaction: TenantTransaction,
  scope: WorkspaceScope,
  boardId: string,
  operation: Extract<CanvasMutationOperation, { type: "node.upsert" }>,
  updatedAt: Date
): Promise<void> {
  const node = operation.node;
  if (operation.expectedRevision === null) {
    const inserted = await transaction
      .insert(nodes)
      .values({
        id: node.id,
        workspaceId: scope.workspaceId,
        boardId,
        parentNodeId: node.parentId,
        kind: node.kind,
        x: node.position.x,
        y: node.position.y,
        width: node.size.width,
        height: node.size.height,
        payload: node.payload,
        revision: 0,
        deletedAt: null,
        updatedAt
      })
      .onConflictDoNothing()
      .returning({ id: nodes.id });
    if (inserted.length !== 1) throw new BoardNotFoundError();
    return;
  }

  const changed = await transaction
    .update(nodes)
    .set({
      parentNodeId: node.parentId,
      kind: node.kind,
      x: node.position.x,
      y: node.position.y,
      width: node.size.width,
      height: node.size.height,
      payload: node.payload,
      revision: sql`${nodes.revision} + 1`,
      deletedAt: null,
      updatedAt
    })
    .where(
      and(
        eq(nodes.workspaceId, scope.workspaceId),
        eq(nodes.boardId, boardId),
        eq(nodes.id, node.id),
        eq(nodes.revision, operation.expectedRevision)
      )
    )
    .returning({ id: nodes.id });
  if (changed.length !== 1) throw new BoardNotFoundError();
}

async function applyEdgeUpsert(
  transaction: TenantTransaction,
  scope: WorkspaceScope,
  boardId: string,
  operation: Extract<CanvasMutationOperation, { type: "edge.upsert" }>,
  updatedAt: Date
): Promise<void> {
  const edge = operation.edge;
  if (operation.expectedRevision === null) {
    const inserted = await transaction
      .insert(edges)
      .values({
        id: edge.id,
        workspaceId: scope.workspaceId,
        boardId,
        sourceNodeId: edge.sourceId,
        targetNodeId: edge.targetId,
        rank: edge.rank,
        revision: 0,
        deletedAt: null,
        updatedAt
      })
      .onConflictDoNothing()
      .returning({ id: edges.id });
    if (inserted.length !== 1) throw new BoardNotFoundError();
    return;
  }

  const changed = await transaction
    .update(edges)
    .set({
      sourceNodeId: edge.sourceId,
      targetNodeId: edge.targetId,
      rank: edge.rank,
      revision: sql`${edges.revision} + 1`,
      deletedAt: null,
      updatedAt
    })
    .where(
      and(
        eq(edges.workspaceId, scope.workspaceId),
        eq(edges.boardId, boardId),
        eq(edges.id, edge.id),
        eq(edges.revision, operation.expectedRevision)
      )
    )
    .returning({ id: edges.id });
  if (changed.length !== 1) throw new BoardNotFoundError();
}

async function applyOperations(
  transaction: TenantTransaction,
  scope: WorkspaceScope,
  boardId: string,
  operations: readonly CanvasMutationOperation[],
  updatedAt: Date
): Promise<void> {
  for (const operation of operations) {
    if (operation.type === "edge.delete") {
      await applyEdgeDelete(transaction, scope, boardId, operation, updatedAt);
    }
  }
  for (const operation of operations) {
    if (operation.type === "node.delete") {
      await applyNodeDelete(transaction, scope, boardId, operation, updatedAt);
    }
  }
  const nodeUpserts = operations.filter(
    (operation): operation is Extract<CanvasMutationOperation, { type: "node.upsert" }> =>
      operation.type === "node.upsert"
  );
  for (const operation of nodeUpserts) {
    await applyNodeUpsert(transaction, scope, boardId, operation, updatedAt);
  }
  for (const operation of nodeUpserts) {
    if (!operation.node.parentId) continue;
    const changed = await transaction
      .update(nodes)
      .set({ parentNodeId: operation.node.parentId })
      .where(
        and(
          eq(nodes.workspaceId, scope.workspaceId),
          eq(nodes.boardId, boardId),
          eq(nodes.id, operation.node.id)
        )
      )
      .returning({ id: nodes.id });
    if (changed.length !== 1) throw new BoardNotFoundError();
  }
  for (const operation of operations) {
    if (operation.type === "edge.upsert") {
      await applyEdgeUpsert(transaction, scope, boardId, operation, updatedAt);
    }
  }
}

export async function saveCanvas(
  database: SiftloomDatabase,
  scope: WorkspaceScope,
  boardId: string,
  untrustedCommand: CanvasSaveCommand
): Promise<CanvasSaveResult> {
  const command = canvasSaveCommandSchema.parse(untrustedCommand);

  return withTenantTransaction(database, scope, async (transaction) => {
    const lockedBoard = await transaction
      .select({ revision: boards.revision })
      .from(boards)
      .where(and(eq(boards.workspaceId, scope.workspaceId), eq(boards.id, boardId)))
      .limit(1)
      .for("update");
    const currentBoard = lockedBoard[0];
    if (!currentBoard) throw new BoardNotFoundError();

    const receiptRows = await transaction
      .select({ responsePayload: mutationReceipts.responsePayload })
      .from(mutationReceipts)
      .where(
        and(
          eq(mutationReceipts.workspaceId, scope.workspaceId),
          eq(mutationReceipts.boardId, boardId),
          eq(mutationReceipts.mutationId, command.mutationId)
        )
      )
      .limit(1);
    const receipt = receiptRows[0];
    if (receipt) return canvasSaveResultSchema.parse(receipt.responsePayload);
    if (command.baseBoardRevision > currentBoard.revision) {
      throw new CanvasConflictError(currentBoard.revision);
    }

    const currentRows = await readCanvasRows(transaction, scope, boardId);
    validateAndBuildFinalGraph(
      command.operations,
      currentRows.nodeRows,
      currentRows.edgeRows,
      currentBoard.revision
    );

    const updatedAt = new Date();
    await applyOperations(transaction, scope, boardId, command.operations, updatedAt);
    const resultRevision = currentBoard.revision + 1;
    await transaction
      .update(boards)
      .set({ revision: resultRevision, updatedAt })
      .where(and(eq(boards.workspaceId, scope.workspaceId), eq(boards.id, boardId)));

    const snapshot = await readCanvasSnapshot(transaction, scope, boardId, resultRevision);
    const result = canvasSaveResultSchema.parse({
      mutationId: command.mutationId,
      boardRevision: resultRevision,
      graph: snapshot.graph,
      deleted: snapshot.deleted
    });
    await transaction.insert(mutationReceipts).values({
      workspaceId: scope.workspaceId,
      boardId,
      mutationId: command.mutationId,
      baseRevision: command.baseBoardRevision,
      resultRevision,
      responsePayload: result
    });
    return result;
  });
}
