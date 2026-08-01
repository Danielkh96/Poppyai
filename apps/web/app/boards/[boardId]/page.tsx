import { BoardNotFoundError, getBoardSnapshot, getCanvasSnapshot } from "@siftloom/db";
import { ArrowLeft, Sparkles } from "lucide-react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { getAuthContext } from "@/lib/server/auth-context";
import { getRuntimeDatabaseClient } from "@/lib/server/database";

import { PersistentCanvasEditor } from "./PersistentCanvasEditor";

async function loadBoard(
  boardId: string,
  context: NonNullable<Awaited<ReturnType<typeof getAuthContext>>>
) {
  try {
    const database = getRuntimeDatabaseClient().db;
    const [board, canvas] = await Promise.all([
      getBoardSnapshot(database, context.scope, boardId),
      getCanvasSnapshot(database, context.scope, boardId)
    ]);
    return { board, canvas };
  } catch (error) {
    if (error instanceof BoardNotFoundError) notFound();
    throw error;
  }
}

export default async function BoardPage({
  params
}: {
  params: Promise<{ boardId: string }>;
}) {
  const context = await getAuthContext();
  if (!context) redirect("/sign-in");

  const { boardId } = await params;
  const { board, canvas } = await loadBoard(boardId, context);

  return (
    <main className="m2-board-page">
      <header className="m2-board-header">
        <div>
          <Link href="/boards" className="icon-button" aria-label="返回 Boards">
            <ArrowLeft size={16} />
          </Link>
          <div>
            <span className="eyebrow">Persistent canvas · M2</span>
            <h1>{board.name}</h1>
          </div>
        </div>
        <span className="m2-board-badge">
          <Sparkles size={13} /> 私有工作区
        </span>
      </header>
      <PersistentCanvasEditor
        key={`${boardId}:${canvas.boardRevision}`}
        boardId={boardId}
        initialSnapshot={canvas}
      />
    </main>
  );
}
