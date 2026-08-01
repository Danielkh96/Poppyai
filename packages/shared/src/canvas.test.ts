import { describe, expect, it } from "vitest";

import {
  canvasGraphSchema,
  canvasSaveCommandSchema,
  createCanvasFixture
} from "./canvas.js";

describe("createCanvasFixture", () => {
  it("creates the fixed M0 workload", () => {
    const graph = createCanvasFixture();

    expect(graph.nodes).toHaveLength(200);
    expect(graph.edges).toHaveLength(300);
    expect(graph.nodes.filter((node) => node.payload.status === "processing")).toEqual([
      expect.objectContaining({
        kind: "pdf",
        payload: expect.objectContaining({ progress: 64 })
      })
    ]);
    expect(graph.nodes.filter((node) => node.payload.status === "streaming")).toEqual([
      expect.objectContaining({ kind: "chat" })
    ]);
  });

  it("is deterministic for the same seed", () => {
    expect(createCanvasFixture({ seed: 42 })).toEqual(createCanvasFixture({ seed: 42 }));
    expect(createCanvasFixture({ seed: 42 })).not.toEqual(
      createCanvasFixture({ seed: 43 })
    );
  });

  it("creates only unique source/group-to-chat edges", () => {
    const graph = createCanvasFixture();
    const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
    const pairs = graph.edges.map((edge) => `${edge.sourceId}->${edge.targetId}`);

    expect(new Set(pairs).size).toBe(graph.edges.length);
    for (const edge of graph.edges) {
      expect(nodesById.get(edge.sourceId)?.kind).not.toBe("chat");
      expect(nodesById.get(edge.targetId)?.kind).toBe("chat");
    }
  });

  it("rejects fixture sizes that cannot preserve graph semantics", () => {
    expect(() => createCanvasFixture({ nodeCount: 6 })).toThrow(RangeError);
    expect(() => createCanvasFixture({ nodeCount: 7, edgeCount: 7 })).toThrow(RangeError);
  });
});

describe("canvas graph validation", () => {
  it("rejects invalid group parents and context connections", () => {
    const graph = createCanvasFixture({ nodeCount: 14, edgeCount: 3 });
    const source = graph.nodes.find(
      (node) => node.kind !== "chat" && node.kind !== "group"
    );
    const secondSource = graph.nodes.find(
      (node) => node.id !== source?.id && node.kind !== "chat" && node.kind !== "group"
    );
    if (!source || !secondSource) throw new Error("Canvas test sources are missing");

    expect(
      canvasGraphSchema.safeParse({
        ...graph,
        nodes: graph.nodes.map((node) =>
          node.id === source.id ? { ...node, parentId: secondSource.id } : node
        )
      }).success
    ).toBe(false);
    expect(
      canvasGraphSchema.safeParse({
        ...graph,
        edges: [
          ...graph.edges,
          {
            id: "invalid-edge",
            sourceId: source.id,
            targetId: secondSource.id,
            relation: "context",
            rank: 99,
            revision: 0
          }
        ]
      }).success
    ).toBe(false);
  });

  it("rejects non-finite geometry, mismatched payloads, and non-UUID persistence IDs", () => {
    const graph = createCanvasFixture({ nodeCount: 14, edgeCount: 3 });
    const first = graph.nodes[0];
    if (!first) throw new Error("Canvas test fixture is empty");

    expect(
      canvasGraphSchema.safeParse({
        ...graph,
        nodes: graph.nodes.map((node) =>
          node.id === first.id ? { ...node, position: { x: Number.NaN, y: 0 } } : node
        )
      }).success
    ).toBe(false);
    expect(
      canvasGraphSchema.safeParse({
        ...graph,
        nodes: graph.nodes.map((node) =>
          node.id === first.id
            ? { ...node, kind: "note", payload: { ...node.payload, kind: "chat" } }
            : node
        )
      }).success
    ).toBe(false);
    expect(
      canvasSaveCommandSchema.safeParse({
        mutationId: "not-a-uuid",
        baseBoardRevision: 0,
        operations: [
          {
            type: "node.upsert",
            expectedRevision: first.revision,
            node: first
          }
        ]
      }).success
    ).toBe(false);
  });

  it("accepts only credential-free HTTPS source URLs", () => {
    const graph = createCanvasFixture({ nodeCount: 14, edgeCount: 3 });
    const webpage = graph.nodes.find((node) => node.kind === "webpage");
    if (!webpage || webpage.payload.kind !== "webpage") {
      throw new Error("Canvas webpage fixture is missing");
    }
    const withUrl = (url: string) => ({
      ...graph,
      nodes: graph.nodes.map((node) =>
        node.id === webpage.id ? { ...webpage, payload: { ...webpage.payload, url } } : node
      )
    });

    expect(canvasGraphSchema.safeParse(withUrl("https://example.com/source")).success).toBe(
      true
    );
    expect(canvasGraphSchema.safeParse(withUrl("http://example.com/source")).success).toBe(
      false
    );
    expect(
      canvasGraphSchema.safeParse(withUrl("https://user:secret@example.com/source")).success
    ).toBe(false);
  });
});
