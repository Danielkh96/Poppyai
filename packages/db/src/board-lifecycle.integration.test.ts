import { randomUUID } from "node:crypto";

import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { parseWorkspaceScope } from "@siftloom/shared";

import {
  BoardNotFoundError,
  createBoard,
  createDatabaseClient,
  getBoardSnapshot,
  listBoards,
  mutateBoard,
  provisionPersonalWorkspace,
  type DatabaseClient
} from "./index.js";

function requireTestUrl(
  name: "TEST_DATABASE_URL" | "TEST_AUTH_DATABASE_URL" | "TEST_RUNTIME_DATABASE_URL"
): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required; board integration tests may not skip`);
  return value;
}

const adminUrl = requireTestUrl("TEST_DATABASE_URL");
const authUrl = requireTestUrl("TEST_AUTH_DATABASE_URL");
const runtimeUrl = requireTestUrl("TEST_RUNTIME_DATABASE_URL");

const userA = `m1-user-a-${randomUUID()}`;
const userB = `m1-user-b-${randomUUID()}`;
const userIds = [userA, userB];

let adminPool: Pool | undefined;
let authClient: DatabaseClient | undefined;
let runtimeClient: DatabaseClient | undefined;

describe("M1 workspace provisioning and board lifecycle", () => {
  beforeAll(async () => {
    adminPool = new Pool({ connectionString: adminUrl });
    await adminPool.query(
      `insert into "user" (id, name, email, email_verified)
       values ($1, 'User A', $2, true), ($3, 'User B', $4, true)`,
      [userA, `${userA}@example.test`, userB, `${userB}@example.test`]
    );
    authClient = createDatabaseClient(authUrl);
    runtimeClient = createDatabaseClient(runtimeUrl);
  });

  afterAll(async () => {
    await runtimeClient?.close();
    await authClient?.close();
    if (adminPool) {
      await adminPool.query(
        `delete from workspace
         where personal_owner_user_id = any($1::text[])`,
        [userIds]
      );
      await adminPool.query(`delete from "user" where id = any($1::text[])`, [userIds]);
      await adminPool.end();
    }
  });

  it("keeps auth credentials separate from tenant-owned business tables", async () => {
    if (!authClient) throw new Error("Auth database client is not initialized");

    const visibleUser = await authClient.pool.query<{ id: string }>(
      `select id from "user" where id = $1`,
      [userA]
    );
    expect(visibleUser.rows).toEqual([{ id: userA }]);
    await expect(
      authClient.pool.query("select id from workspace limit 1")
    ).rejects.toMatchObject({
      code: "42501"
    });
  });

  it("provisions exactly one personal workspace and owner membership", async () => {
    if (!runtimeClient || !adminPool)
      throw new Error("Database clients are not initialized");

    const [first, second] = await Promise.all([
      provisionPersonalWorkspace(runtimeClient.db, { id: userA, name: " User A " }),
      provisionPersonalWorkspace(runtimeClient.db, { id: userA, name: " User A " })
    ]);
    expect(second).toEqual(first);

    const result = await adminPool.query<{
      workspace_count: string;
      owner_membership_count: string;
    }>(
      `select
         count(distinct w.id)::text as workspace_count,
         count(m.workspace_id) filter (
           where m.user_id = $1 and m.role = 'owner' and m.status = 'active'
         )::text as owner_membership_count
       from workspace w
       left join workspace_membership m on m.workspace_id = w.id
       where w.personal_owner_user_id = $1`,
      [userA]
    );
    expect(result.rows).toEqual([{ workspace_count: "1", owner_membership_count: "1" }]);
  });

  it("creates idempotently and supports rename, archive, restore, and canonical reads", async () => {
    if (!runtimeClient) throw new Error("Runtime database client is not initialized");

    const scope = await provisionPersonalWorkspace(runtimeClient.db, {
      id: userA,
      name: "User A"
    });
    const mutationId = randomUUID();
    const [first, duplicate] = await Promise.all([
      createBoard(runtimeClient.db, scope, { mutationId, name: " Research Board " }),
      createBoard(runtimeClient.db, scope, { mutationId, name: " Research Board " })
    ]);
    expect(duplicate.id).toBe(first.id);
    expect(first.name).toBe("Research Board");
    expect(await listBoards(runtimeClient.db, scope, "active")).toHaveLength(1);

    const renamed = await mutateBoard(runtimeClient.db, scope, first.id, {
      action: "rename",
      name: "Launch research"
    });
    expect(renamed).toMatchObject({ name: "Launch research", revision: 1 });
    await expect(
      getBoardSnapshot(runtimeClient.db, scope, first.id)
    ).resolves.toMatchObject({
      id: first.id,
      name: "Launch research",
      nodes: [],
      edges: []
    });

    const archived = await mutateBoard(runtimeClient.db, scope, first.id, {
      action: "archive"
    });
    expect(archived.archivedAt).not.toBeNull();
    await expect(
      mutateBoard(runtimeClient.db, scope, first.id, { action: "archive" })
    ).resolves.toEqual(archived);
    expect(await listBoards(runtimeClient.db, scope, "active")).toEqual([]);
    expect(await listBoards(runtimeClient.db, scope, "archived")).toHaveLength(1);

    const restored = await mutateBoard(runtimeClient.db, scope, first.id, {
      action: "restore"
    });
    expect(restored.archivedAt).toBeNull();
    expect(restored.revision).toBe(3);
  });

  it("returns the same non-disclosing not-found result across tenants", async () => {
    if (!runtimeClient) throw new Error("Runtime database client is not initialized");

    const scopeA = await provisionPersonalWorkspace(runtimeClient.db, {
      id: userA,
      name: "User A"
    });
    const scopeB = await provisionPersonalWorkspace(runtimeClient.db, {
      id: userB,
      name: "User B"
    });
    const board = await createBoard(runtimeClient.db, scopeA, {
      mutationId: randomUUID(),
      name: "Private board"
    });

    await expect(
      getBoardSnapshot(runtimeClient.db, scopeB, board.id)
    ).rejects.toBeInstanceOf(BoardNotFoundError);
    await expect(
      mutateBoard(runtimeClient.db, scopeB, board.id, { action: "archive" })
    ).rejects.toBeInstanceOf(BoardNotFoundError);

    const forgedScope = parseWorkspaceScope({
      workspaceId: scopeA.workspaceId,
      actorUserId: userB
    });
    await expect(
      getBoardSnapshot(runtimeClient.db, forgedScope, board.id)
    ).rejects.toBeInstanceOf(BoardNotFoundError);
  });
});
