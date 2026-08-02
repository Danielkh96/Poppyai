import { authorizeChatRunNode, requestChatCancellation } from "@siftloom/db";
import { NextResponse } from "next/server";
import { z } from "zod";

import { getAuthContext } from "@/lib/server/auth-context";
import { abortChatRun } from "@/lib/server/chat-runner";
import { getRuntimeDatabaseClient } from "@/lib/server/database";
import {
  chatRouteError,
  hasTrustedBrowserOrigin,
  jsonError,
  unauthorized
} from "@/lib/server/http";

const idSchema = z.uuid();
type RouteContext = {
  params: Promise<{ boardId: string; nodeId: string; runId: string }>;
};

export async function POST(request: Request, routeContext: RouteContext) {
  if (!hasTrustedBrowserOrigin(request)) {
    return jsonError(403, "UNTRUSTED_ORIGIN", "无法验证请求来源。");
  }
  try {
    const context = await getAuthContext();
    if (!context) return unauthorized();
    const parameters = await routeContext.params;
    const boardId = idSchema.parse(parameters.boardId);
    const nodeId = idSchema.parse(parameters.nodeId);
    const runId = idSchema.parse(parameters.runId);
    await authorizeChatRunNode(
      getRuntimeDatabaseClient().db,
      context.scope,
      boardId,
      nodeId,
      runId
    );
    const accepted = await requestChatCancellation(
      getRuntimeDatabaseClient().db,
      context.scope,
      boardId,
      runId
    );
    if (accepted) abortChatRun(context.scope, runId);
    return NextResponse.json(
      { accepted },
      { status: accepted ? 202 : 200, headers: { "Cache-Control": "private, no-store" } }
    );
  } catch (error) {
    return chatRouteError(error);
  }
}
