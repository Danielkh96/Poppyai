import { z } from "zod";

import { PHASE_1_LIMITS } from "./limits.js";

export const CANVAS_NODE_KINDS = [
  "note",
  "text",
  "pdf",
  "webpage",
  "video",
  "chat",
  "group"
] as const;

export const CANVAS_NODE_STATUSES = [
  "draft",
  "queued",
  "processing",
  "ready",
  "ready_with_warning",
  "streaming",
  "failed"
] as const;

export type CanvasNodeKind = (typeof CANVAS_NODE_KINDS)[number];
export type CanvasNodeStatus = (typeof CANVAS_NODE_STATUSES)[number];

const titleSchema = z.string().trim().min(1).max(120);
const summarySchema = z.string().trim().max(2_000);
const statusSchema = z.enum(CANVAS_NODE_STATUSES);
const progressSchema = z.number().int().min(0).max(100).nullable();
const canvasUrlSchema = z.union([
  z.literal(""),
  z
    .url()
    .max(2_048)
    .refine((value) => value.startsWith("https://"), "Only HTTPS sources are accepted")
    .refine((value) => {
      const url = new URL(value);
      return url.username === "" && url.password === "";
    }, "Credentials in source URLs are not accepted")
]);
const commonPayloadFields = {
  version: z.literal(1),
  title: titleSchema,
  summary: summarySchema,
  status: statusSchema,
  progress: progressSchema
} as const;

export const canvasNodePayloadSchema = z.discriminatedUnion("kind", [
  z.object({
    ...commonPayloadFields,
    kind: z.literal("note"),
    body: z.string().max(PHASE_1_LIMITS.text.maxCharacters)
  }),
  z.object({
    ...commonPayloadFields,
    kind: z.literal("text"),
    body: z.string().max(PHASE_1_LIMITS.text.maxCharacters)
  }),
  z.object({
    ...commonPayloadFields,
    kind: z.literal("pdf"),
    fileName: z.string().trim().max(255)
  }),
  z.object({
    ...commonPayloadFields,
    kind: z.literal("webpage"),
    url: canvasUrlSchema
  }),
  z.object({
    ...commonPayloadFields,
    kind: z.literal("video"),
    url: canvasUrlSchema
  }),
  z.object({
    ...commonPayloadFields,
    kind: z.literal("chat"),
    prompt: z.string().max(PHASE_1_LIMITS.text.maxCharacters)
  }),
  z.object({
    ...commonPayloadFields,
    kind: z.literal("group"),
    description: z.string().max(2_000)
  })
]);

export type CanvasNodePayload = z.infer<typeof canvasNodePayloadSchema>;

export const worldPointSchema = z.object({
  x: z.number().finite().min(-1_000_000).max(1_000_000),
  y: z.number().finite().min(-1_000_000).max(1_000_000)
});

export const worldSizeSchema = z.object({
  width: z.number().finite().min(80).max(4_000),
  height: z.number().finite().min(60).max(4_000)
});

export type WorldPoint = z.infer<typeof worldPointSchema>;
export type WorldSize = z.infer<typeof worldSizeSchema>;

export const canvasNodeSchema = z
  .object({
    id: z.string().min(1).max(200),
    kind: z.enum(CANVAS_NODE_KINDS),
    parentId: z.string().min(1).max(200).nullable(),
    position: worldPointSchema,
    size: worldSizeSchema,
    payload: canvasNodePayloadSchema,
    revision: z.number().int().nonnegative()
  })
  .superRefine((node, context) => {
    if (node.kind !== node.payload.kind) {
      context.addIssue({
        code: "custom",
        path: ["payload", "kind"],
        message: "Node kind and payload kind must match"
      });
    }
  });

export const canvasEdgeSchema = z.object({
  id: z.string().min(1).max(200),
  sourceId: z.string().min(1).max(200),
  targetId: z.string().min(1).max(200),
  relation: z.literal("context"),
  rank: z.number().int().nonnegative(),
  revision: z.number().int().nonnegative().default(0)
});

export type CanvasNode = z.infer<typeof canvasNodeSchema>;
export type CanvasEdge = z.infer<typeof canvasEdgeSchema>;

