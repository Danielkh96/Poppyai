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
  Position,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Edge,
  type Node,
  type NodeProps
} from "@xyflow/react";

import type { CanvasGraph, CanvasNode, CanvasNodeKind } from "@siftloom/shared";

interface CanvasNodeData extends Record<string, unknown> {
  readonly node: CanvasNode;
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
  const Icon = NODE_ICONS[node.kind];
  const isBusy = node.status === "processing" || node.status === "streaming";

  return (
    <article
      className={`canvas-node canvas-node--${node.kind}${selected ? " is-selected" : ""}`}
      aria-label={`${node.title}，${node.status}`}
    >
      <Handle type="target" position={Position.Left} className="canvas-handle" />
      <div className="canvas-node__header">
        <span className="canvas-node__icon" aria-hidden="true">
          <Icon size={15} strokeWidth={1.8} />
        </span>
        <span className="canvas-node__kind">{node.kind}</span>
        <span className={`canvas-node__status canvas-node__status--${node.status}`}>
          {isBusy ? (
            <LoaderCircle size={12} className="spin" aria-hidden="true" />
          ) : (
            <CheckCircle2 size={12} aria-hidden="true" />
          )}
          {node.status === "streaming"
            ? "生成中"
            : node.status === "processing"
              ? "处理中"
              : "已就绪"}
        </span>
      </div>
      <h3>{node.title}</h3>
      <p>{node.summary}</p>
      {node.progress !== null ? (
        <div className="canvas-node__progress" aria-label={`处理进度 ${node.progress}%`}>
          <span style={{ width: `${node.progress}%` }} />
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

function mapNodes(graph: CanvasGraph): FlowNode[] {
  return graph.nodes.map((node) => ({
    id: node.id,
    type: "siftloom",
    position: node.position,
    width: node.size.width,
    height: node.size.height,
    data: { node },
    style: { width: node.size.width, height: node.size.height }
  }));
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
  initialNodes,
  initialEdges
}: InnerCanvasProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState<FlowNode>(initialNodes);
  const [edges, , onEdgesChange] = useEdgesState<FlowEdge>(initialEdges);
  const { getViewport, setViewport } = useReactFlow<FlowNode, FlowEdge>();
  const [latest, setLatest] = useState<CanvasBenchmarkResult | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const activeRef = useRef(false);
  const finalizeRequestedRef = useRef(false);
  const pointerSamplesRef = useRef<number[]>([]);
  const runningPromiseRef = useRef<Promise<CanvasBenchmarkResult> | null>(null);

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
                if (domainNode.status === "processing") {
                  return {
                    ...flowNode,
                    data: {
                      node: {
                        ...domainNode,
                        progress: 5 + ((activityStep * 7) % 91)
                      }
                    }
                  };
                }
                if (domainNode.status === "streaming") {
                  return {
                    ...flowNode,
                    data: {
                      node: {
                        ...domainNode,
                        summary: `正在生成已授权来源的可追溯回答${"·".repeat(
                          (activityStep % 3) + 1
                        )}`
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
  const initialNodes = useMemo(() => mapNodes(props.graph), [props.graph]);
  const initialEdges = useMemo(() => mapEdges(props.graph), [props.graph]);

  return (
    <ReactFlowProvider>
      <InnerCanvas {...props} initialNodes={initialNodes} initialEdges={initialEdges} />
    </ReactFlowProvider>
  );
}
