import { describe, expect, it } from "vitest";

import { createCanvasFixture } from "./canvas.js";

describe("createCanvasFixture", () => {
  it("creates the fixed M0 workload", () => {
    const graph = createCanvasFixture();

    expect(graph.nodes).toHaveLength(200);
    expect(graph.edges).toHaveLength(300);
    expect(graph.nodes.filter((node) => node.status === "processing")).toEqual([
      expect.objectContaining({ kind: "pdf", progress: 64 })
    ]);
    expect(graph.nodes.filter((node) => node.status === "streaming")).toEqual([
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
