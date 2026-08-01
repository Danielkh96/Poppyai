import { listBoards } from "@siftloom/db";
import Link from "next/link";
import { redirect } from "next/navigation";

import { getAuthContext } from "@/lib/server/auth-context";
import { getRuntimeDatabaseClient } from "@/lib/server/database";

import { BoardDashboard } from "./BoardDashboard";
import { SignOutButton } from "./SignOutButton";

export const metadata = { title: "Boards" };

export default async function BoardsPage() {
  const context = await getAuthContext();
  if (!context) redirect("/sign-in");

  const [active, archived] = await Promise.all([
    listBoards(getRuntimeDatabaseClient().db, context.scope, "active"),
    listBoards(getRuntimeDatabaseClient().db, context.scope, "archived")
  ]);

  return (
    <main className="workspace-page">
      <nav className="workspace-nav" aria-label="工作区导航">
        <Link href="/" className="wordmark">
          <span className="brand-mark" aria-hidden="true">
            S
          </span>
          <span>Siftloom</span>
        </Link>
        <span className="workspace-owner">
          <strong>{context.user.name}</strong>
          <small>{context.user.email}</small>
        </span>
        <SignOutButton />
      </nav>
      <BoardDashboard initialActive={active} initialArchived={archived} />
    </main>
  );
}
