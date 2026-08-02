"use client";

import {
  canvasGraphSchema,
  canvasSaveResultSchema,
  canvasSnapshotSchema,
  ingestionStatusListSchema,
  PHASE_1_LIMITS,
  type CanvasEdge,
  type CanvasGraph,
  type CanvasMutationOperation,
  type CanvasNode,
  type CanvasNodeKind,
  type CanvasNodePayload,
  type CanvasSnapshot,
  type IngestionStatus
} from "@siftloom/shared";
import { CanvasSurface } from "@siftloom/ui";
import {
  AlertTriangle,
  Check,
  ChevronRight,
  FileText,
  FolderPlus,
  Globe2,
  Link2,
  LoaderCircle,
  MessageSquareText,
  PanelRightClose,
  Redo2,
  RefreshCw,
  RotateCcw,
  StickyNote,
  Trash2,
  Type,
  Undo2,
  Upload,
  Video
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ChatInspector } from "./ChatInspector";

type SaveState = "saved" | "dirty" | "saving" | "failed" | "conflict";
type SourceActionState = "idle" | "uploading" | "submitting" | "retrying";

interface PersistentCanvasEditorProps {
  readonly boardId: string;
  readonly initialSnapshot: CanvasSnapshot;
}

const KIND_LABELS: Record<CanvasNodeKind, string> = {
  note: "便笺",
  text: "文本",
  pdf: "PDF",
  webpage: "网页",
  video: "视频",
  chat: "AI 对话",
  group: "分组"
};

const NODE_TOOLS: ReadonlyArray<{
  kind: CanvasNodeKind;
  icon: typeof StickyNote;
}> = [
  { kind: "note", icon: StickyNote },
  { kind: "text", icon: Type },
  { kind: "pdf", icon: FileText },
  { kind: "webpage", icon: Globe2 },
  { kind: "video", icon: Video },
  { kind: "chat", icon: MessageSquareText },
  { kind: "group", icon: FolderPlus }
];

function defaultPayload(kind: CanvasNodeKind, index: number): CanvasNodePayload {
  const common = {
    version: 1 as const,
    title: `${KIND_LABELS[kind]} ${index}`,
    summary: "添加内容后，Siftloom 会将变更自动保存。",
    status: "draft" as const,
    progress: null
  };
  switch (kind) {
    case "note":
    case "text":
      return { ...common, kind, body: "" };
    case "pdf":
      return { ...common, kind, fileName: "" };
    case "webpage":
    case "video":
      return { ...common, kind, url: "" };
    case "chat":
      return { ...common, kind, prompt: "" };
    case "group":
      return { ...common, kind, description: "" };
  }
}

function sameGraph(left: CanvasGraph, right: CanvasGraph): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sameNodeContent(left: CanvasNode, right: CanvasNode): boolean {
  return (
    JSON.stringify({ ...left, revision: 0 }) === JSON.stringify({ ...right, revision: 0 })
  );
}

function sameEdgeContent(left: CanvasEdge, right: CanvasEdge): boolean {
  return (
    JSON.stringify({ ...left, revision: 0 }) === JSON.stringify({ ...right, revision: 0 })
  );
}

function buildOperations(
  acknowledged: CanvasGraph,
  current: CanvasGraph,
  deleted: CanvasSnapshot["deleted"]
): CanvasMutationOperation[] {
  const acknowledgedNodes = new Map(acknowledged.nodes.map((node) => [node.id, node]));
  const acknowledgedEdges = new Map(acknowledged.edges.map((edge) => [edge.id, edge]));
  const currentNodes = new Map(current.nodes.map((node) => [node.id, node]));
  const currentEdges = new Map(current.edges.map((edge) => [edge.id, edge]));
  const deletedNodes = new Map(deleted.nodes.map((node) => [node.id, node]));
  const deletedEdges = new Map(deleted.edges.map((edge) => [edge.id, edge]));
  const operations: CanvasMutationOperation[] = [];

  for (const edge of acknowledged.edges) {
    if (!currentEdges.has(edge.id)) {
      operations.push({
        type: "edge.delete",
        edgeId: edge.id,
        expectedRevision: edge.revision
      });
    }
  }
  for (const node of acknowledged.nodes) {
    if (!currentNodes.has(node.id)) {
      operations.push({
        type: "node.delete",
        nodeId: node.id,
        expectedRevision: node.revision
      });
    }
  }
  for (const node of current.nodes) {
    const prior = acknowledgedNodes.get(node.id);
    if (!prior || !sameNodeContent(prior, node)) {
      operations.push({
        type: "node.upsert",
        expectedRevision: prior?.revision ?? deletedNodes.get(node.id)?.revision ?? null,
        node
      });
    }
  }
  for (const edge of current.edges) {
    const prior = acknowledgedEdges.get(edge.id);
    if (!prior || !sameEdgeContent(prior, edge)) {
      operations.push({
        type: "edge.upsert",
        expectedRevision: prior?.revision ?? deletedEdges.get(edge.id)?.revision ?? null,
        edge
      });
    }
  }
  return operations;
}

