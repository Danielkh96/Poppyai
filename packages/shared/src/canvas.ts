export const CANVAS_NODE_KINDS = [
  "note",
  "text",
  "pdf",
  "webpage",
  "video",
  "chat",
  "group"
] as const;

export type CanvasNodeKind = (typeof CANVAS_NODE_KINDS)[number];
export type CanvasNodeStatus =
  | "draft"
  | "queued"
  | "processing"
  | "ready"
  | "ready_with_warning"
  | "streaming"
  | "failed";

export interface WorldPoint {
  readonly x: number;
  readonly y: number;
}

export interface WorldSize {
  readonly width: number;
  readonly height: number;
}

export interface CanvasNode {
  readonly id: string;
  readonly kind: CanvasNodeKind;
  readonly position: WorldPoint;
  readonly size: WorldSize;
  readonly title: string;
  readonly summary: string;
  readonly status: CanvasNodeStatus;
  readonly progress: number | null;
  readonly revision: number;
}

export interface CanvasEdge {
  readonly id: string;
  readonly sourceId: string;
  readonly targetId: string;
  readonly relation: "context";
  readonly rank: number;
}

export interface CanvasGraph {
  readonly nodes: readonly CanvasNode[];
  readonly edges: readonly CanvasEdge[];
}

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

/** Creates the canonical M0 performance graph without importing canvas-library types. */
export function createCanvasFixture(options: CanvasFixtureOptions = {}): CanvasGraph {
  const nodeCount = options.nodeCount ?? 200;
  const edgeCount = options.edgeCount ?? 300;
  assertFixtureSize(nodeCount, edgeCount);
  const random = createRandom(options.seed ?? 20_260_801);
  const kinds = CANVAS_NODE_KINDS;

  const nodes: CanvasNode[] = Array.from({ length: nodeCount }, (_, index) => {
    const kind = kinds[index % kinds.length] ?? "note";
    const variants = TITLES[kind];
    const title = variants[index % variants.length] ?? "来源";
    // Fixed semantic states: index 2 is a PDF source and index 5 is a chat node.
    const status: CanvasNodeStatus =
      index === 2 ? "processing" : index === 5 ? "streaming" : "ready";

    return {
      id: `fixture-node-${String(index + 1).padStart(3, "0")}`,
      kind,
      position: {
        x: (index % 20) * 300 + Math.round(random() * 18),
        y: Math.floor(index / 20) * 200 + Math.round(random() * 18)
      },
      size: { width: kind === "chat" ? 280 : 248, height: kind === "chat" ? 164 : 136 },
      title: `${title} ${index + 1}`,
      summary:
        kind === "chat"
          ? "仅使用显式连接且已授权的来源生成回答。"
          : "保留来源、状态与版本，支持可追溯引用。",
      status,
      progress: status === "processing" ? 64 : null,
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

  // Fisher-Yates gives a deterministic, non-repeating sample of legal context pairs.
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
      rank: index
    }));

  return { nodes, edges };
}
