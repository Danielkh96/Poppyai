import { sql } from "drizzle-orm";

import { parseWorkspaceScope, type WorkspaceScope } from "@siftloom/shared";

import type { SiftloomDatabase } from "./client.js";

export type TenantTransaction = Parameters<
  Parameters<SiftloomDatabase["transaction"]>[0]
>[0];

/**
 * Opens the only permitted request/worker transaction shape for tenant-owned data.
 * PostgreSQL RLS reads these transaction-local values as a second line of defense.
 */
export async function withTenantTransaction<T>(
  database: SiftloomDatabase,
  untrustedScope: WorkspaceScope,
  operation: (transaction: TenantTransaction) => Promise<T>
): Promise<T> {
  const scope = parseWorkspaceScope(untrustedScope);

  return database.transaction(async (transaction) => {
    await transaction.execute(sql`
      select
        set_config('app.workspace_id', ${scope.workspaceId}, true),
        set_config('app.user_id', ${scope.actorUserId}, true)
    `);
    return operation(transaction);
  });
}