function reapplyOperations(
  serverGraph: CanvasGraph,
  operations: readonly CanvasMutationOperation[]
): CanvasGraph | null {
  let nodes = [...serverGraph.nodes];
  let edges = [...serverGraph.edges];
  for (const operation of operations) {
    if (operation.type === "edge.delete") {
      edges = edges.filter((edge) => edge.id !== operation.edgeId);
    } else if (operation.type === "node.delete") {
      nodes = nodes
        .filter((node) => node.id !== operation.nodeId)
        .map((node) =>
          node.parentId === operation.nodeId ? { ...node, parentId: null } : node
        );
      edges = edges.filter(
        (edge) => edge.sourceId !== operation.nodeId && edge.targetId !== operation.nodeId
      );
    } else if (operation.type === "node.upsert") {
      const serverNode = nodes.find((node) => node.id === operation.node.id);
      const reapplied = {
        ...operation.node,
        revision: serverNode?.revision ?? operation.node.revision
      };
      nodes = [...nodes.filter((node) => node.id !== reapplied.id), reapplied];
    } else {
      const serverEdge = edges.find((edge) => edge.id === operation.edge.id);
      const reapplied = {
        ...operation.edge,
        revision: serverEdge?.revision ?? operation.edge.revision
      };
      edges = [...edges.filter((edge) => edge.id !== reapplied.id), reapplied];
    }
  }
  const parsed = canvasGraphSchema.safeParse({ nodes, edges });
  return parsed.success ? parsed.data : null;
}

function isTypingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
  );
}

async function sha256Hex(file: File): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

async function apiErrorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: { message?: string } };
    return body.error?.message ?? "来源处理请求失败。";
  } catch {
    return "来源处理请求失败。";
  }
}

