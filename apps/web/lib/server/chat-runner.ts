import "server-only";

import {
  ProviderError,
  createConfiguredAiProvider,
  validateCitationHandles
} from "@siftloom/ai";
import {
  appendChatDelta,
  claimChatRun,
  failChatRun,
  finalizeChatRun,
  listChatRunEvents,
  recordChatProviderRequest
} from "@siftloom/db";
import type { WorkspaceScope } from "@siftloom/shared";

import { getRuntimeDatabaseClient } from "@/lib/server/database";

interface ActiveExecution {
  readonly abortController: AbortController;
  readonly promise: Promise<void>;
}

const runnerGlobals = globalThis as typeof globalThis & {
  __siftloomChatExecutions?: Map<string, ActiveExecution>;
};

function executions(): Map<string, ActiveExecution> {
  runnerGlobals.__siftloomChatExecutions ??= new Map();
  return runnerGlobals.__siftloomChatExecutions;
}

function executionKey(scope: WorkspaceScope, runId: string): string {
  return `${scope.workspaceId}:${runId}`;
}

async function executeRun(
  scope: WorkspaceScope,
  boardId: string,
  runId: string,
  signal: AbortSignal
): Promise<void> {
  const database = getRuntimeDatabaseClient().db;
  const claimed = await claimChatRun(database, scope, boardId, runId);
  if (!claimed) {
    const current = await listChatRunEvents(database, scope, boardId, runId, 0);
    if (current.status === "running") {
      await failChatRun(
        database,
        scope,
        boardId,
        runId,
        "reconciliation_required",
        "execution_owner_lost",
        "运行执行权已丢失，无法安全地再次调用模型。",
        false
      );
    }
    return;
  }

  const provider = createConfiguredAiProvider(process.env);
  if (provider.name !== claimed.providerName || provider.model !== claimed.model) {
    await failChatRun(
      database,
      scope,
      boardId,
      runId,
      "failed",
      "provider_configuration_changed",
      "模型配置在运行创建后发生变化，请创建新的运行。",
      true
    );
    return;
  }

  let answer = "";
  try {
    for await (const event of provider.stream({
      runId,
      userPrompt: claimed.prompt,
      context: claimed.context,
      history: claimed.history,
      signal
    })) {
      if (event.type === "started") {
        await recordChatProviderRequest(
          database,
          scope,
          boardId,
          runId,
          event.providerRequestId
        );
      } else if (event.type === "text_delta") {
        answer += event.delta;
        await appendChatDelta(database, scope, boardId, runId, event.delta);
      } else {
        const validation = validateCitationHandles(
          answer,
          claimed.context.map((source) => source.sourceHandle)
        );
        await finalizeChatRun(
          database,
          scope,
          boardId,
          runId,
          {
            inputTokens: event.inputTokens,
            cachedInputTokens: event.cachedInputTokens,
            outputTokens: event.outputTokens
          },
          validation.citedHandles,
          validation.valid
        );
      }
    }
  } catch (error) {
    const providerError =
      error instanceof ProviderError
        ? error
        : new ProviderError(
            "模型流在确认终态前中断。",
            signal.aborted ? "cancelled" : "ambiguous",
            signal.aborted ? "cancelled" : "provider_execution_interrupted",
            { cause: error }
          );
    const outcome =
      providerError.kind === "cancelled"
        ? "cancelled"
        : providerError.kind === "ambiguous"
          ? "reconciliation_required"
          : "failed";
    await failChatRun(
      database,
      scope,
      boardId,
      runId,
      outcome,
      providerError.code,
      providerError.kind === "cancelled" ? "生成已取消。" : providerError.message,
      providerError.kind === "safe_to_retry" || providerError.kind === "cancelled"
    );
  }
}

export function ensureChatRunExecution(
  scope: WorkspaceScope,
  boardId: string,
  runId: string
): Promise<void> {
  const key = executionKey(scope, runId);
  const existing = executions().get(key);
  if (existing) return existing.promise;
  const abortController = new AbortController();
  const promise = executeRun(scope, boardId, runId, abortController.signal).finally(() => {
    executions().delete(key);
  });
  executions().set(key, { abortController, promise });
  return promise;
}

export function abortChatRun(scope: WorkspaceScope, runId: string): void {
  executions()
    .get(executionKey(scope, runId))
    ?.abortController.abort(new DOMException("Cancelled", "AbortError"));
}
