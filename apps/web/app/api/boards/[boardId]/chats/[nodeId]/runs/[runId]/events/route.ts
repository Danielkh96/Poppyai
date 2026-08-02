import { authorizeChatRunNode, listChatRunEvents } from "@siftloom/db";
import { z } from "zod";

import { getAuthContext } from "@/lib/server/auth-context";
import { ensureChatRunExecution } from "@/lib/server/chat-runner";
import { getRuntimeDatabaseClient } from "@/lib/server/database";
import { chatRouteError, unauthorized } from "@/lib/server/http";

const idSchema = z.uuid();
const terminal = new Set(["completed", "cancelled", "failed", "reconciliation_required"]);
type RouteContext = {
  params: Promise<{ boardId: string; nodeId: string; runId: string }>;
};

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function GET(request: Request, routeContext: RouteContext) {
  try {
    const context = await getAuthContext();
    if (!context) return unauthorized();
    const parameters = await routeContext.params;
    const boardId = idSchema.parse(parameters.boardId);
    const nodeId = idSchema.parse(parameters.nodeId);
    const runId = idSchema.parse(parameters.runId);
    const lastEventHeader = request.headers.get("last-event-id") ?? "0";
    const initialSequence = Math.max(0, Number.parseInt(lastEventHeader, 10) || 0);
    const database = getRuntimeDatabaseClient().db;

    // Authorization is checked before starting a provider operation.
    await authorizeChatRunNode(database, context.scope, boardId, nodeId, runId);
    await listChatRunEvents(database, context.scope, boardId, runId, initialSequence);
    void ensureChatRunExecution(context.scope, boardId, runId).catch((error) => {
      console.error("Chat runner failed", {
        errorName: error instanceof Error ? error.name : "UnknownError"
      });
    });

    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        let sequence = initialSequence;
        let keepaliveAt = Date.now();
        controller.enqueue(encoder.encode(": connected\n\n"));
        try {
          while (!request.signal.aborted) {
            const batch = await listChatRunEvents(
              database,
              context.scope,
              boardId,
              runId,
              sequence
            );
            for (const event of batch.events) {
              sequence = event.sequence;
              controller.enqueue(
                encoder.encode(
                  `id: ${event.sequence}\nevent: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`
                )
              );
            }
            if (terminal.has(batch.status) && batch.events.length === 0) break;
            if (Date.now() - keepaliveAt >= 15_000) {
              controller.enqueue(encoder.encode(": keepalive\n\n"));
              keepaliveAt = Date.now();
            }
            await wait(150);
          }
        } catch (error) {
          if (!request.signal.aborted) controller.error(error);
          return;
        }
        controller.close();
      }
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "private, no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no"
      }
    });
  } catch (error) {
    return chatRouteError(error);
  }
}
