import { BoardNotFoundError, getBoardSnapshot } from "@siftloom/db";
import { ArrowLeft, Construction } from "lucide-react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { getAuthContext } from "@/lib/server/auth-context";
import { getRuntimeDatabaseClient } from "@/lib/server/database";

async function loadBoard(
  boardId: string,
  context: NonNullable<Awaited<ReturnType<typeof getAuthContext>>>
) {
  try {
    return await getBoardSnapshot(getRuntimeDatabaseClient().db, context.scope, boardId);
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
  const board = await loadBoard(boardId, context);

  return (
    <main className="board-canonical">
      <Link href="/boards">
        <ArrowLeft size={16} /> 返回 Boards
      </Link>
      <section>
        <span className="eyebrow">Canonical board snapshot</span>
        <h1>{board.name}</h1>
        <p>
          Revision {board.revision} · {board.nodes.length} nodes · {board.edges.length}{" "}
          edges
        </p>
        <div className="canvas-next-state">
          <Construction size={28} />
          <strong>Board 已持久化</strong>
          <span>无限画布编辑器将在 M2 接入此规范快照。</span>
        </div>
      </section>
    </main>
  );
}
