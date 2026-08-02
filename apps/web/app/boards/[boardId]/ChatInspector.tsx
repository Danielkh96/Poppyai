"use client";

import {
  chatSourceSnapshotSchema,
  chatThreadSchema,
  type CanvasGraph,
  type CanvasNode,
  type ChatMessage,
  type ChatSourceSnapshot,
  type ChatThread
} from "@siftloom/shared";
import {
  AlertCircle,
  BookOpenText,
  LoaderCircle,
  RotateCw,
  Send,
  Square,
  X
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

interface ChatInspectorProps {
  readonly boardId: string;
  readonly node: CanvasNode & { readonly payload: { readonly kind: "chat" } };
  readonly graph: CanvasGraph;
  readonly canRun: boolean;
}

function apiMessage(value: unknown): string {
  if (
    value &&
    typeof value === "object" &&
    "error" in value &&
    value.error &&
    typeof value.error === "object" &&
    "message" in value.error &&
    typeof value.error.message === "string"
  ) {
    return value.error.message;
  }
  return "AI 对话请求失败，请稍后重试。";
}

function MessageContent({
  message,
  onSource
}: {
  readonly message: ChatMessage;
  readonly onSource: (snapshotId: string) => void;
}) {
  if (message.role === "user") return <p>{message.content}</p>;
  const citationByHandle = new Map(
    message.citations.map((citation) => [citation.handle, citation])
  );
  const parts = message.content.split(/(\[S[1-9][0-9]*\])/g);
  return (
    <p>
      {parts.map((part, index) => {
        const handle = part.slice(1, -1);
        const citation = citationByHandle.get(handle);
        return citation ? (
          <button
            key={`${handle}-${index}`}
            className="m4-inline-citation"
            type="button"
            onClick={() => onSource(citation.snapshotId)}
            title={`查看冻结来源：${citation.title}`}
          >
            {part}
            {citation.sourceChanged ? " · 已变化" : ""}
          </button>
        ) : (
          <span key={`${part}-${index}`}>{part}</span>
        );
      })}
    </p>
  );
}

export function ChatInspector({ boardId, node, graph, canRun }: ChatInspectorProps) {
  const [thread, setThread] = useState<ChatThread | null>(null);
  const [draft, setDraft] = useState(node.payload.prompt);
  const [streamText, setStreamText] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<ChatSourceSnapshot | null>(null);
  const streamRef = useRef<EventSource | null>(null);
  const activeRunRef = useRef<string | null>(null);

  const endpoint = `/api/boards/${boardId}/chats/${node.id}`;
  const connectedSources = useMemo(() => {
    const nodesById = new Map(graph.nodes.map((item) => [item.id, item]));
    const ids: string[] = [];
    for (const edge of [...graph.edges].sort((left, right) => left.rank - right.rank)) {
      if (edge.targetId !== node.id) continue;
      const source = nodesById.get(edge.sourceId);
      if (!source) continue;
      if (source.kind === "group") {
        ids.push(
          ...graph.nodes
            .filter((item) => item.parentId === source.id)
            .map((item) => item.id)
        );
      } else {
        ids.push(source.id);
      }
    }
    return [...new Set(ids)].flatMap((id) => {
      const source = nodesById.get(id);
      if (!source || source.kind === "chat" || source.kind === "group") return [];
      if (
        (source.payload.kind === "note" || source.payload.kind === "text") &&
        source.payload.body.trim().length === 0
      ) {
        return [];
      }
      if (
        (source.payload.kind === "pdf" ||
          source.payload.kind === "webpage" ||
          source.payload.kind === "video") &&
        source.payload.status !== "ready" &&
        source.payload.status !== "ready_with_warning"
      ) {
        return [];
      }
      return [source];
    });
  }, [graph.edges, graph.nodes, node.id]);

  const refresh = useCallback(async () => {
    const response = await fetch(endpoint, { cache: "no-store" });
    const value: unknown = await response.json();
    if (!response.ok) throw new Error(apiMessage(value));
    const parsed = chatThreadSchema.parse(
      value && typeof value === "object" && "thread" in value ? value.thread : undefined
    );
    setThread(parsed);
    return parsed;
  }, [endpoint]);

  const subscribe = useCallback(
    (runId: string) => {
      if (activeRunRef.current === runId && streamRef.current) return;
      streamRef.current?.close();
      activeRunRef.current = runId;
      setStreamText("");
      setBusy(true);
      const source = new EventSource(`${endpoint}/runs/${runId}/events`);
      streamRef.current = source;
      source.onopen = () => setNotice(null);
      source.addEventListener("delta", (event) => {
        const data = JSON.parse((event as MessageEvent<string>).data) as { text?: string };
        if (data.text) setStreamText((current) => current + data.text);
      });
      const finish = () => {
        source.close();
        if (streamRef.current === source) streamRef.current = null;
        activeRunRef.current = null;
        setBusy(false);
        setStreamText("");
        void refresh().catch((error) =>
          setNotice(error instanceof Error ? error.message : "无法刷新对话。")
        );
      };
      for (const name of ["completed", "failed", "cancelled", "reconciliation_required"]) {
        source.addEventListener(name, finish);
      }
      source.onerror = () => {
        // Native EventSource reconnects with Last-Event-ID and does not create a new run.
        setNotice("连接暂时中断，正在恢复生成流…");
      };
    },
    [endpoint, refresh]
  );

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void refresh()
        .then((value) => {
          if (!cancelled && value.activeRun) subscribe(value.activeRun.id);
        })
        .catch((error) => {
          if (!cancelled)
            setNotice(error instanceof Error ? error.message : "无法读取对话。");
        });
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      streamRef.current?.close();
      streamRef.current = null;
      activeRunRef.current = null;
    };
  }, [node.id, node.payload.prompt, refresh, subscribe]);

  const startRun = useCallback(
    async (prompt: string, retryOfRunId: string | null = null) => {
      if (!prompt.trim() || busy) return;
      if (!canRun) {
        setNotice("请等待画布保存完成后再生成。");
        return;
      }
      setBusy(true);
      setNotice(null);
      try {
        const response = await fetch(`${endpoint}/runs`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            mutationId: crypto.randomUUID(),
            prompt: prompt.trim(),
            selectedSourceNodeIds: [],
            retryOfRunId
          })
        });
        const value: unknown = await response.json();
        if (!response.ok) throw new Error(apiMessage(value));
        const runId =
          value &&
          typeof value === "object" &&
          "created" in value &&
          value.created &&
          typeof value.created === "object" &&
          "run" in value.created &&
          value.created.run &&
          typeof value.created.run === "object" &&
          "id" in value.created.run &&
          typeof value.created.run.id === "string"
            ? value.created.run.id
            : null;
        if (!runId) throw new Error("运行创建响应无效。");
        setDraft("");
        subscribe(runId);
        void refresh().catch((error) =>
          setNotice(error instanceof Error ? error.message : "无法刷新对话。")
        );
      } catch (error) {
        setBusy(false);
        setNotice(error instanceof Error ? error.message : "无法开始生成。");
      }
    },
    [busy, canRun, endpoint, refresh, subscribe]
  );

  const cancel = useCallback(async () => {
    const runId = activeRunRef.current ?? thread?.activeRun?.id;
    if (!runId) return;
    const response = await fetch(`${endpoint}/runs/${runId}/cancel`, { method: "POST" });
    if (!response.ok) setNotice("取消请求未能提交。");
  }, [endpoint, thread?.activeRun?.id]);

  const openSnapshot = useCallback(
    async (snapshotId: string) => {
      try {
        const response = await fetch(`${endpoint}/snapshots/${snapshotId}`, {
          cache: "no-store"
        });
        const value: unknown = await response.json();
        if (!response.ok) throw new Error(apiMessage(value));
        setSnapshot(
          chatSourceSnapshotSchema.parse(
            value && typeof value === "object" && "snapshot" in value
              ? value.snapshot
              : undefined
          )
        );
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "无法读取冻结来源。");
      }
    },
    [endpoint]
  );

  const lastUserMessage = [...(thread?.messages ?? [])]
    .reverse()
    .find((message) => message.role === "user");
  const retryable =
    thread?.latestRun &&
    (thread.latestRun.status === "failed" || thread.latestRun.status === "cancelled") &&
    thread.latestRun.error?.retryable;

  return (
    <div className="m4-chat" data-testid="chat-inspector">
      <div className="m4-source-strip">
        <span>本次可用来源</span>
        <div>
          {connectedSources.length === 0 ? <small>尚未连接来源</small> : null}
          {connectedSources.map((source, index) => (
            <span key={source.id} title={source.payload.title}>
              S{index + 1} · {source.payload.title}
            </span>
          ))}
        </div>
      </div>

      <div className="m4-messages" aria-live="polite">
        {!thread ? (
          <LoaderCircle className="spin" size={18} />
        ) : thread.messages.length === 0 && !streamText ? (
          <div className="m4-chat-empty">
            <BookOpenText size={22} />
            <strong>向已连接来源提问</strong>
            <p>回答必须引用冻结的来源版本；未连接内容不会发送给模型。</p>
          </div>
        ) : (
          thread.messages.map((message) => (
            <article key={message.id} className={`m4-message m4-message--${message.role}`}>
              <span>{message.role === "user" ? "你" : "AI"}</span>
              <MessageContent message={message} onSource={openSnapshot} />
            </article>
          ))
        )}
        {streamText ? (
          <article className="m4-message m4-message--assistant is-streaming">
            <span>AI · 生成中</span>
            <p>{streamText}</p>
          </article>
        ) : null}
      </div>

      {thread?.latestRun?.exclusions.length ? (
        <details className="m4-exclusions">
          <summary>已安全排除 {thread.latestRun.exclusions.length} 个来源</summary>
          {thread.latestRun.exclusions.map((item, index) => (
            <p key={`${item.nodeId}-${index}`}>
              {item.title}：{item.reason}
            </p>
          ))}
        </details>
      ) : null}
      {thread?.latestRun?.error ? (
        <div className="m4-run-error" role="alert">
          <AlertCircle size={14} />
          <span>{thread.latestRun.error.message}</span>
        </div>
      ) : null}
      {notice ? <p className="m4-chat-notice">{notice}</p> : null}

      <div className="m4-composer">
        <textarea
          value={draft}
          maxLength={20_000}
          placeholder="根据已连接来源提问…"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (
              event.key === "Enter" &&
              !event.shiftKey &&
              !event.nativeEvent.isComposing
            ) {
              event.preventDefault();
              void startRun(draft);
            }
          }}
        />
        {busy ? (
          <button type="button" onClick={() => void cancel()} title="停止生成">
            <Square size={14} />
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void startRun(draft)}
            disabled={!draft.trim() || connectedSources.length === 0 || !canRun}
            title="发送"
          >
            <Send size={14} />
          </button>
        )}
      </div>
      {retryable && lastUserMessage && thread?.latestRun ? (
        <button
          className="m4-retry"
          type="button"
          onClick={() =>
            void startRun(lastUserMessage.content, thread.latestRun?.id ?? null)
          }
        >
          <RotateCw size={13} /> 使用相同问题创建新运行
        </button>
      ) : null}

      {snapshot ? (
        <div
          className="m4-snapshot-backdrop"
          role="presentation"
          onMouseDown={() => setSnapshot(null)}
        >
          <section
            className="m4-snapshot"
            role="dialog"
            aria-modal="true"
            aria-label={`冻结来源 ${snapshot.title}`}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header>
              <div>
                <span>
                  {snapshot.handle} · revision {snapshot.nodeRevision}
                </span>
                <strong>{snapshot.title}</strong>
              </div>
              <button
                type="button"
                onClick={() => setSnapshot(null)}
                aria-label="关闭来源快照"
              >
                <X size={15} />
              </button>
            </header>
            {snapshot.sourceChanged ? (
              <p className="m4-source-changed">
                画布来源已变化；以下仍是回答生成时的不可变快照。
              </p>
            ) : null}
            <pre>{snapshot.exactText}</pre>
          </section>
        </div>
      ) : null}
    </div>
  );
}