export function PersistentCanvasEditor({
  boardId,
  initialSnapshot
}: PersistentCanvasEditorProps) {
  const [graph, setGraph] = useState<CanvasGraph>(initialSnapshot.graph);
  const [deleted, setDeleted] = useState(initialSnapshot.deleted);
  const [selectedIds, setSelectedIds] = useState<readonly string[]>([]);
  const [focusNodeId, setFocusNodeId] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [message, setMessage] = useState<string | null>(null);
  const [past, setPast] = useState<CanvasGraph[]>([]);
  const [future, setFuture] = useState<CanvasGraph[]>([]);
  const [savePulse, setSavePulse] = useState(0);
  const [displayRevision, setDisplayRevision] = useState(initialSnapshot.boardRevision);
  const [latestConflictRevision, setLatestConflictRevision] = useState<number | null>(null);
  const [ingestions, setIngestions] = useState<readonly IngestionStatus[]>([]);
  const [sourceFile, setSourceFile] = useState<{
    readonly nodeId: string;
    readonly file: File;
  } | null>(null);
  const [sourceActionState, setSourceActionState] = useState<SourceActionState>("idle");

  const graphRef = useRef(graph);
  const acknowledgedGraphRef = useRef(initialSnapshot.graph);
  const knownDeletedRef = useRef(initialSnapshot.deleted);
  const versionRef = useRef(0);
  const baseRevisionRef = useRef(initialSnapshot.boardRevision);
  const savingRef = useRef(false);
  const queuedSaveRef = useRef(false);
  const pendingMutationRef = useRef<{
    version: number;
    mutationId: string;
    baseBoardRevision: number;
    operations: CanvasMutationOperation[];
  } | null>(null);

  const refreshIngestions = useCallback(async () => {
    const response = await fetch(`/api/boards/${boardId}/ingestions`, {
      cache: "no-store"
    });
    if (!response.ok) throw new Error("Ingestion status load failed");
    const parsed = ingestionStatusListSchema.parse(await response.json());
    setIngestions(parsed.ingestions);
  }, [boardId]);

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        await refreshIngestions();
      } catch {
        if (!cancelled) setMessage("暂时无法更新来源处理状态。");
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 2_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [refreshIngestions]);

  const commitGraph = useCallback(
    (next: CanvasGraph, options: { remember?: boolean; notice?: string } = {}) => {
      const current = graphRef.current;
      if (sameGraph(current, next)) return;
      if (options.remember !== false) {
        setPast((items) => [...items.slice(-49), current]);
        setFuture([]);
      }
      graphRef.current = next;
      versionRef.current += 1;
      pendingMutationRef.current = null;
      setGraph(next);
      setSaveState("dirty");
      setMessage(options.notice ?? null);
      setSavePulse((value) => value + 1);
    },
    []
  );

  const addNode = useCallback(
    (kind: CanvasNodeKind) => {
      const current = graphRef.current;
      if (current.nodes.length >= PHASE_1_LIMITS.canvas.maxNodesPerBoard) {
        setMessage(`每个 Board 最多 ${PHASE_1_LIMITS.canvas.maxNodesPerBoard} 个节点。`);
        return;
      }
      const index = current.nodes.length + 1;
      const node: CanvasNode = {
        id: crypto.randomUUID(),
        kind,
        parentId: null,
        position: {
          x: 520 + ((index - 1) % 4) * 270,
          y: 80 + Math.floor((index - 1) / 4) * 190
        },
        size: kind === "group" ? { width: 520, height: 320 } : { width: 230, height: 145 },
        payload: defaultPayload(kind, index),
        revision: 0
      };
      commitGraph({ ...current, nodes: [...current.nodes, node] });
      setSelectedIds([node.id]);
      setFocusNodeId(node.id);
    },
    [commitGraph]
  );

  const deleteNodes = useCallback(
    (nodeIds: readonly string[]) => {
      if (nodeIds.length === 0) return;
      const current = graphRef.current;
      const requestedIds = new Set(nodeIds);
      const removedGroupIds = new Set(
        current.nodes
          .filter((node) => requestedIds.has(node.id) && node.kind === "group")
          .map((node) => node.id)
      );
      const ids = new Set(
        nodeIds.filter((id) => {
          const node = current.nodes.find((candidate) => candidate.id === id);
          return !node?.parentId || !removedGroupIds.has(node.parentId);
        })
      );
      const removedNodes = current.nodes.filter((node) => ids.has(node.id));
      if (removedNodes.length === 0) return;
      const removedEdges = current.edges.filter(
        (edge) => ids.has(edge.sourceId) || ids.has(edge.targetId)
      );
      const now = new Date().toISOString();
      const nextNodes = current.nodes
        .filter((node) => !ids.has(node.id))
        .map((node) =>
          node.parentId && ids.has(node.parentId) ? { ...node, parentId: null } : node
        );
      commitGraph({
        nodes: nextNodes,
        edges: current.edges.filter((edge) => !removedEdges.includes(edge))
      });
      setDeleted((items) => ({
        nodes: [
          ...items.nodes.filter((node) => !ids.has(node.id)),
          ...removedNodes.map((node) => ({ ...node, deletedAt: now }))
        ],
        edges: [
          ...items.edges.filter((edge) => !removedEdges.some(({ id }) => id === edge.id)),
          ...removedEdges.map((edge) => ({ ...edge, deletedAt: now }))
        ]
      }));
      setSelectedIds([]);
      setMessage(
        removedNodes.some((node) => node.kind === "group")
          ? "分组已移至最近删除，其子节点已安全取消分组。"
          : "节点已移至最近删除。"
      );
    },
    [commitGraph]
  );

  const deleteEdges = useCallback(
    (edgeIds: readonly string[]) => {
      const current = graphRef.current;
      const ids = new Set(edgeIds);
      const removed = current.edges.filter((edge) => ids.has(edge.id));
      if (removed.length === 0) return;
      const now = new Date().toISOString();
      commitGraph({
        ...current,
        edges: current.edges.filter((edge) => !ids.has(edge.id))
      });
      setDeleted((items) => ({
        ...items,
        edges: [
          ...items.edges.filter((edge) => !ids.has(edge.id)),
          ...removed.map((edge) => ({ ...edge, deletedAt: now }))
        ]
      }));
    },
    [commitGraph]
  );

  const updateGeometry = useCallback(
    (nodeId: string, position: CanvasNode["position"], size: CanvasNode["size"]) => {
      const current = graphRef.current;
      const moved = current.nodes.find((node) => node.id === nodeId);
      if (!moved) return;
      const delta = { x: position.x - moved.position.x, y: position.y - moved.position.y };
      commitGraph({
        ...current,
        nodes: current.nodes.map((node) => {
          if (node.id === nodeId) return { ...node, position, size };
          if (moved.kind === "group" && node.parentId === moved.id) {
            return {
              ...node,
              position: {
                x: node.position.x + delta.x,
                y: node.position.y + delta.y
              }
            };
          }
          return node;
        })
      });
    },
    [commitGraph]
  );

  const connectNodes = useCallback(
    (sourceId: string, targetId: string) => {
      const current = graphRef.current;
      const next: CanvasGraph = {
        ...current,
        edges: [
          ...current.edges,
          {
            id: crypto.randomUUID(),
            sourceId,
            targetId,
            relation: "context",
            rank: current.edges.length,
            revision: 0
          }
        ]
      };
      const parsed = canvasGraphSchema.safeParse(next);
      if (!parsed.success) {
        setMessage("连接无效：来源节点或分组只能连接到 AI 对话，且不能重复连接。");
        return;
      }
      commitGraph(parsed.data);
    },
    [commitGraph]
  );

  const groupSelection = useCallback(() => {
    const current = graphRef.current;
    const chosen = current.nodes.filter(
      (node) =>
        selectedIds.includes(node.id) && node.kind !== "group" && node.kind !== "chat"
    );
    if (chosen.length === 0) {
      setMessage("请选择至少一个便笺、文本或来源节点进行分组。对话节点不能分组。");
      return;
    }
    const minX = Math.min(...chosen.map((node) => node.position.x));
    const minY = Math.min(...chosen.map((node) => node.position.y));
    const maxX = Math.max(...chosen.map((node) => node.position.x + node.size.width));
    const maxY = Math.max(...chosen.map((node) => node.position.y + node.size.height));
    const groupId = crypto.randomUUID();
    const group: CanvasNode = {
      id: groupId,
      kind: "group",
      parentId: null,
      position: { x: minX - 36, y: minY - 58 },
      size: {
        width: Math.max(300, maxX - minX + 72),
        height: Math.max(220, maxY - minY + 94)
      },
      payload: defaultPayload("group", current.nodes.length + 1),
      revision: 0
    };
    const chosenIds = new Set(chosen.map((node) => node.id));
    commitGraph({
      ...current,
      nodes: [
        group,
        ...current.nodes.map((node) =>
          chosenIds.has(node.id) ? { ...node, parentId: groupId } : node
        )
      ]
    });
    setSelectedIds([groupId]);
    setFocusNodeId(groupId);
  }, [commitGraph, selectedIds]);

  const ungroupSelection = useCallback(() => {
    const current = graphRef.current;
    const groups = new Set(
      current.nodes
        .filter((node) => selectedIds.includes(node.id) && node.kind === "group")
        .map((node) => node.id)
    );
    if (groups.size === 0) {
      setMessage("请选择一个分组。取消分组会保留其中的所有节点。");
      return;
    }
    commitGraph({
      ...current,
      nodes: current.nodes.map((node) =>
        node.parentId && groups.has(node.parentId) ? { ...node, parentId: null } : node
      )
    });
  }, [commitGraph, selectedIds]);

  const undo = useCallback(() => {
    const previous = past.at(-1);
    if (!previous) return;
    const current = graphRef.current;
    setPast((items) => items.slice(0, -1));
    setFuture((items) => [current, ...items].slice(0, 50));
    commitGraph(previous, { remember: false });
  }, [commitGraph, past]);

  const redo = useCallback(() => {
    const next = future[0];
    if (!next) return;
    const current = graphRef.current;
    setFuture((items) => items.slice(1));
    setPast((items) => [...items.slice(-49), current]);
    commitGraph(next, { remember: false });
  }, [commitGraph, future]);

  const save = useCallback(async () => {
    if (savingRef.current) {
      queuedSaveRef.current = true;
      return;
    }
    const version = versionRef.current;
    const currentGraph = graphRef.current;
    const parsedGraph = canvasGraphSchema.safeParse(currentGraph);
    if (!parsedGraph.success) {
      setSaveState("failed");
      setMessage("当前内容尚未通过校验，请检查 URL、标题或连接后重试。");
      return;
    }
    const operations = buildOperations(
      acknowledgedGraphRef.current,
      parsedGraph.data,
      knownDeletedRef.current
    );
    if (operations.length === 0) {
      setSaveState("saved");
      setMessage(null);
      return;
    }
    if (operations.length > PHASE_1_LIMITS.canvas.mutationBatchOperations) {
      setSaveState("failed");
      setMessage(
        `一次最多保存 ${PHASE_1_LIMITS.canvas.mutationBatchOperations} 项变更，请撤销本次大型操作后分批完成。`
      );
      return;
    }
    const pending = pendingMutationRef.current;
    const command =
      pending && pending.version === version
        ? pending
        : {
            version,
            mutationId: crypto.randomUUID(),
            baseBoardRevision: baseRevisionRef.current,
            operations
          };
    pendingMutationRef.current = command;
    savingRef.current = true;
    queuedSaveRef.current = false;
    setSaveState("saving");
    try {
      const response = await fetch(`/api/boards/${boardId}/canvas`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(command)
      });
      const body: unknown = await response.json();
      if (response.status === 409) {
        const latestRevision =
          typeof body === "object" &&
          body &&
          "error" in body &&
          typeof body.error === "object" &&
          body.error &&
          "latestRevision" in body.error
            ? Number(body.error.latestRevision)
            : baseRevisionRef.current;
        setLatestConflictRevision(latestRevision);
        setSaveState("conflict");
        setMessage("服务器上有更新。你的本地编辑仍被保留，请选择处理方式。");
        return;
      }
      if (!response.ok) throw new Error("Canvas save failed");
      const result = canvasSaveResultSchema.parse(
        typeof body === "object" && body && "result" in body ? body.result : undefined
      );
      baseRevisionRef.current = result.boardRevision;
      setDisplayRevision(result.boardRevision);
      acknowledgedGraphRef.current = result.graph;
      knownDeletedRef.current = result.deleted;
      pendingMutationRef.current = null;
      if (versionRef.current === version) {
        graphRef.current = result.graph;
        setGraph(result.graph);
        setDeleted(result.deleted);
        setSaveState("saved");
        setMessage(null);
      } else {
        setSaveState("dirty");
        queuedSaveRef.current = true;
      }
    } catch {
      setSaveState("failed");
      setMessage("保存失败。本地编辑仍在当前页面中，请检查网络后重试。");
    } finally {
      savingRef.current = false;
      if (queuedSaveRef.current) setSavePulse((value) => value + 1);
    }
  }, [boardId]);

  useEffect(() => {
    if (saveState !== "dirty") return;
    const timer = window.setTimeout(
      () => void save(),
      PHASE_1_LIMITS.canvas.autosaveDebounceMs
    );
    return () => window.clearTimeout(timer);
  }, [save, savePulse, saveState]);

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (saveState === "saved") return;
      event.preventDefault();
      event.returnValue = true;
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [saveState]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return;
      const modifier = event.metaKey || event.ctrlKey;
      if (modifier && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [redo, undo]);

  const loadServerVersion = useCallback(async () => {
    try {
      const response = await fetch(`/api/boards/${boardId}/canvas`);
      if (!response.ok) throw new Error("Canvas load failed");
      const body: unknown = await response.json();
      const snapshot = canvasSnapshotSchema.parse(
        typeof body === "object" && body && "snapshot" in body ? body.snapshot : undefined
      );
      graphRef.current = snapshot.graph;
      acknowledgedGraphRef.current = snapshot.graph;
      knownDeletedRef.current = snapshot.deleted;
      versionRef.current += 1;
      baseRevisionRef.current = snapshot.boardRevision;
      setDisplayRevision(snapshot.boardRevision);
      pendingMutationRef.current = null;
      setGraph(snapshot.graph);
      setDeleted(snapshot.deleted);
      setPast([]);
      setFuture([]);
      setSaveState("saved");
      setLatestConflictRevision(null);
      setMessage("已载入服务器版本。");
    } catch {
      setMessage("无法载入服务器版本，请检查网络后重试。");
    }
  }, [boardId]);

  const retryConflict = useCallback(async () => {
    if (latestConflictRevision === null) return;
    const localOperations = buildOperations(
      acknowledgedGraphRef.current,
      graphRef.current,
      knownDeletedRef.current
    );
    try {
      const response = await fetch(`/api/boards/${boardId}/canvas`);
      if (!response.ok) throw new Error("Canvas load failed");
      const body: unknown = await response.json();
      const snapshot = canvasSnapshotSchema.parse(
        typeof body === "object" && body && "snapshot" in body ? body.snapshot : undefined
      );
      const mergedGraph = reapplyOperations(snapshot.graph, localOperations);
      if (!mergedGraph) {
        setMessage(
          "最新服务器结构与本地编辑无法安全合并。请使用服务器版本，或保留当前页面后手动复制内容。"
        );
        return;
      }
      acknowledgedGraphRef.current = snapshot.graph;
      knownDeletedRef.current = snapshot.deleted;
      baseRevisionRef.current = snapshot.boardRevision;
      graphRef.current = mergedGraph;
      versionRef.current += 1;
      pendingMutationRef.current = null;
      setGraph(mergedGraph);
      setLatestConflictRevision(null);
      setSaveState("dirty");
      setMessage("已取得最新修订，正在把保留的本地编辑重新应用到同一记录。 ");
      setSavePulse((value) => value + 1);
    } catch {
      setMessage("无法取得最新修订；本地编辑仍然保留，请检查网络后重试。");
    }
  }, [boardId, latestConflictRevision]);

  const restoreNode = useCallback(
    (nodeId: string) => {
      const deletedNode = deleted.nodes.find((node) => node.id === nodeId);
      if (!deletedNode) return;
      const current = graphRef.current;
      const activeIds = new Set([...current.nodes.map((node) => node.id), deletedNode.id]);
      const restoredNode: CanvasNode = {
        ...deletedNode,
        parentId:
          deletedNode.parentId && activeIds.has(deletedNode.parentId)
            ? deletedNode.parentId
            : null
      };
      let next: CanvasGraph = { ...current, nodes: [...current.nodes, restoredNode] };
      const restoredEdgeIds = new Set<string>();
      for (const edge of deleted.edges) {
        if (!activeIds.has(edge.sourceId) || !activeIds.has(edge.targetId)) continue;
        const candidate: CanvasEdge = {
          id: edge.id,
          sourceId: edge.sourceId,
          targetId: edge.targetId,
          relation: edge.relation,
          rank: edge.rank,
          revision: edge.revision
        };
        const parsed = canvasGraphSchema.safeParse({
          ...next,
          edges: [...next.edges, candidate]
        });
        if (parsed.success) {
          next = parsed.data;
          restoredEdgeIds.add(edge.id);
        }
      }
      commitGraph(next, {
        notice:
          restoredEdgeIds.size > 0
            ? `节点和 ${restoredEdgeIds.size} 条有效连接已恢复。`
            : "节点已恢复；无效或端点缺失的连接保持在最近删除中。"
      });
      setDeleted((items) => ({
        nodes: items.nodes.filter((node) => node.id !== nodeId),
        edges: items.edges.filter((edge) => !restoredEdgeIds.has(edge.id))
      }));
      setSelectedIds([nodeId]);
      setFocusNodeId(nodeId);
    },
    [commitGraph, deleted]
  );

  const selectedNode = useMemo(
    () => graph.nodes.find((node) => node.id === selectedIds[0]) ?? null,
    [graph.nodes, selectedIds]
  );

  const latestIngestionByNode = useMemo(() => {
    const values = new Map<string, IngestionStatus>();
    for (const ingestion of ingestions) {
      if (!values.has(ingestion.nodeId)) values.set(ingestion.nodeId, ingestion);
    }
    return values;
  }, [ingestions]);
  const selectedIngestion = selectedNode
    ? (latestIngestionByNode.get(selectedNode.id) ?? null)
    : null;
  const displayGraph = useMemo<CanvasGraph>(
    () => ({
      ...graph,
      nodes: graph.nodes.map((node) => {
        const ingestion = latestIngestionByNode.get(node.id);
        if (!ingestion) return node;
        const status =
          ingestion.status === "queued"
            ? "queued"
            : ingestion.status === "running"
              ? "processing"
              : ingestion.status === "succeeded"
                ? ingestion.warnings.length > 0
                  ? "ready_with_warning"
                  : "ready"
                : ingestion.status === "failed" || ingestion.status === "cancelled"
                  ? "failed"
                  : node.payload.status;
        return {
          ...node,
          payload: {
            ...node.payload,
            status,
            progress:
              ingestion.status === "queued" || ingestion.status === "running"
                ? ingestion.progress
                : null
          }
        } as CanvasNode;
      })
    }),
    [graph, latestIngestionByNode]
  );

  const uploadSourceFile = useCallback(async () => {
    if (
      !selectedNode ||
      selectedNode.payload.kind !== "pdf" ||
      !sourceFile ||
      sourceFile.nodeId !== selectedNode.id
    ) {
      return;
    }
    if (saveState !== "saved") {
      setMessage("请等待节点保存完成后再上传。");
      return;
    }
    setSourceActionState("uploading");
    setMessage(null);
    try {
      const file = sourceFile.file;
      const mimeType =
        file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")
          ? "application/pdf"
          : "text/plain";
      const checksumSha256 = await sha256Hex(file);
      const intentResponse = await fetch(
        `/api/boards/${boardId}/ingestions/upload-intents`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            mutationId: crypto.randomUUID(),
            nodeId: selectedNode.id,
            fileName: file.name,
            mimeType,
            size: file.size,
            checksumSha256
          })
        }
      );
      if (!intentResponse.ok) throw new Error(await apiErrorMessage(intentResponse));
      const intent = (await intentResponse.json()) as {
        assetId: string;
        uploadUrl: string;
        uploadHeaders: Record<string, string>;
      };
      const uploadResponse = await fetch(intent.uploadUrl, {
        method: "PUT",
        headers: intent.uploadHeaders,
        body: file
      });
      if (!uploadResponse.ok) throw new Error("文件上传失败，请检查对象存储服务。");
      const completionResponse = await fetch(
        `/api/boards/${boardId}/ingestions/uploads/complete`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            mutationId: crypto.randomUUID(),
            assetId: intent.assetId,
            nodeId: selectedNode.id
          })
        }
      );
      if (!completionResponse.ok) {
        throw new Error(await apiErrorMessage(completionResponse));
      }
      await refreshIngestions();
      setMessage("文件已上传，正在后台提取内容。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "文件上传失败。");
    } finally {
      setSourceActionState("idle");
    }
  }, [boardId, refreshIngestions, saveState, selectedNode, sourceFile]);

  const submitRemoteSource = useCallback(async () => {
    if (
      !selectedNode ||
      (selectedNode.payload.kind !== "webpage" && selectedNode.payload.kind !== "video")
    ) {
      return;
    }
    if (saveState !== "saved") {
      setMessage("请等待节点保存完成后再导入网址。");
      return;
    }
    setSourceActionState("submitting");
    try {
      const response = await fetch(`/api/boards/${boardId}/ingestions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mutationId: crypto.randomUUID(),
          nodeId: selectedNode.id,
          url: selectedNode.payload.url
        })
      });
      if (!response.ok) throw new Error(await apiErrorMessage(response));
      await refreshIngestions();
      setMessage("网址已加入处理队列。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "网址导入失败。");
    } finally {
      setSourceActionState("idle");
    }
  }, [boardId, refreshIngestions, saveState, selectedNode]);

  const retrySelectedIngestion = useCallback(async () => {
    if (!selectedIngestion?.error?.retryable) return;
    setSourceActionState("retrying");
    try {
      const response = await fetch(
        `/api/boards/${boardId}/ingestions/${selectedIngestion.id}/retry`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ mutationId: crypto.randomUUID() })
        }
      );
      if (!response.ok) throw new Error(await apiErrorMessage(response));
      await refreshIngestions();
      setMessage("已重新加入处理队列。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "重试失败。");
    } finally {
      setSourceActionState("idle");
    }
  }, [boardId, refreshIngestions, selectedIngestion]);

  const updatePayload = useCallback(
    (payload: CanvasNodePayload) => {
      if (!selectedNode) return;
      const current = graphRef.current;
      commitGraph({
        ...current,
        nodes: current.nodes.map((node) =>
          node.id === selectedNode.id ? { ...node, payload } : node
        )
      });
    },
    [commitGraph, selectedNode]
  );

  const updateKindPayload = useCallback(
    (field: "body" | "url" | "fileName" | "prompt" | "description", value: string) => {
      const payload = selectedNode?.payload;
      if (!payload) return;
      if (field === "body" && (payload.kind === "note" || payload.kind === "text")) {
        updatePayload({ ...payload, body: value });
      } else if (
        field === "url" &&
        (payload.kind === "webpage" || payload.kind === "video")
      ) {
        updatePayload({ ...payload, url: value });
      } else if (field === "fileName" && payload.kind === "pdf") {
        updatePayload({ ...payload, fileName: value });
      } else if (field === "prompt" && payload.kind === "chat") {
        updatePayload({ ...payload, prompt: value });
      } else if (field === "description" && payload.kind === "group") {
        updatePayload({ ...payload, description: value });
      }
    },
    [selectedNode, updatePayload]
  );

  return (
    <section className="m2-editor" aria-label="Board 画布编辑器">
      <header className="m2-toolbar">
        <div className="m2-toolbar__nodes" aria-label="添加节点">
          {NODE_TOOLS.map(({ kind, icon: Icon }) => (
            <button
              key={kind}
              type="button"
              onClick={() => addNode(kind)}
              aria-label={KIND_LABELS[kind]}
              title={`添加${KIND_LABELS[kind]}`}
            >
              <Icon size={15} />
              <span>{KIND_LABELS[kind]}</span>
            </button>
          ))}
        </div>
        <div className="m2-toolbar__actions">
          <button
            type="button"
            onClick={groupSelection}
            aria-label="组合"
            title="组合所选节点"
          >
            <FolderPlus size={15} /> <span>组合</span>
          </button>
          <button
            type="button"
            onClick={ungroupSelection}
            aria-label="解组"
            title="取消所选分组"
          >
            <PanelRightClose size={15} /> <span>解组</span>
          </button>
          <button
            type="button"
            onClick={undo}
            disabled={past.length === 0}
            suppressHydrationWarning
            title="撤销 (⌘Z)"
          >
            <Undo2 size={15} />
          </button>
          <button
            type="button"
            onClick={redo}
            disabled={future.length === 0}
            suppressHydrationWarning
            title="重做 (⇧⌘Z)"
          >
            <Redo2 size={15} />
          </button>
        </div>
      </header>

      <div className="m2-workspace">
        <aside className="m2-outline" aria-label="语义化 Board 大纲">
          <div className="m2-panel-heading">
            <div>
              <span className="eyebrow">Board outline</span>
              <strong>{graph.nodes.length} 个节点</strong>
            </div>
            <Link2 size={15} />
          </div>
          <ol>
            {graph.nodes.length === 0 ? (
              <li className="m2-empty">从上方工具栏添加第一个节点。</li>
            ) : (
              graph.nodes.map((node) => (
                <li
                  key={node.id}
                  className={selectedIds.includes(node.id) ? "is-selected" : ""}
                >
                  <button
                    type="button"
                    onClick={(event) => {
                      setSelectedIds((current) => {
                        if (!(event.shiftKey || event.metaKey || event.ctrlKey))
                          return [node.id];
                        return current.includes(node.id)
                          ? current.filter((id) => id !== node.id)
                          : [...current, node.id];
                      });
                      setFocusNodeId(null);
                      requestAnimationFrame(() => setFocusNodeId(node.id));
                    }}
                  >
                    <ChevronRight size={13} />
                    <span>{node.payload.title}</span>
                    <small>{KIND_LABELS[node.kind]}</small>
                  </button>
                </li>
              ))
            )}
          </ol>
          <details className="m2-deleted" open={deleted.nodes.length > 0}>
            <summary>
              <Trash2 size={13} /> 最近删除 ({deleted.nodes.length})
            </summary>
            {deleted.nodes.length === 0 ? <p>暂无可恢复节点。</p> : null}
            {deleted.nodes.map((node) => (
              <div key={node.id}>
                <span>{node.payload.title}</span>
                <button type="button" onClick={() => restoreNode(node.id)}>
                  <RotateCcw size={12} /> 恢复
                </button>
              </div>
            ))}
          </details>
        </aside>

        <div className="m2-canvas-stage">
          <CanvasSurface
            graph={displayGraph}
            ariaLabel="可编辑的 Siftloom 无限画布"
            editable
            focusNodeId={focusNodeId}
            onConnect={connectNodes}
            onDeleteEdges={deleteEdges}
            onDeleteNodes={deleteNodes}
            onNodeGeometryChange={updateGeometry}
            onSelectionChange={setSelectedIds}
          />
          <div
            className={`m2-save-state m2-save-state--${saveState}`}
            role="status"
            aria-live="polite"
          >
            {saveState === "saving" ? <LoaderCircle className="spin" size={14} /> : null}
            {saveState === "saved" ? <Check size={14} /> : null}
            {saveState === "failed" || saveState === "conflict" ? (
              <AlertTriangle size={14} />
            ) : null}
            <span>
              {saveState === "saved" && `已保存 · revision ${displayRevision}`}
              {saveState === "dirty" && "等待保存"}
              {saveState === "saving" && "保存中…"}
              {saveState === "failed" && "保存失败"}
              {saveState === "conflict" && "发现版本冲突"}
            </span>
            {saveState === "failed" ? (
              <button type="button" onClick={() => void save()}>
                <RefreshCw size={12} /> 重试
              </button>
            ) : null}
          </div>
        </div>

        <aside
          className={`m2-inspector${selectedNode?.kind === "chat" ? " is-chat" : ""}`}
          aria-label="节点属性"
        >
          <div className="m2-panel-heading">
            <div>
              <span className="eyebrow">Inspector</span>
              <strong>{selectedNode ? KIND_LABELS[selectedNode.kind] : "未选择"}</strong>
            </div>
          </div>
          {selectedNode?.payload.kind === "chat" ? (
            <ChatInspector
              key={selectedNode.id}
              boardId={boardId}
              node={selectedNode as CanvasNode & { payload: { kind: "chat" } }}
              graph={displayGraph}
              canRun={saveState === "saved"}
            />
          ) : selectedNode ? (
            <div className="m2-fields">
              <label>
                标题
                <input
                  value={selectedNode.payload.title}
                  maxLength={120}
                  onChange={(event) =>
                    updatePayload({ ...selectedNode.payload, title: event.target.value })
                  }
                />
              </label>
              <label>
                摘要
                <textarea
                  value={selectedNode.payload.summary}
                  maxLength={2_000}
                  onChange={(event) =>
                    updatePayload({ ...selectedNode.payload, summary: event.target.value })
                  }
                />
              </label>
              {selectedNode.payload.kind === "note" ||
              selectedNode.payload.kind === "text" ? (
                <label>
                  正文
                  <textarea
                    value={selectedNode.payload.body}
                    onChange={(event) => updateKindPayload("body", event.target.value)}
                  />
                </label>
              ) : null}
              {selectedNode.payload.kind === "webpage" ||
              selectedNode.payload.kind === "video" ? (
                <div className="m3-source-control">
                  <label>
                    URL
                    <input
                      type="url"
                      placeholder={
                        selectedNode.payload.kind === "video"
                          ? "https://youtube.com/watch?v=…"
                          : "https://example.com/article"
                      }
                      value={selectedNode.payload.url}
                      onChange={(event) => updateKindPayload("url", event.target.value)}
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => void submitRemoteSource()}
                    disabled={
                      sourceActionState !== "idle" ||
                      saveState !== "saved" ||
                      selectedNode.payload.url.length === 0
                    }
                  >
                    {sourceActionState === "submitting" ? (
                      <LoaderCircle className="spin" size={13} />
                    ) : (
                      <Globe2 size={13} />
                    )}
                    {selectedNode.payload.kind === "video" ? "读取公开视频" : "导入网页"}
                  </button>
                  {selectedNode.payload.kind === "video" ? (
                    <small>仅读取公开 YouTube 元数据；不会下载视频或绕过字幕权限。</small>
                  ) : null}
                </div>
              ) : null}
              {selectedNode.payload.kind === "pdf" ? (
                <div className="m3-source-control">
                  <label>
                    PDF 或 TXT 文件
                    <input
                      type="file"
                      accept=".pdf,.txt,application/pdf,text/plain"
                      onChange={(event) => {
                        const file = event.target.files?.[0] ?? null;
                        setSourceFile(file ? { nodeId: selectedNode.id, file } : null);
                        if (file) updateKindPayload("fileName", file.name);
                      }}
                    />
                  </label>
                  <small>PDF 最大 25 MB / 200 页；TXT 最大 5 MB，须为 UTF-8。</small>
                  <button
                    type="button"
                    onClick={() => void uploadSourceFile()}
                    disabled={
                      !sourceFile ||
                      sourceFile.nodeId !== selectedNode.id ||
                      sourceActionState !== "idle" ||
                      saveState !== "saved"
                    }
                  >
                    {sourceActionState === "uploading" ? (
                      <LoaderCircle className="spin" size={13} />
                    ) : (
                      <Upload size={13} />
                    )}
                    上传并提取
                  </button>
                </div>
              ) : null}
              {selectedIngestion ? (
                <div className={`m3-ingestion m3-ingestion--${selectedIngestion.status}`}>
                  <div>
                    <strong>
                      {selectedIngestion.status === "queued" && "等待处理"}
                      {selectedIngestion.status === "running" && "正在提取"}
                      {selectedIngestion.status === "succeeded" && "内容已就绪"}
                      {selectedIngestion.status === "failed" && "处理失败"}
                      {selectedIngestion.status === "cancelled" && "处理已取消"}
                    </strong>
                    <span>{selectedIngestion.progress}%</span>
                  </div>
                  {(selectedIngestion.status === "queued" ||
                    selectedIngestion.status === "running") && (
                    <div className="m3-ingestion__progress">
                      <span style={{ width: `${selectedIngestion.progress}%` }} />
                    </div>
                  )}
                  {selectedIngestion.artifact ? (
                    <p>
                      {selectedIngestion.artifact.segmentCount} 个片段 ·{" "}
                      {selectedIngestion.artifact.extractedCharacters.toLocaleString()} 字符
                    </p>
                  ) : null}
                  {selectedIngestion.warnings.includes("transcript_unavailable") ? (
                    <p>公开视频字幕不可用；当前仅保存元数据。你可上传有权处理的文字稿。</p>
                  ) : null}
                  {selectedIngestion.error ? (
                    <p role="alert">{selectedIngestion.error.message}</p>
                  ) : null}
                  {selectedIngestion.error?.retryable ? (
                    <button
                      type="button"
                      onClick={() => void retrySelectedIngestion()}
                      disabled={sourceActionState !== "idle"}
                    >
                      <RefreshCw size={13} /> 重试处理
                    </button>
                  ) : null}
                </div>
              ) : null}
              {selectedNode.payload.kind === "group" ? (
                <label>
                  分组说明
                  <textarea
                    value={selectedNode.payload.description}
                    onChange={(event) =>
                      updateKindPayload("description", event.target.value)
                    }
                  />
                </label>
              ) : null}
              {selectedNode.kind !== "chat" &&
              graph.nodes.some((node) => node.kind === "chat") ? (
                <div className="m2-connection-actions">
                  <span>连接到 AI 对话</span>
                  {graph.nodes
                    .filter((node) => node.kind === "chat")
                    .map((chatNode) => {
                      const connected = graph.edges.some(
                        (edge) =>
                          edge.sourceId === selectedNode.id && edge.targetId === chatNode.id
                      );
                      return (
                        <button
                          key={chatNode.id}
                          type="button"
                          disabled={connected}
                          onClick={() => connectNodes(selectedNode.id, chatNode.id)}
                        >
                          <Link2 size={13} />
                          {connected
                            ? `已连接 ${chatNode.payload.title}`
                            : `连接到 ${chatNode.payload.title}`}
                        </button>
                      );
                    })}
                </div>
              ) : null}
              <button
                className="m2-delete-button"
                type="button"
                onClick={() => deleteNodes([selectedNode.id])}
              >
                <Trash2 size={14} /> 移至最近删除
              </button>
            </div>
          ) : (
            <p className="m2-empty">
              选择画布节点或从左侧大纲定位。拖动节点边缘可调整大小。
            </p>
          )}
        </aside>
      </div>

      {message ? (
        <div
          className={`m2-message${saveState === "conflict" ? " is-conflict" : ""}`}
          role="alert"
        >
          <span>{message}</span>
          {saveState === "conflict" ? (
            <div>
              <button type="button" onClick={() => void loadServerVersion()}>
                使用服务器版本
              </button>
              <button type="button" onClick={() => void retryConflict()}>
                保留本地并重试
              </button>
            </div>
          ) : (
            <button type="button" onClick={() => setMessage(null)}>
              关闭
            </button>
          )}
        </div>
      ) : null}
    </section>
  );
}
