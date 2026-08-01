"use client";

import {
  Archive,
  ArrowRight,
  Clock3,
  FileSearch,
  FolderOpen,
  LayoutDashboard,
  Layers3,
  LoaderCircle,
  MessageSquareText,
  Pencil,
  Play,
  Plus,
  RotateCcw,
  Sparkles
} from "lucide-react";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { z } from "zod";

import { boardSummarySchema, type BoardSummary } from "@siftloom/shared";

import { useHydrated } from "@/lib/use-hydrated";

const boardResponseSchema = z.object({ board: boardSummarySchema });
const boardListResponseSchema = z.object({ boards: z.array(boardSummarySchema) });

interface BoardDashboardProps {
  readonly initialActive: readonly BoardSummary[];
  readonly initialArchived: readonly BoardSummary[];
}

type View = "active" | "archived";

async function responseMessage(response: Response): Promise<string> {
  const fallback = "操作失败，请重试。";
  try {
    const value: unknown = await response.json();
    const parsed = z.object({ error: z.object({ message: z.string() }) }).safeParse(value);
    return parsed.success ? parsed.data.error.message : fallback;
  } catch {
    return fallback;
  }
}

export function BoardDashboard({ initialActive, initialArchived }: BoardDashboardProps) {
  const interactive = useHydrated();
  const [active, setActive] = useState([...initialActive]);
  const [archived, setArchived] = useState([...initialArchived]);
  const [view, setView] = useState<View>("active");
  const [name, setName] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const boards = view === "active" ? active : archived;

  async function refresh(target: View = view) {
    setPending("refresh");
    setError(null);
    try {
      const response = await fetch(`/api/boards?view=${target}`, { cache: "no-store" });
      if (!response.ok) throw new Error(await responseMessage(response));
      const data = boardListResponseSchema.parse(await response.json());
      if (target === "active") setActive(data.boards);
      else setArchived(data.boards);
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : "刷新失败，请重试。");
    } finally {
      setPending(null);
    }
  }

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending("create");
    setError(null);
    try {
      const response = await fetch("/api/boards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mutationId: crypto.randomUUID(), name })
      });
      if (!response.ok) throw new Error(await responseMessage(response));
      const { board } = boardResponseSchema.parse(await response.json());
      setName("");
      setView("active");
      setActive((current) => [board, ...current.filter((item) => item.id !== board.id)]);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "创建失败，请重试。");
    } finally {
      setPending(null);
    }
  }

  async function mutate(board: BoardSummary, action: "rename" | "archive" | "restore") {
    let nextName: string | null = null;
    if (action === "rename") {
      nextName = window.prompt("输入新的 Board 名称", board.name);
      if (nextName === null || nextName.trim() === board.name) return;
    }
    if (action === "archive" && !window.confirm(`归档“${board.name}”？之后可以恢复。`)) {
      return;
    }

    setPending(board.id);
    setError(null);
    try {
      const body = action === "rename" ? { action, name: nextName } : { action };
      const response = await fetch(`/api/boards/${board.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      if (!response.ok) throw new Error(await responseMessage(response));
      const { board: updated } = boardResponseSchema.parse(await response.json());

      if (action === "archive") {
        setActive((current) => current.filter((item) => item.id !== board.id));
        setArchived((current) => [
          updated,
          ...current.filter((item) => item.id !== board.id)
        ]);
      } else if (action === "restore") {
        setArchived((current) => current.filter((item) => item.id !== board.id));
        setActive((current) => [
          updated,
          ...current.filter((item) => item.id !== board.id)
        ]);
      } else {
        const update = (current: BoardSummary[]) =>
          current.map((item) => (item.id === board.id ? updated : item));
        setActive(update);
        setArchived(update);
      }
    } catch (mutationError) {
      setError(
        mutationError instanceof Error ? mutationError.message : "更新失败，请重试。"
      );
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="board-app-shell">
      <aside className="board-sidebar" aria-label="Board 导航">
        <form className="create-board" onSubmit={create}>
          <label htmlFor="new-board-name">新 Board 名称</label>
          <input
            id="new-board-name"
            maxLength={120}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="命名你的新 Board"
          />
          <button
            type="submit"
            disabled={!interactive || pending !== null}
            suppressHydrationWarning
          >
            {pending === "create" ? (
              <LoaderCircle className="spin" size={17} />
            ) : (
              <Plus size={17} />
            )}
            创建
          </button>
        </form>

        <nav className="board-tabs" role="tablist" aria-label="Board 分类">
          <button
            role="tab"
            aria-selected={view === "active"}
            onClick={() => setView("active")}
          >
            <LayoutDashboard size={17} />
            使用中 <span>{active.length}</span>
          </button>
          <button
            role="tab"
            aria-selected={view === "archived"}
            onClick={() => setView("archived")}
          >
            <Archive size={17} />
            已归档 <span>{archived.length}</span>
          </button>
        </nav>

        <div className="board-sidebar__tip">
          <span>
            <Sparkles size={14} /> 工作流提示
          </span>
          <strong>先连接来源，再交给 AI。</strong>
          <p>这样生成的每个结论都能回到原始节点。</p>
        </div>
      </aside>

      <div className="board-content">
        <section className="board-hero">
          <div>
            <span className="eyebrow">Visual research workspace</span>
            <h1>你的 Boards</h1>
            <p>整理素材、连接线索，并从明确来源生成内容。</p>
          </div>
          <button
            className="quiet-button"
            onClick={() => void refresh()}
            disabled={pending !== null}
          >
            <RotateCcw size={14} /> 刷新
          </button>
        </section>

        <section className="board-guide" aria-labelledby="board-guide-title">
          <div className="board-guide__heading">
            <div>
              <span className="eyebrow">Quick start</span>
              <h2 id="board-guide-title">用三步建立可追溯的创作空间</h2>
            </div>
            <span className="board-guide__play" aria-hidden="true">
              <Play size={13} fill="currentColor" /> 2 分钟导览
            </span>
          </div>
          <div className="board-guide__cards">
            <article className="guide-card guide-card--sources">
              <span>
                <FileSearch size={19} />
              </span>
              <small>01 · 收集</small>
              <strong>把来源放进画布</strong>
              <p>文本、网页与文件成为独立节点。</p>
            </article>
            <article className="guide-card guide-card--structure">
              <span>
                <Layers3 size={19} />
              </span>
              <small>02 · 组织</small>
              <strong>分组并连接线索</strong>
              <p>用空间关系看见素材之间的脉络。</p>
            </article>
            <article className="guide-card guide-card--chat">
              <span>
                <MessageSquareText size={19} />
              </span>
              <small>03 · 生成</small>
              <strong>让 AI 只使用所选来源</strong>
              <p>保留答案与贡献节点之间的连接。</p>
            </article>
          </div>
        </section>

        <section className="board-index" aria-labelledby="board-list-title">
          <div className="board-index__head">
            <div>
              <h2 id="board-list-title">
                {view === "active" ? "全部 Boards" : "已归档 Boards"}
              </h2>
              <p>{boards.length} 个工作空间</p>
            </div>
            <span className="board-index__sort">
              <Clock3 size={13} /> 最近更新
            </span>
          </div>

          {error ? (
            <div className="inline-error" role="alert">
              <p>{error}</p>
              <button type="button" onClick={() => void refresh()}>
                重试
              </button>
            </div>
          ) : null}

          {pending === "refresh" ? (
            <div className="board-state" role="status">
              <LoaderCircle className="spin" /> 正在加载 Boards…
            </div>
          ) : boards.length === 0 ? (
            <div className="board-empty">
              <FolderOpen size={28} />
              <h3>{view === "active" ? "从第一张 Board 开始" : "暂无归档内容"}</h3>
              <p>
                {view === "active"
                  ? "在左侧命名并创建一个新的研究空间。"
                  : "归档的 Board 会出现在这里，并可随时恢复。"}
              </p>
            </div>
          ) : (
            <div className="board-grid-list">
              <div className="board-list-head" aria-hidden="true">
                <span>名称</span>
                <span>最近更新</span>
                <span>状态</span>
                <span>操作</span>
              </div>
              {boards.map((board) => (
                <article className="board-card" key={board.id}>
                  <span className="board-card__icon" aria-hidden="true">
                    <Layers3 size={16} />
                  </span>
                  <div className="board-card__body">
                    <h2>{board.name}</h2>
                    <small>视觉研究空间</small>
                  </div>
                  <p className="board-card__updated">
                    {new Intl.DateTimeFormat("zh-CN", {
                      dateStyle: "medium",
                      timeStyle: "short"
                    }).format(new Date(board.updatedAt))}
                  </p>
                  <span className={`board-card__status board-card__status--${view}`}>
                    {view === "active" ? "使用中" : "已归档"}
                  </span>
                  <div className="board-card__actions">
                    {view === "active" ? (
                      <>
                        <Link href={`/boards/${board.id}`}>
                          打开 <ArrowRight size={15} />
                        </Link>
                        <button
                          disabled={pending === board.id}
                          onClick={() => void mutate(board, "rename")}
                          aria-label={`重命名 ${board.name}`}
                        >
                          <Pencil size={15} />
                        </button>
                        <button
                          disabled={pending === board.id}
                          onClick={() => void mutate(board, "archive")}
                          aria-label={`归档 ${board.name}`}
                        >
                          <Archive size={15} />
                        </button>
                      </>
                    ) : (
                      <button
                        className="restore-button"
                        disabled={pending === board.id}
                        onClick={() => void mutate(board, "restore")}
                      >
                        <RotateCcw size={15} /> 恢复
                      </button>
                    )}
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
