import { randomUUID } from "node:crypto";

import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { WorkspaceScope } from "@siftloom/shared";

import { createDatabaseClient, type DatabaseClient } from "./client.js";
import { getOperationalSummary, recordOperationalEvent } from "./operations.js";

function requiredUrl(name: "TEST_DATABASE_URL" | "TEST_RUNTIME_DATABASE_URL"): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required; operations tests may not skip`);
  return value;
}

const adminUrl = requiredUrl("TEST_DATABASE_URL");
const runtimeUrl = requiredUrl("TEST_RUNTIME_DATABASE_URL");
const workspaceA = randomUUID();
const workspaceB = randomUUID();
const boardA = randomUUID();
const boardB = randomUUID();
const actorA = `operations-a-${randomUUID()}`;
const actorB = `operations-b-${randomUUID()}`;
const scopeA: WorkspaceScope = { workspaceId: workspaceA, actorUserId: actorA };
const scopeB: WorkspaceScope = { workspaceId: workspaceB, actorUserId: actorB };

let admin: Pool;
let runtime: DatabaseClient;

describe("M5 privacy-safe operational summary", () => {
  beforeAll(async () => {
    admin = new Pool({ connectionString: adminUrl });
    runtime = createDatabaseClient(runtimeUrl);
    await admin.query(
      `insert into workspace (id, name) values ($1, 'Operations A'), ($2, 'Operations B')`,
      [workspaceA, workspaceB]
    );
    await admin.query(
      `insert into workspace_membership (workspace_id, user_id, role, status)
       values ($1, $2, 'owner', 'active'), ($3, $4, 'owner', 'active')`,
      [workspaceA, actorA, workspaceB, actorB]
    );
    await admin.query(
      `insert into board (id, workspace_id, name)
       values ($1, $2, 'Operations Board A'), ($3, $4, 'Operations Board B')`,
      [boardA, workspaceA, boardB, workspaceB]
    );
  });

  afterAll(async () => {
    await runtime.close();
    await admin.query("delete from workspace where id = any($1::uuid[])", [
      [workspaceA, workspaceB]
    ]);
    await admin.end();
  });

  it("alerts on a save-failure burst without exposing event content across tenants", async () => {
    for (let index = 0; index < 3; index += 1) {
      await recordOperationalEvent(runtime.db, scopeA, {
        boardId: boardA,
        kind: "canvas_save_failed",
        errorCode: "CANVAS_SAVE_FAILED"
      });
    }

    const now = new Date();
    const summaryA = await getOperationalSummary(runtime.db, scopeA, now);
    expect(summaryA.metrics.canvasSaveFailures15m).toBe(3);
    expect(summaryA.status).toBe("warning");
    expect(summaryA.alerts).toContainEqual({
      code: "CANVAS_SAVE_FAILURE_BURST",
      severity: "warning",
      message: "最近 15 分钟的画布保存失败次数异常。"
    });

    const summaryB = await getOperationalSummary(runtime.db, scopeB, now);
    expect(summaryB.metrics.canvasSaveFailures15m).toBe(0);
    expect(summaryB.status).toBe("healthy");
  });

  it("rejects mixed-tenant board relationships and append-only updates", async () => {
    await expect(
      recordOperationalEvent(runtime.db, scopeA, {
        boardId: boardB,
        kind: "canvas_save_failed",
        errorCode: "CANVAS_SAVE_FAILED"
      })
    ).rejects.toMatchObject({ cause: { code: "23503" } });

    await expect(
      runtime.pool.query(
        "update operational_event set error_code = 'MUTATED' where workspace_id = $1",
        [workspaceA]
      )
    ).rejects.toMatchObject({ code: "42501" });
  });
});
