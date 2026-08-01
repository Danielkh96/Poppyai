import { randomUUID } from "node:crypto";

import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  canvasGraphSchema,
  type CanvasGraph,
  type CanvasMutationOperation,
  type CanvasNode,
  type CanvasNodeKind
} from "@siftloom/shared";

import {
  BoardNotFoundError,
  createBoard,
  createDatabaseClient,
  getCanvasSnapshot,
  provisionPersonalWorkspace,
  saveCanvas,
  type DatabaseClient
} from "./index.js";

function requireTestUrl(name: "TEST_DATABASE_URL" | "TEST_RUNTIME_DATABASE_URL"): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required; canvas integration tests may not skip`);
  return value;
}

const adminUrl = requireTestUrl("TEST_DATABASE_URL");
const runtimeUrl = requireTestUrl("TEST_RUNTIME_DATABASE_URL");
const userA = `m2-user-a-${randomUUID()}`;
const userB = `m2-user-b-${randomUUID()}`;
const users = [userA, userB];

let adminPool: Pool | undefined;
let runtimeClient: DatabaseClient | undefined;

function createNode(kind: CanvasNodeKind, index: number): CanvasNode {
  const common = {
    version: 1 as const,
    title: `${kind} ${index}`,
    summary: "M2 canonical persistence test",
    status: "draft" as const,
    progress: null
  };
  const payload =
    kind === "note" || kind === "text"
      ? { ...common, kind, body: "test body" }
      : kind === "pdf"
        ? { ...common, kind, fileName: "source.pdf" }
        : kind === "webpage" || kind === "video"
          ? { ...common, kind, url: "https://example.com/source" }
          : kind === "chat"
            ? { ...common, kind, prompt: "Compare the sources" }
            : { ...common, kind, description: "Research sources" };

  return {
    id: randomUUID(),
    kind,
    parentId: null,
    position: { x: 100 + index * 30, y: 100 + index * 20 },
    size: kind === "group" ? { width: 700, height: 500 } : { width: 240, height: 150 },
    payload,
    revision: 0
  };
}

function createGraph(): CanvasGraph {
  const kinds: CanvasNodeKind[] = [
    "group",
    "note",
    "text",
    "pdf",
    "webpage",
    "video",
    "chat"
  ];
  const nodes = kinds.map(createNode);
  const group = nodes[0];
  const note = nodes[1];
  const chat = nodes.at(-1);
  if (!group || !note || !chat) throw new Error("Test graph fixture is incomplete");
  const groupedNodes = nodes.map((node) =>
    node.id === note.id ? { ...node, parentId: group.id } : node
  );
  return canvasGraphSchema.parse({
    nodes: groupedNodes,
    edges: [
      {
        id: randomUUID(),
        sourceId: group.id,
        targetId: chat.id,
        relation: "context",
        rank: 0,
        revision: 0
      },
      {
        id: randomUUID(),
        sourceId: nodes[4]?.id,
        targetId: chat.id,
        relation: "context",
        rank: 1,
        revision: 0
      }
    ]
  });
}

function createOperations(graph: CanvasGraph): CanvasMutationOperation[] {
  return [
    ...graph.nodes.map((node) => ({
      type: "node.upsert" as const,
      expectedRevision: null,
      node
    })),
    ...graph.edges.map((edge) => ({
      type: "edge.upsert" as const,
      expectedRevision: null,
      edge
    }))
  ];
}

describe("M2 tenant-safe canvas persistence", () => {
  beforeAll(async () => {
    adminPool = new Pool({ connectionString: adminUrl });
    await adminPool.query(
      `insert into "user" (id, name, email, email_verified)
       values ($1, 'M2 User A', $2, true), ($3, 'M2 User B', $4, true)`,
      [userA, `${userA}@example.test`, userB, `${userB}@example.test`]
    );
    runtimeClient = createDatabaseClient(runtimeUrl);
  });

  afterAll(async () => {
    await runtimeClient?.close();
    if (adminPool) {
      await adminPool.query(
        `delete from workspace where personal_owner_user_id = any($1::text[])`,
        [users]
      );
      await adminPool.query(`delete from "user" where id = any($1::text[])`, [users]);
      await adminPool.end();
    }
  });

  it("persists every node kind, grouping, connections, and refresh state", async () => {
    if (!runtimeClient) throw new Error("Runtime database client is not initialized");
    const scope = await provisionPersonalWorkspace(runtimeClient.db, {
      id: userA,
      name: "M2 User A"
    });
    const board = await createBoard(runtimeClient.db, scope, {
      mutationId: randomUUID(),
      name: "M2 persistence"
    });
    const graph = createGraph();

    await expect(
      getCanvasSnapshot(runtimeClient.db, scope, board.id)
    ).resolves.toMatchObject({
      boardRevision: 0,
      graph: { nodes: [], edges: [] }
    });
    const mutationId = randomUUID();
    const saved = await saveCanvas(runtimeClient.db, scope, board.id, {
      mutationId,
      baseBoardRevision: 0,
      operations: createOperations(graph)
    });
    expect(saved.boardRevision).toBe(1);
    expect(saved.graph.nodes.map((node) => node.kind)).toEqual(
      expect.arrayContaining(["note", "text", "pdf", "webpage", "video", "chat", "group"])
    );
    expect(saved.graph.nodes.find((node) => node.kind === "note")?.parentId).toBe(
      graph.nodes.find((node) => node.kind === "group")?.id
    );

    const refreshed = await getCanvasSnapshot(runtimeClient.db, scope, board.id);
    expect(refreshed.graph).toEqual(saved.graph);
    expect(refreshed.deleted).toEqual({ nodes: [], edges: [] });

    const duplicate = await saveCanvas(runtimeClient.db, scope, board.id, {
      mutationId,
      baseBoardRevision: 0,
      operations: createOperations(graph)
    });
    expect(duplicate).toEqual(saved);
    expect((await getCanvasSnapshot(runtimeClient.db, scope, board.id)).boardRevision).toBe(
      1
    );
  });

  it("rejects stale writes, soft-deletes missing rows, and restores them", async () => {
    if (!runtimeClient) throw new Error("Runtime database client is not initialized");
    const scope = await provisionPersonalWorkspace(runtimeClient.db, {
      id: userA,
      name: "M2 User A"
    });
    const board = await createBoard(runtimeClient.db, scope, {
      mutationId: randomUUID(),
      name: "M2 recovery"
    });
    const graph = createGraph();
    const first = await saveCanvas(runtimeClient.db, scope, board.id, {
      mutationId: randomUUID(),
      baseBoardRevision: 0,
      operations: createOperations(graph)
    });

    const note = first.graph.nodes.find((node) => node.kind === "note")!;
    const text = first.graph.nodes.find((node) => node.kind === "text")!;
    await saveCanvas(runtimeClient.db, scope, board.id, {
      mutationId: randomUUID(),
      baseBoardRevision: 1,
      operations: [
        {
          type: "node.upsert",
          expectedRevision: note.revision,
          node: { ...note, payload: { ...note.payload, title: "First tab" } }
        }
      ]
    });
    await expect(
      saveCanvas(runtimeClient.db, scope, board.id, {
        mutationId: randomUUID(),
        baseBoardRevision: 1,
        operations: [
          {
            type: "node.upsert",
            expectedRevision: text.revision,
            node: { ...text, payload: { ...text.payload, title: "Unrelated second tab" } }
          }
        ]
      })
    ).resolves.toMatchObject({ boardRevision: 3 });
    await expect(
      saveCanvas(runtimeClient.db, scope, board.id, {
        mutationId: randomUUID(),
        baseBoardRevision: 1,
        operations: [
          {
            type: "node.upsert",
            expectedRevision: note.revision,
            node: { ...note, payload: { ...note.payload, title: "Stale same node" } }
          }
        ]
      })
    ).rejects.toMatchObject({ latestRevision: 3, targetId: note.id });

    const removable = first.graph.nodes.find((node) => node.kind === "webpage");
    if (!removable) throw new Error("Test webpage node is missing");
    const removed = await saveCanvas(runtimeClient.db, scope, board.id, {
      mutationId: randomUUID(),
      baseBoardRevision: 3,
      operations: [
        ...first.graph.edges
          .filter(
            (edge) => edge.sourceId === removable.id || edge.targetId === removable.id
          )
          .map((edge) => ({
            type: "edge.delete" as const,
            edgeId: edge.id,
            expectedRevision: edge.revision
          })),
        { type: "node.delete", nodeId: removable.id, expectedRevision: removable.revision }
      ]
    });
    expect(removed.boardRevision).toBe(4);
    const deletedSnapshot = await getCanvasSnapshot(runtimeClient.db, scope, board.id);
    expect(deletedSnapshot.deleted.nodes).toEqual([
      expect.objectContaining({ id: removable.id, deletedAt: expect.any(String) })
    ]);
    expect(deletedSnapshot.deleted.edges).toHaveLength(1);

    const restored = await saveCanvas(runtimeClient.db, scope, board.id, {
      mutationId: randomUUID(),
      baseBoardRevision: 4,
      operations: [
        {
          type: "node.upsert",
          expectedRevision: deletedSnapshot.deleted.nodes[0]!.revision,
          node: removable
        },
        ...deletedSnapshot.deleted.edges.map((edge) => ({
          type: "edge.upsert" as const,
          expectedRevision: edge.revision,
          edge: first.graph.edges.find((candidate) => candidate.id === edge.id)!
        }))
      ]
    });
    expect(restored.boardRevision).toBe(5);
    const restoredSnapshot = await getCanvasSnapshot(runtimeClient.db, scope, board.id);
    expect(restoredSnapshot.graph.nodes.some((node) => node.id === removable.id)).toBe(
      true
    );
    expect(restoredSnapshot.deleted).toEqual({ nodes: [], edges: [] });
  });

  it("does not disclose or mutate a board across tenants", async () => {
    if (!runtimeClient) throw new Error("Runtime database client is not initialized");
    const [scopeA, scopeB] = await Promise.all([
      provisionPersonalWorkspace(runtimeClient.db, { id: userA, name: "M2 User A" }),
      provisionPersonalWorkspace(runtimeClient.db, { id: userB, name: "M2 User B" })
    ]);
    const board = await createBoard(runtimeClient.db, scopeA, {
      mutationId: randomUUID(),
      name: "Tenant A canvas"
    });

    await expect(
      getCanvasSnapshot(runtimeClient.db, scopeB, board.id)
    ).rejects.toBeInstanceOf(BoardNotFoundError);
    await expect(
      saveCanvas(runtimeClient.db, scopeB, board.id, {
        mutationId: randomUUID(),
        baseBoardRevision: 0,
        operations: [
          {
            type: "node.upsert",
            expectedRevision: null,
            node: createNode("note", 99)
          }
        ]
      })
    ).rejects.toBeInstanceOf(BoardNotFoundError);
  });
});
