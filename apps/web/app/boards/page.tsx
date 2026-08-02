import { listBoards } from "@siftloom/db";
import { Activity, Command, ShieldCheck } from "lucide-react";
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
    <main className="workspace-page" id="main-content">
      <nav className="workspace-nav" aria-label="工作区导航">
        <Link href="/" className="wordmark">
          <span className="brand-mark" aria-hidden="true">
            <Command size={17} />
          </span>
          <span>Siftloom</span>
        </Link>
        <span className="workspace-nav__context">
          <ShieldCheck size={14} /> 私有工作区
        </span>
        <span className="workspace-owner">
          <span className="workspace-owner__avatar" aria-hidden="true">
            {context.user.name.slice(0, 1).toUpperCase()}
          </span>
          <span>
            <strong>{context.user.name}</strong>
            <small>{context.user.email}</small>
          </span>
        </span>
        <Link href="/operations" className="workspace-nav__operations">
          <Activity size={14} /> 运行健康
        </Link>
        <Link href="/trust" className="workspace-nav__operations">
          <ShieldCheck size={14} /> 数据说明
        </Link>
        <SignOutButton />
      </nav>
      <BoardDashboard initialActive={active} initialArchived={archived} />
    </main>
  );
}
