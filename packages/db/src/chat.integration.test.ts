import { randomUUID } from "node:crypto";

import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { WorkspaceScope } from "@siftloom/shared";

import {
  ChatNotFoundError,
  ChatRunActiveError,
  ChatRunStateError,
  appendChatDelta,
  claimChatRun,
  createChatRun,
  failChatRun,
  finalizeChatRun,
  getChatSourceSnapshot,
  getChatThread,
  listChatRunEvents,
  requestChatCancellation
} from "./chat.js";
import { createDatabaseClient, type DatabaseClient } from "./client.js";

function requiredUrl(name: "TEST_DATABASE_URL" | "TEST_RUNTIME_DATABASE_URL"): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required; chat integration tests may not skip`);
  return value;
}

const adminUrl = requiredUrl("TEST_DATABASE_URL");
const runtimeUrl = requiredUrl("TEST_RUNTIME_DATABASE_URL");
const workspaceA = randomUUID();
const workspaceB = randomUUID();
const boardA = randomUUID();
const boardB = randomUUID();
const sourceNode = randomUUID();
const chatNode = randomUUID();
const actorA = `chat-a-${randomUUID()}`;
const actorB = `chat-b-${randomUUID()}`;
const scopeA: WorkspaceScope = { workspaceId: workspaceA, actorUserId: actorA };
const scopeB: WorkspaceScope = { workspaceId: workspaceB, actorUserId: actorB };
const provider = { name: "fake", model: "fake-grounded-v1" };

let admin: Pool;
let runtime: DatabaseClient;

function payload(kind: "note" | "chat", title: string, value: string) {
  const common = { version: 1, kind, title, summary: "", status: "ready", progress: null };
  return kind === "note" ? { ...common, body: value } : { ...common, prompt: value };
}

describe("M4 grounded chat persistence and tenant boundary", () => {
  beforeAll(async () => {
    admin = new Pool({ connectionString: adminUrl });
    runtime = createDatabaseClient(runtimeUrl);
    await admin.query(
      `insert into workspace (id, name) values ($1, 'Chat A'), ($2, 'Chat B')`,
      [workspaceA, workspaceB]
    );
    await admin.query(
      `insert into workspace_membership (workspace_id, user_id, role, status)
       values ($1, $2, 'owner', 'active'), ($3, $4, 'owner', 'active')`,
      [workspaceA, actorA, workspaceB, actorB]
    );
    await admin.query(
      `insert into board (id, workspace_id, name)
       values ($1, $2, 'Board A'), ($3, $4, 'Board B')`,
      [boardA, workspaceA, boardB, workspaceB]
    );
    await admin.query(
      `insert into node (id, workspace_id, board_id, kind, x, y, width, height, payload)
       values
       ($1, $2, $3, 'note', 0, 0, 230, 145, $4::jsonb),
       ($5, $2, $3, 'chat', 300, 0, 300, 300, $6::jsonb)`,
      [
        sourceNode,
        workspaceA,
        boardA,
        JSON.stringify(payload("note", "Authorized note", "Frozen fact alpha")),
        chatNode,
        JSON.stringify(payload("chat", "Grounded chat", ""))
      ]
    );
    await admin.query(
      `insert into edge (id, workspace_id, board_id, source_node_id, target_node_id, rank)
       values ($1, $2, $3, $4, $5, 0)`,
      [randomUUID(), workspaceA, boardA, sourceNode, chatNode]
    );
  });

  afterAll(async () => {
    await runtime.close();
    await admin.query("delete from workspace where id = any($1::uuid[])", [
      [workspaceA, workspaceB]
    ]);
    await admin.end();
  });

  it("freezes authorized sources and finalizes one canonical cited answer exactly once", async () => {
    const mutationId = randomUUID();
    const created = await createChatRun(
      runtime.db,
      scopeA,
      boardA,
      chatNode,
      {
        mutationId,
        prompt: "What is the fact?",
        selectedSourceNodeIds: [],
        retryOfRunId: null
      },
      provider
    );
    const replay = await createChatRun(
      runtime.db,
      scopeA,
      boardA,
      chatNode,
      {
        mutationId,
        prompt: "What is the fact?",
        selectedSourceNodeIds: [],
        retryOfRunId: null
      },
      provider
    );
    expect(replay.run.id).toBe(created.run.id);
    await expect(
      createChatRun(
        runtime.db,
        scopeA,
        boardA,
        chatNode,
        {
          mutationId,
          prompt: "A mismatched replay",
          selectedSourceNodeIds: [],
          retryOfRunId: null
        },
        provider
      )
    ).rejects.toBeInstanceOf(ChatRunStateError);

    const claimed = await claimChatRun(runtime.db, scopeA, boardA, created.run.id);
    expect(claimed).toMatchObject({ prompt: "What is the fact?" });
    expect(claimed?.context).toHaveLength(1);
    expect(claimed?.context[0]).toMatchObject({
      sourceHandle: "S1",
      exactText: "Frozen fact alpha"
    });
    await appendChatDelta(runtime.db, scopeA, boardA, created.run.id, "Alpha [S1]");
    await finalizeChatRun(
      runtime.db,
      scopeA,
      boardA,
      created.run.id,
      { inputTokens: 9, cachedInputTokens: 2, outputTokens: 3 },
      ["S1"],
      true
    );
    await finalizeChatRun(
      runtime.db,
      scopeA,
      boardA,
      created.run.id,
      { inputTokens: 9, cachedInputTokens: 2, outputTokens: 3 },
      ["S1"],
      true
    );

    const thread = await getChatThread(runtime.db, scopeA, boardA, chatNode);
    expect(thread.messages.map((message) => message.role)).toEqual(["user", "assistant"]);
    expect(thread.messages[1]).toMatchObject({ content: "Alpha [S1]" });
    const usage = await admin.query<{ count: string }>(
      "select count(*)::text as count from usage_event where run_id = $1",
      [created.run.id]
    );
    expect(usage.rows[0]?.count).toBe("1");

    const citation = thread.messages[1]?.citations[0];
    if (!citation) throw new Error("Expected citation snapshot");
    const snapshot = await getChatSourceSnapshot(
      runtime.db,
      scopeA,
      boardA,
      chatNode,
      citation.snapshotId
    );
    expect(snapshot).toMatchObject({
      exactText: "Frozen fact alpha",
      sourceChanged: false
    });

    const followup = await createChatRun(
      runtime.db,
      scopeA,
      boardA,
      chatNode,
      {
        mutationId: randomUUID(),
        prompt: "Use eligible history",
        selectedSourceNodeIds: [],
        retryOfRunId: null
      },
      provider
    );
    const followupClaim = await claimChatRun(runtime.db, scopeA, boardA, followup.run.id);
    expect(followupClaim?.history).toEqual([
      { role: "user", content: "What is the fact?" },
      { role: "assistant", content: "Alpha [S1]" }
    ]);
    await failChatRun(
      runtime.db,
      scopeA,
      boardA,
      followup.run.id,
      "cancelled",
      "fixture_cancelled",
      "Fixture terminal",
      true
    );

    await admin.query(
      `update node
       set payload = jsonb_set(payload, '{body}', to_jsonb('Changed fact beta'::text)),
           revision = revision + 1
       where id = $1`,
      [sourceNode]
    );
    await expect(
      getChatSourceSnapshot(runtime.db, scopeA, boardA, chatNode, citation.snapshotId)
    ).resolves.toMatchObject({ exactText: "Frozen fact alpha", sourceChanged: true });
  });

  it("records provider usage once even when citation validation fails", async () => {
    const created = await createChatRun(
      runtime.db,
      scopeA,
      boardA,
      chatNode,
      {
        mutationId: randomUUID(),
        prompt: "Give an unsupported answer",
        selectedSourceNodeIds: [],
        retryOfRunId: null
      },
      provider
    );
    const claimed = await claimChatRun(runtime.db, scopeA, boardA, created.run.id);
    expect(claimed?.history).toEqual([]);
    await appendChatDelta(runtime.db, scopeA, boardA, created.run.id, "No citation");
    await finalizeChatRun(
      runtime.db,
      scopeA,
      boardA,
      created.run.id,
      { inputTokens: 5, cachedInputTokens: 0, outputTokens: 2 },
      [],
      false
    );
    const events = await listChatRunEvents(runtime.db, scopeA, boardA, created.run.id, 0);
    expect(events.status).toBe("failed");
    expect(events.events.at(-1)).toMatchObject({
      type: "failed",
      data: { errorCode: "citation_validation_failed" }
    });
    const usage = await admin.query<{ count: string }>(
      "select count(*)::text as count from usage_event where run_id = $1",
      [created.run.id]
    );
    expect(usage.rows[0]?.count).toBe("1");
  });

  it("cancels queued work without a provider call and isolates another tenant", async () => {
    const commands = ["Cancel this", "Concurrent workspace request"].map((prompt) =>
      createChatRun(
        runtime.db,
        scopeA,
        boardA,
        chatNode,
        {
          mutationId: randomUUID(),
          prompt,
          selectedSourceNodeIds: [],
          retryOfRunId: null
        },
        provider
      )
    );
    const results = await Promise.allSettled(commands);
    const fulfilled = results.find(
      (result): result is PromiseFulfilledResult<Awaited<(typeof commands)[number]>> =>
        result.status === "fulfilled"
    );
    const rejected = results.find(
      (result): result is PromiseRejectedResult => result.status === "rejected"
    );
    expect(fulfilled).toBeDefined();
    expect(rejected?.reason).toBeInstanceOf(ChatRunActiveError);
    if (!fulfilled) throw new Error("Expected one quota-reserving run");
    const created = fulfilled.value;
    await expect(
      requestChatCancellation(runtime.db, scopeA, boardA, created.run.id)
    ).resolves.toBe(true);
    await expect(
      claimChatRun(runtime.db, scopeA, boardA, created.run.id)
    ).resolves.toBeNull();
    await expect(
      getChatThread(runtime.db, scopeB, boardA, chatNode)
    ).rejects.toBeInstanceOf(ChatNotFoundError);
    await expect(
      getChatThread(runtime.db, scopeB, boardB, chatNode)
    ).rejects.toBeInstanceOf(ChatNotFoundError);
  });

  it("marks an accepted but ambiguous provider outcome for reconciliation", async () => {
    const created = await createChatRun(
      runtime.db,
      scopeA,
      boardA,
      chatNode,
      {
        mutationId: randomUUID(),
        prompt: "Ambiguous run",
        selectedSourceNodeIds: [],
        retryOfRunId: null
      },
      provider
    );
    await claimChatRun(runtime.db, scopeA, boardA, created.run.id);
    await failChatRun(
      runtime.db,
      scopeA,
      boardA,
      created.run.id,
      "reconciliation_required",
      "provider_stream_interrupted",
      "Unknown paid outcome",
      false
    );
    const result = await listChatRunEvents(runtime.db, scopeA, boardA, created.run.id, 0);
    expect(result.status).toBe("reconciliation_required");
    const attempt = await admin.query<{ status: string }>(
      "select status from provider_attempt where run_id = $1",
      [created.run.id]
    );
    expect(attempt.rows[0]?.status).toBe("indeterminate");
  });

  it("keeps canonical chat records append-only for the runtime role", async () => {
    const privileges = await admin.query<{ table_name: string; may_update: boolean }>(
      `select table_name,
              has_table_privilege('siftloom_web', table_name, 'UPDATE') as may_update
       from unnest(array[
         'chat_message', 'chat_message_source', 'context_manifest',
         'context_source_snapshot', 'chat_run_event', 'usage_event'
       ]) as table_name
       order by table_name`
    );
    expect(privileges.rows.every((row) => row.may_update === false)).toBe(true);
  });
});
