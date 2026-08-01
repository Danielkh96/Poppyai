"use client";

import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type PointerEvent as ReactPointerEvent
} from "react";
import {
  AlignLeft,
  CheckCircle2,
  FileText,
  FolderTree,
  Globe2,
  LoaderCircle,
  MessageSquareText,
  StickyNote,
  Video
} from "lucide-react";
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  NodeResizer,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
  type Node,
  type NodeProps
} from "@xyflow/react";

import type { CanvasGraph, CanvasNode, CanvasNodeKind } from "@siftloom/shared";

interface CanvasNodeData extends Record<string, unknown> {
  readonly node: CanvasNode;
  readonly editable: boolean;
  readonly onResizeEnd?: (
    nodeId: string,
    position: CanvasNode["position"],
    size: CanvasNode["size"]
  ) => void;
}

type FlowNode = Node<CanvasNodeData, "siftloom">;
type FlowEdge = Edge<Record<string, never>>;

export interface CanvasBenchmarkResult {
  readonly durationMs: number;
  readonly nodeCount: number;
  readonly edgeCount: number;
  readonly sampledFrames: number;
  readonly p95FrameTimeMs: number;
  readonly framesWithin20msPercent: number;
  readonly pointerToPaintP95Ms: number | null;
  readonly longestTaskMs: number;
  readonly stateUpdateCycles: number;
  readonly heapStartBytes: number | null;
  readonly heapEndBytes: number | null;
  readonly heapGrowthPercent: number | null;
}

export interface CanvasBenchmarkController {
  run(durationMs?: number, holdUntilFinalized?: boolean): Promise<CanvasBenchmarkResult>;
  finalize(): void;
  readonly isRunning: boolean;
  readonly latest: CanvasBenchmarkResult | null;
}

declare global {
  interface Window {
    __SIFTLOOM_BENCHMARK__?: CanvasBenchmarkController;
  }
}

export interface CanvasSurfaceProps {
  readonly graph: CanvasGraph;
  readonly ariaLabel: string;
  readonly benchmarkEnabled?: boolean;
  readonly editable?: boolean;
  readonly focusNodeId?: string | null;
  readonly onConnect?: (sourceId: string, targetId: string) => void;
  readonly onDeleteEdges?: (edgeIds: readonly string[]) => void;
  readonly onDeleteNodes?: (nodeIds: readonly string[]) => void;
  readonly onNodeGeometryChange?: (
    nodeId: string,
    position: CanvasNode["position"],
    size: CanvasNode["size"]
  ) => void;
  readonly onSelectionChange?: (nodeIds: readonly string[]) => void;
}

const NODE_ICONS: Record<
  CanvasNodeKind,
  ComponentType<{ size?: number; strokeWidth?: number }>
> = {
  note: StickyNote,
  text: AlignLeft,
  pdf: FileText,
  webpage: Globe2,
  video: Video,
  chat: MessageSquareText,
  group: FolderTree
};

function NodeCardComponent({ data, selected }: NodeProps<FlowNode>) {
  const node = data.node;
  const payload = node.payload;
  const Icon = NODE_ICONS[node.kind];
  const isBusy = payload.status === "processing" || payload.status === "streaming";

  return (
    <article
      className={`canvas-node canvas-node--${node.kind}${selected ? " is-selected" : ""}`}
      aria-label={`${payload.title}，${payload.status}`}
    >
      <NodeResizer
        color="#1746d1"
        isVisible={selected && data.editable}
        minWidth={80}
        minHeight={60}
        maxWidth={4_000}
        maxHeight={4_000}
        onResizeEnd={(_event, parameters) =>
          data.onResizeEnd?.(
            node.id,
            { x: parameters.x, y: parameters.y },
            { width: parameters.width, height: parameters.height }
          )
        }
      />
      <Handle type="target" position={Position.Left} className="canvas-handle" />
      <div className="canvas-node__header">
        <span className="canvas-node__icon" aria-hidden="true">
          <Icon size={15} strokeWidth={1.8} />
        </span>
        <span className="canvas-node__kind">{node.kind}</span>
        <span className={`canvas-node__status canvas-node__status--${payload.status}`}>
          {isBusy ? (
            <LoaderCircle size={12} className="spin" aria-hidden="true" />
          ) : (
            <CheckCircle2 size={12} aria-hidden="true" />
          )}
          {payload.status === "streaming"
            ? "生成中"
            : payload.status === "processing"
              ? "处理中"
              : "已就绪"}
        </span>
      </div>
      <h3>{payload.title}</h3>
      <p>{payload.summary}</p>
      {payload.progress !== null ? (
        <div className="canvas-node__progress" aria-label={`处理进度 ${payload.progress}%`}>
          <span style={{ width: `${payload.progress}%` }} />
        </div>
      ) : null}
      <footer>
        <span>rev {node.revision}</span>
        <span>{node.kind === "chat" ? "显式来源" : "已记录来源"}</span>
      </footer>
      <Handle type="source" position={Position.Right} className="canvas-handle" />
    </article>
  );
}

