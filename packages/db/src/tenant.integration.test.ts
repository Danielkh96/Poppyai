import { randomUUID } from "node:crypto";

import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

function requireTestUrl(name: "TEST_DATABASE_URL" | "TEST_RUNTIME_DATABASE_URL"): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required; tenant integration tests may not skip`);
  return value;
}

const testDatabaseUrl = requireTestUrl("TEST_DATABASE_URL");
const runtimeDatabaseUrl = requireTestUrl("TEST_RUNTIME_DATABASE_URL");

const workspaceA = randomUUID();
const workspaceB = randomUUID();
const boardA = randomUUID();
const boardB = randomUUID();

let adminPool: Pool | undefined;
let runtimePool: Pool | undefined;

async function inTenantScope<T>(
  workspaceId: string,
  actorUserId: string,
  operation: (client: PoolClient) => Promise<T>
): Promise<T> {
  if (!runtimePool) {
    throw new Error("Runtime database pool is not initialized");
  }

  const client = await runtimePool.connect();
  try {
    await client.query("begin");
    await client.query(
      `select
        set_config('app.workspace_id', $1, true),
        set_config('app.user_id', $2, true)`,
      [workspaceId, actorUserId]
    );
    return await operation(client);
  } finally {
    await client.query("rollback");
    client.release();
  }
}

describe("PostgreSQL tenant isolation", () => {
  beforeAll(async () => {
    adminPool = new Pool({ connectionString: testDatabaseUrl });

    await adminPool.query(
      `insert into workspace (id, name)
       values ($1, 'Tenant A'), ($2, 'Tenant B')`,
      [workspaceA, workspaceB]
    );
    await adminPool.query(
      `insert into workspace_membership (workspace_id, user_id, role, status)
       values
         ($1, 'user-a', 'member', 'active'),
         ($1, 'user-c', 'owner', 'active'),
         ($2, 'user-b', 'owner', 'active')`,
      [workspaceA, workspaceB]
    );
    await adminPool.query(
      `insert into board (id, workspace_id, name)
       values ($1, $2, 'Board A'), ($3, $4, 'Board B')`,
      [boardA, workspaceA, boardB, workspaceB]
    );

    runtimePool = new Pool({ connectionString: runtimeDatabaseUrl });
  });

  afterAll(async () => {
    await runtimePool?.end();

    if (adminPool) {
      await adminPool.query("delete from workspace where id = any($1::uuid[])", [
        [workspaceA, workspaceB]
      ]);
      await adminPool.end();
    }
  });

  it("uses a real runtime role that cannot bypass row security", async () => {
    if (!runtimePool) throw new Error("Runtime database pool is not initialized");
    const role = await runtimePool.query<{
      current_user: string;
      rolsuper: boolean;
      rolbypassrls: boolean;
    }>(`
      select current_user, rolsuper, rolbypassrls
      from pg_roles
      where rolname = current_user
    `);

    expect(role.rows).toEqual([
      {
        current_user: "siftloom_web",
        rolsuper: false,
        rolbypassrls: false
      }
    ]);
  });

  it("shows only the active actor's workspace, membership, and boards", async () => {
    await inTenantScope(workspaceA, "user-a", async (client) => {
      const workspaces = await client.query<{ id: string }>("select id from workspace");
      const memberships = await client.query<{ user_id: string }>(
        "select user_id from workspace_membership order by user_id"
      );
      const boards = await client.query<{ id: string }>("select id from board");

      expect(workspaces.rows).toEqual([{ id: workspaceA }]);
      expect(memberships.rows).toEqual([{ user_id: "user-a" }]);
      expect(boards.rows).toEqual([{ id: boardA }]);
    });
  });

  it("reveals no rows when the actor is not a member of the requested workspace", async () => {
    await inTenantScope(workspaceB, "user-a", async (client) => {
      const workspaceCount = await client.query<{ count: string }>(
        "select count(*) from workspace"
      );
      const membershipCount = await client.query<{ count: string }>(
        "select count(*) from workspace_membership"
      );
      const boardCount = await client.query<{ count: string }>(
        "select count(*) from board"
      );

      expect(workspaceCount.rows[0]?.count).toBe("0");
      expect(membershipCount.rows[0]?.count).toBe("0");
      expect(boardCount.rows[0]?.count).toBe("0");
    });
  });

  it("allows same-tenant board writes but denies cross-tenant and membership writes", async () => {
    await inTenantScope(workspaceA, "user-a", async (client) => {
      const inserted = await client.query<{ id: string }>(
        "insert into board (workspace_id, name) values ($1, 'Allowed') returning id",
        [workspaceA]
      );
      expect(inserted.rowCount).toBe(1);
    });

    await expect(
      inTenantScope(workspaceA, "user-a", (client) =>
        client.query("insert into board (workspace_id, name) values ($1, 'Denied')", [
          workspaceB
        ])
      )
    ).rejects.toMatchObject({ code: "42501" });

    await expect(
      inTenantScope(workspaceA, "user-a", (client) =>
        client.query(
          "update workspace_membership set role = 'owner' where user_id = 'user-a'"
        )
      )
    ).rejects.toMatchObject({ code: "42501" });
  });
});
