import { BoardNotFoundError, getBoardSnapshot, getCanvasSnapshot } from "@siftloom/db";
import { ArrowLeft, CheckCircle2, Command } from "lucide-react";
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
    <main className="m2-board-page" id="main-content">
      <header className="m2-board-header">
        <div>
          <Link href="/boards" className="icon-button" aria-label="返回 Boards">
            <ArrowLeft size={16} />
          </Link>
          <span className="m2-brand-mark" aria-hidden="true">
            <Command size={15} />
          </span>
          <div>
            <span className="eyebrow">Siftloom canvas</span>
            <h1>{board.name}</h1>
          </div>
        </div>
        <span className="m2-board-badge">
          <CheckCircle2 size={13} /> 自动保存已开启
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