const NodeCard = memo(NodeCardComponent);
const NODE_TYPES = { siftloom: NodeCard };

function mapNodes(
  graph: CanvasGraph,
  editable = false,
  onResizeEnd?: CanvasNodeData["onResizeEnd"]
): FlowNode[] {
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  return [...graph.nodes]
    .sort((left, right) => Number(left.parentId !== null) - Number(right.parentId !== null))
    .map((node) => {
      const parent = node.parentId ? nodesById.get(node.parentId) : undefined;
      const parentProperties = parent
        ? { parentId: parent.id, extent: "parent" as const }
        : {};
      return {
        id: node.id,
        type: "siftloom",
        position: parent
          ? {
              x: node.position.x - parent.position.x,
              y: node.position.y - parent.position.y
            }
          : node.position,
        width: node.size.width,
        height: node.size.height,
        ...parentProperties,
        data: {
          node,
          editable,
          ...(onResizeEnd
            ? {
                onResizeEnd: (
                  nodeId: string,
                  position: CanvasNode["position"],
                  size: CanvasNode["size"]
                ) =>
                  onResizeEnd(
                    nodeId,
                    parent
                      ? {
                          x: parent.position.x + position.x,
                          y: parent.position.y + position.y
                        }
                      : position,
                    size
                  )
              }
            : {})
        },
        style: { width: node.size.width, height: node.size.height },
        zIndex: node.kind === "group" ? -1 : 0
      };
    });
}

function mapEdges(graph: CanvasGraph): FlowEdge[] {
  return graph.edges.map((edge) => ({
    id: edge.id,
    type: "smoothstep",
    source: edge.sourceId,
    target: edge.targetId,
    data: {},
    className: "canvas-edge"
  }));
}

function percentile(values: readonly number[], fraction: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1);
  return sorted[Math.max(0, index)] ?? 0;
}

interface ChromePerformanceMemory {
  readonly usedJSHeapSize: number;
}

function readHeapSize(): number | null {
  const extended = performance as Performance & {
    readonly memory?: ChromePerformanceMemory;
  };
  return extended.memory?.usedJSHeapSize ?? null;
}

interface InnerCanvasProps extends CanvasSurfaceProps {
  readonly initialNodes: FlowNode[];
  readonly initialEdges: FlowEdge[];
}

