import { sql } from "drizzle-orm";

import { parseWorkspaceScope, type WorkspaceScope } from "@siftloom/shared";

import type { SiftloomDatabase } from "./client.js";

export interface ProvisioningUser {
  readonly id: string;
  readonly name: string;
}

export class WorkspaceProvisioningError extends Error {
  constructor() {
    super("The personal workspace could not be provisioned");
    this.name = "WorkspaceProvisioningError";
  }
}

/**
 * Calls a narrow SECURITY DEFINER function. The runtime role cannot otherwise create
 * workspaces or memberships, and the function verifies app.user_id against the target.
 */
export async function provisionPersonalWorkspace(
  database: SiftloomDatabase,
  user: ProvisioningUser
): Promise<WorkspaceScope> {
  const rows = await database.transaction(async (transaction) => {
    await transaction.execute(sql`
      select set_config('app.user_id', ${user.id}, true)
    `);
    const result = await transaction.execute<{ workspace_id: string }>(sql`
      select provision_personal_workspace(${user.id}, ${user.name}) as workspace_id
    `);
    return result.rows;
  });

  const workspaceId = rows[0]?.workspace_id;
  if (!workspaceId) throw new WorkspaceProvisioningError();

  return parseWorkspaceScope({ workspaceId, actorUserId: user.id });
}
