import "server-only";

import { provisionPersonalWorkspace } from "@siftloom/db";
import type { WorkspaceScope } from "@siftloom/shared";
import { headers } from "next/headers";

import { auth } from "@/lib/auth";
import { getRuntimeDatabaseClient } from "@/lib/server/database";

export interface AuthContext {
  readonly user: {
    readonly id: string;
    readonly name: string;
    readonly email: string;
  };
  readonly scope: WorkspaceScope;
}

export async function getAuthContext(): Promise<AuthContext | null> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return null;

  const scope = await provisionPersonalWorkspace(getRuntimeDatabaseClient().db, {
    id: session.user.id,
    name: session.user.name
  });

  return {
    user: {
      id: session.user.id,
      name: session.user.name,
      email: session.user.email
    },
    scope
  };
}