function validateGraph(
  graph: { nodes: CanvasNode[]; edges: CanvasEdge[] },
  context: z.RefinementCtx
): void {
  const nodesById = new Map<string, CanvasNode>();
  for (const [index, node] of graph.nodes.entries()) {
    if (nodesById.has(node.id)) {
      context.addIssue({
        code: "custom",
        path: ["nodes", index, "id"],
        message: "Node IDs must be unique"
      });
    }
    nodesById.set(node.id, node);
  }

  for (const [index, node] of graph.nodes.entries()) {
    if (!node.parentId) continue;
    const parent = nodesById.get(node.parentId);
    if (!parent || parent.kind !== "group") {
      context.addIssue({
        code: "custom",
        path: ["nodes", index, "parentId"],
        message: "Parent must be an active group on the same board"
      });
    }
    if (node.kind === "group" || node.kind === "chat") {
      context.addIssue({
        code: "custom",
        path: ["nodes", index, "parentId"],
        message: "Groups and chat nodes cannot be grouped"
      });
    }
  }

  const edgeIds = new Set<string>();
  const activePairs = new Set<string>();
  for (const [index, edge] of graph.edges.entries()) {
    if (edgeIds.has(edge.id)) {
      context.addIssue({
        code: "custom",
        path: ["edges", index, "id"],
        message: "Edge IDs must be unique"
      });
    }
    edgeIds.add(edge.id);

    const source = nodesById.get(edge.sourceId);
    const target = nodesById.get(edge.targetId);
    const pair = `${edge.sourceId}->${edge.targetId}`;
    if (!source || !target || source.kind === "chat" || target.kind !== "chat") {
      context.addIssue({
        code: "custom",
        path: ["edges", index],
        message: "Context edges must connect an active source or group to an active chat"
      });
    }
    if (edge.sourceId === edge.targetId || activePairs.has(pair)) {
      context.addIssue({
        code: "custom",
        path: ["edges", index],
        message: "Self and duplicate context connections are not allowed"
      });
    }
    activePairs.add(pair);
  }
}

export const canvasGraphSchema = z
  .object({
    nodes: z.array(canvasNodeSchema).max(PHASE_1_LIMITS.canvas.maxNodesPerBoard),
    edges: z.array(canvasEdgeSchema).max(PHASE_1_LIMITS.canvas.maxEdgesPerBoard)
  })
  .superRefine(validateGraph);

export type CanvasGraph = z.infer<typeof canvasGraphSchema>;

const persistedNodeSchema = canvasNodeSchema.superRefine((node, context) => {
  if (!z.uuid().safeParse(node.id).success) {
    context.addIssue({ code: "custom", path: ["id"], message: "Node ID must be a UUID" });
  }
  if (node.parentId && !z.uuid().safeParse(node.parentId).success) {
    context.addIssue({
      code: "custom",
      path: ["parentId"],
      message: "Parent ID must be a UUID"
    });
  }
});

const persistedEdgeSchema = canvasEdgeSchema.superRefine((edge, context) => {
  for (const [field, value] of [
    ["id", edge.id],
    ["sourceId", edge.sourceId],
    ["targetId", edge.targetId]
  ] as const) {
    if (!z.uuid().safeParse(value).success) {
      context.addIssue({
        code: "custom",
        path: [field],
        message: "Edge IDs and references must be UUIDs"
      });
    }
  }
});

const expectedRevisionSchema = z.number().int().nonnegative();

export const canvasMutationOperationSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("node.upsert"),
    expectedRevision: expectedRevisionSchema.nullable(),
    node: persistedNodeSchema
  }),
  z.object({
    type: z.literal("node.delete"),
    nodeId: z.uuid(),
    expectedRevision: expectedRevisionSchema
  }),
  z.object({
    type: z.literal("edge.upsert"),
    expectedRevision: expectedRevisionSchema.nullable(),
    edge: persistedEdgeSchema
  }),
  z.object({
    type: z.literal("edge.delete"),
    edgeId: z.uuid(),
    expectedRevision: expectedRevisionSchema
  })
]);

export type CanvasMutationOperation = z.infer<typeof canvasMutationOperationSchema>;

export const canvasSaveCommandSchema = z
  .object({
    mutationId: z.uuid(),
    baseBoardRevision: z.number().int().nonnegative(),
    operations: z
      .array(canvasMutationOperationSchema)
      .min(1)
      .max(PHASE_1_LIMITS.canvas.mutationBatchOperations)
  })
  .superRefine((command, context) => {
    const targets = new Set<string>();
    for (const [index, operation] of command.operations.entries()) {
      const target =
        operation.type === "node.upsert"
          ? `node:${operation.node.id}`
          : operation.type === "node.delete"
            ? `node:${operation.nodeId}`
            : operation.type === "edge.upsert"
              ? `edge:${operation.edge.id}`
              : `edge:${operation.edgeId}`;
      if (targets.has(target)) {
        context.addIssue({
          code: "custom",
          path: ["operations", index],
          message: "A mutation batch may change each record only once"
        });
      }
      targets.add(target);
    }
  });

export type CanvasSaveCommand = z.infer<typeof canvasSaveCommandSchema>;

export const deletedCanvasNodeSchema = canvasNodeSchema.and(
  z.object({ deletedAt: z.iso.datetime() })
);
export const deletedCanvasEdgeSchema = canvasEdgeSchema.and(
  z.object({ deletedAt: z.iso.datetime() })
);

export const canvasSnapshotSchema = z.object({
  boardRevision: z.number().int().nonnegative(),
  graph: canvasGraphSchema,
  deleted: z.object({
    nodes: z.array(deletedCanvasNodeSchema),
    edges: z.array(deletedCanvasEdgeSchema)
  })
});