function InnerCanvas({
  graph,
  ariaLabel,
  benchmarkEnabled = false,
  editable = false,
  focusNodeId,
  onConnect,
  onDeleteEdges,
  onDeleteNodes,
  onNodeGeometryChange,
  onSelectionChange,
  initialNodes,
  initialEdges
}: InnerCanvasProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState<FlowNode>(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<FlowEdge>(initialEdges);
  const { getNode, getViewport, setCenter, setViewport } = useReactFlow<
    FlowNode,
    FlowEdge
  >();
  const [latest, setLatest] = useState<CanvasBenchmarkResult | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const activeRef = useRef(false);
  const finalizeRequestedRef = useRef(false);
  const pointerSamplesRef = useRef<number[]>([]);
  const runningPromiseRef = useRef<Promise<CanvasBenchmarkResult> | null>(null);

  useEffect(() => {
    if (activeRef.current) return;
    setNodes(initialNodes);
    setEdges(initialEdges);
  }, [initialEdges, initialNodes, setEdges, setNodes]);

  useEffect(() => {
    if (!focusNodeId) return;
    const node = getNode(focusNodeId);
    if (!node) return;
    const width = node.measured?.width ?? node.width ?? 220;
    const height = node.measured?.height ?? node.height ?? 140;
    const absolute = node.data.node.position;
    void setCenter(absolute.x + width / 2, absolute.y + height / 2, {
      duration: 220,
      zoom: Math.max(getViewport().zoom, 0.8)
    });
  }, [focusNodeId, getNode, getViewport, setCenter]);

  const finalize = useCallback(() => {
    finalizeRequestedRef.current = true;
  }, []);

  const run = useCallback(
    (
      requestedDurationMs = 5_000,
      holdUntilFinalized = false
    ): Promise<CanvasBenchmarkResult> => {
      if (runningPromiseRef.current) return runningPromiseRef.current;

      const durationMs = Math.max(500, Math.min(requestedDurationMs, 20 * 60_000));
      const promise = new Promise<CanvasBenchmarkResult>((resolve) => {
        const frameTimes: number[] = [];
        const longTasks: number[] = [];
        const startViewport = getViewport();
        const startedAt = performance.now();
        const heapStartBytes = readHeapSize();
        let previousFrameAt = startedAt;
        let lastStateUpdateAt = startedAt;
        let stateUpdateCycles = 0;
        let observer: PerformanceObserver | null = null;

        activeRef.current = true;
        finalizeRequestedRef.current = false;
        pointerSamplesRef.current = [];
        setIsRunning(true);

        if (typeof PerformanceObserver !== "undefined") {
          try {
            observer = new PerformanceObserver((list) => {
              for (const entry of list.getEntries()) longTasks.push(entry.duration);
            });
            observer.observe({ type: "longtask", buffered: false });
          } catch {
            observer = null;
          }
        }

        const tick = (now: number): void => {
          frameTimes.push(now - previousFrameAt);
          previousFrameAt = now;
          const elapsed = now - startedAt;

          if (now - lastStateUpdateAt >= 250) {
            lastStateUpdateAt = now;
            stateUpdateCycles += 1;
            const activityStep = stateUpdateCycles;
            setNodes((currentNodes) =>
              currentNodes.map((flowNode) => {
                const domainNode = flowNode.data.node;
                if (domainNode.payload.status === "processing") {
                  return {
                    ...flowNode,
                    data: {
                      ...flowNode.data,
                      node: {
                        ...domainNode,
                        payload: {
                          ...domainNode.payload,
                          progress: 5 + ((activityStep * 7) % 91)
                        }
                      }
                    }
                  };
                }
                if (domainNode.payload.status === "streaming") {
                  return {
                    ...flowNode,
                    data: {
                      ...flowNode.data,
                      node: {
                        ...domainNode,
                        payload: {
                          ...domainNode.payload,
                          summary: `正在生成已授权来源的可追溯回答${"·".repeat(
                            (activityStep % 3) + 1
                          )}`
                        }
                      }
                    }
                  };
                }
                return flowNode;
              })
            );
          }

          void setViewport({
            x: startViewport.x + Math.sin(elapsed / 380) * 130,
            y: startViewport.y + Math.cos(elapsed / 520) * 72,
            zoom: startViewport.zoom + Math.sin(elapsed / 900) * 0.025
          });

          const minimumDurationReached = elapsed >= durationMs;
          const mayFinish = !holdUntilFinalized || finalizeRequestedRef.current;
          if (!minimumDurationReached || !mayFinish) {
            requestAnimationFrame(tick);
            return;
          }

          observer?.disconnect();
          void setViewport(startViewport);
          setNodes(initialNodes);
          activeRef.current = false;
          setIsRunning(false);

          const measuredFrames = frameTimes.slice(2);
          const heapEndBytes = readHeapSize();
          const heapGrowthPercent =
            heapStartBytes !== null && heapEndBytes !== null && heapStartBytes > 0
              ? ((heapEndBytes - heapStartBytes) / heapStartBytes) * 100
              : null;
          const result: CanvasBenchmarkResult = {
            durationMs: Math.round(elapsed),
            nodeCount: graph.nodes.length,
            edgeCount: graph.edges.length,
            sampledFrames: measuredFrames.length,
            p95FrameTimeMs: Number(percentile(measuredFrames, 0.95).toFixed(2)),
            framesWithin20msPercent: Number(
              (
                (measuredFrames.filter((frame) => frame <= 20).length /
                  Math.max(measuredFrames.length, 1)) *
                100
              ).toFixed(2)
            ),
            pointerToPaintP95Ms:
              pointerSamplesRef.current.length > 0
                ? Number(percentile(pointerSamplesRef.current, 0.95).toFixed(2))
                : null,
            longestTaskMs: Number(Math.max(0, ...longTasks).toFixed(2)),
            stateUpdateCycles,
            heapStartBytes,
            heapEndBytes,
            heapGrowthPercent:
              heapGrowthPercent === null ? null : Number(heapGrowthPercent.toFixed(2))
          };

          setLatest(result);
          runningPromiseRef.current = null;
          resolve(result);
        };

        requestAnimationFrame(tick);
      });

      runningPromiseRef.current = promise;
      return promise;
    },
    [
      getViewport,
      graph.edges.length,
      graph.nodes.length,
      initialNodes,
      setNodes,
      setViewport
    ]
  );

  useEffect(() => {
    if (!benchmarkEnabled) return;
    window.__SIFTLOOM_BENCHMARK__ = { run, finalize, isRunning, latest };
    return () => {
      delete window.__SIFTLOOM_BENCHMARK__;
    };
  }, [benchmarkEnabled, finalize, isRunning, latest, run]);

  const handlePointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (!activeRef.current || pointerSamplesRef.current.length >= 400) return;
    const inputAt = event.timeStamp;
    requestAnimationFrame((paintAt) => {
      pointerSamplesRef.current.push(Math.max(0, paintAt - inputAt));
    });
  }, []);

  const handleNodeDragStop = useCallback(
    (_event: MouseEvent | TouchEvent, flowNode: FlowNode) => {
      if (!editable || !onNodeGeometryChange) return;
      const domainNode = flowNode.data.node;
      const parent = domainNode.parentId
        ? graph.nodes.find((node) => node.id === domainNode.parentId)
        : undefined;
      const position = parent
        ? {
            x: parent.position.x + flowNode.position.x,
            y: parent.position.y + flowNode.position.y
          }
        : flowNode.position;
      onNodeGeometryChange(flowNode.id, position, {
        width: flowNode.measured?.width ?? flowNode.width ?? domainNode.size.width,
        height: flowNode.measured?.height ?? flowNode.height ?? domainNode.size.height
      });
    },
    [editable, graph.nodes, onNodeGeometryChange]
  );

  const handleConnect = useCallback(
    (connection: Connection) => {
      if (connection.source && connection.target) {
        onConnect?.(connection.source, connection.target);
      }
    },
    [onConnect]
  );

  const handleNodesDelete = useCallback(
    (deleted: FlowNode[]) => onDeleteNodes?.(deleted.map((node) => node.id)),
    [onDeleteNodes]
  );

  const handleEdgesDelete = useCallback(
    (deleted: FlowEdge[]) => onDeleteEdges?.(deleted.map((edge) => edge.id)),
    [onDeleteEdges]
  );

  const handleSelectionChange = useCallback(
    ({ nodes: selected }: { nodes: FlowNode[]; edges: FlowEdge[] }) =>
      onSelectionChange?.(selected.map((node) => node.id)),
    [onSelectionChange]
  );

  return (
    <div
      className="canvas-shell"
      onPointerMove={handlePointerMove}
      data-testid="canvas-surface"
    >
      <ReactFlow<FlowNode, FlowEdge>
        aria-label={ariaLabel}
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeDragStop={handleNodeDragStop}
        onConnect={handleConnect}
        onNodesDelete={handleNodesDelete}
        onEdgesDelete={handleEdgesDelete}
        onSelectionChange={handleSelectionChange}
        nodesDraggable={editable || benchmarkEnabled}
        nodesConnectable={editable}
        nodesFocusable
        edgesFocusable
        deleteKeyCode={editable ? ["Backspace", "Delete"] : null}
        minZoom={0.2}
        maxZoom={1.8}
        defaultViewport={{ x: 34, y: 38, zoom: 0.55 }}
        onlyRenderVisibleElements
        elevateNodesOnSelect
        proOptions={{ hideAttribution: false }}
      >
        <Background variant={BackgroundVariant.Dots} gap={24} size={1.2} color="#cbc5b8" />
        <Controls position="bottom-right" showInteractive={false} />
      </ReactFlow>

      {benchmarkEnabled ? (
        <section className="benchmark-panel" aria-live="polite">
          <div>
            <span className="eyebrow">M0 reference fixture</span>
            <strong>
              {graph.nodes.length} nodes · {graph.edges.length} edges
            </strong>
          </div>
          <button type="button" onClick={() => void run()} disabled={isRunning}>
            {isRunning ? "测量中…" : "运行 5 秒基准"}
          </button>
          {latest ? (
            <dl data-testid="benchmark-result">
              <div>
                <dt>p95 frame</dt>
                <dd>{latest.p95FrameTimeMs} ms</dd>
              </div>
              <div>
                <dt>≤20 ms</dt>
                <dd>{latest.framesWithin20msPercent}%</dd>
              </div>
              <div>
                <dt>long task</dt>
                <dd>{latest.longestTaskMs} ms</dd>
              </div>
            </dl>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

export function CanvasSurface(props: CanvasSurfaceProps) {
  const initialNodes = useMemo(
    () => mapNodes(props.graph, props.editable, props.onNodeGeometryChange),
    [props.editable, props.graph, props.onNodeGeometryChange]
  );
  const initialEdges = useMemo(() => mapEdges(props.graph), [props.graph]);

  return (
    <ReactFlowProvider>
      <InnerCanvas {...props} initialNodes={initialNodes} initialEdges={initialEdges} />
    </ReactFlowProvider>
  );
}