export type CanvasSnapshot = z.infer<typeof canvasSnapshotSchema>;

export const canvasSaveResultSchema = z.object({
  mutationId: z.uuid(),
  boardRevision: z.number().int().nonnegative(),
  graph: canvasGraphSchema,
  deleted: z.object({
    nodes: z.array(deletedCanvasNodeSchema),
    edges: z.array(deletedCanvasEdgeSchema)
  })
});

export type CanvasSaveResult = z.infer<typeof canvasSaveResultSchema>;

export interface CanvasFixtureOptions {
  readonly nodeCount?: number;
  readonly edgeCount?: number;
  readonly seed?: number;
}

const TITLES: Record<CanvasNodeKind, readonly string[]> = {
  note: ["研究假设", "用户语言", "待验证问题"],
  text: ["访谈摘录", "产品叙述", "结论草稿"],
  pdf: ["市场观察.pdf", "研究报告.pdf", "策略备忘录.pdf"],
  webpage: ["竞品定价页", "行业新闻", "公开资料"],
  video: ["访谈录像", "主题演讲", "产品演示"],
  chat: ["综合分析", "证据问答", "内容提炼"],
  group: ["核心证据", "受众洞察", "机会空间"]
};

function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4_294_967_296;
  };
}

function assertFixtureSize(nodeCount: number, edgeCount: number): void {
  if (!Number.isInteger(nodeCount) || nodeCount < CANVAS_NODE_KINDS.length) {
    throw new RangeError(
      `nodeCount must be an integer at least ${CANVAS_NODE_KINDS.length}`
    );
  }
  if (!Number.isInteger(edgeCount) || edgeCount < 0) {
    throw new RangeError("edgeCount must be a non-negative integer");
  }
}

function fixturePayload(
  kind: CanvasNodeKind,
  title: string,
  status: CanvasNodeStatus
): CanvasNodePayload {
  const common = {
    version: 1 as const,
    title,
    summary:
      kind === "chat"
        ? "仅使用显式连接且已授权的来源生成回答。"
        : "保留来源、状态与版本，支持可追溯引用。",
    status,
    progress: status === "processing" ? 64 : null
  };
  switch (kind) {
    case "note":
      return { ...common, kind, body: "" };
    case "text":
      return { ...common, kind, body: "" };
    case "pdf":
      return { ...common, kind, fileName: title };
    case "webpage":
      return { ...common, kind, url: "" };
    case "video":
      return { ...common, kind, url: "" };
    case "chat":
      return { ...common, kind, prompt: "" };
    case "group":
      return { ...common, kind, description: "" };
  }
}

/** Creates the canonical M0/M2 performance graph without canvas-library types. */
export function createCanvasFixture(options: CanvasFixtureOptions = {}): CanvasGraph {
  const nodeCount = options.nodeCount ?? 200;
  const edgeCount = options.edgeCount ?? 300;
  assertFixtureSize(nodeCount, edgeCount);
  const random = createRandom(options.seed ?? 20_260_801);
  const kinds = CANVAS_NODE_KINDS;

  const nodes: CanvasNode[] = Array.from({ length: nodeCount }, (_, index) => {
    const kind = kinds[index % kinds.length] ?? "note";
    const variants = TITLES[kind];
    const title = `${variants[index % variants.length] ?? "来源"} ${index + 1}`;
    const status: CanvasNodeStatus =
      index === 2 ? "processing" : index === 5 ? "streaming" : "ready";

    return {
      id: `fixture-node-${String(index + 1).padStart(3, "0")}`,
      kind,
      parentId: null,
      position: {
        x: (index % 20) * 300 + Math.round(random() * 18),
        y: Math.floor(index / 20) * 200 + Math.round(random() * 18)
      },
      size: { width: kind === "chat" ? 280 : 248, height: kind === "chat" ? 164 : 136 },
      payload: fixturePayload(kind, title, status),
      revision: 1
    };
  });

  const sourceNodes = nodes.filter((node) => node.kind !== "chat");
  const chatNodes = nodes.filter((node) => node.kind === "chat");
  const allowedPairs = sourceNodes.flatMap((source) =>
    chatNodes.map((target) => ({ source, target }))
  );
  if (edgeCount > allowedPairs.length) {
    throw new RangeError(
      `edgeCount ${edgeCount} exceeds ${allowedPairs.length} unique source/group-to-chat pairs`
    );
  }

  for (let index = allowedPairs.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    const current = allowedPairs[index];
    allowedPairs[index] = allowedPairs[swapIndex] as (typeof allowedPairs)[number];
    allowedPairs[swapIndex] = current as (typeof allowedPairs)[number];
  }

  const edges: CanvasEdge[] = allowedPairs
    .slice(0, edgeCount)
    .map(({ source, target }, index) => ({
      id: `fixture-edge-${String(index + 1).padStart(3, "0")}`,
      sourceId: source.id,
      targetId: target.id,
      relation: "context",
      rank: index,
      revision: 1
    }));

  return { nodes, edges };
}
