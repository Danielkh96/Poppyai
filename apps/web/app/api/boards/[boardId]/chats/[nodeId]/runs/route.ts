import { createConfiguredAiProvider } from "@siftloom/ai";
import { createChatRun } from "@siftloom/db";
import { chatRunCreateCommandSchema } from "@siftloom/shared";
import { NextResponse } from "next/server";
import { z } from "zod";

import { getAuthContext } from "@/lib/server/auth-context";
import { getRuntimeDatabaseClient } from "@/lib/server/database";
import {
  chatRouteError,
  hasTrustedBrowserOrigin,
  jsonError,
  unauthorized
} from "@/lib/server/http";

const idSchema = z.uuid();
type RouteContext = { params: Promise<{ boardId: string; nodeId: string }> };

export async function POST(request: Request, routeContext: RouteContext) {
  if (!hasTrustedBrowserOrigin(request)) {
    return jsonError(403, "UNTRUSTED_ORIGIN", "无法验证请求来源。");
  }
  try {
    const context = await getAuthContext();
    if (!context) return unauthorized();
    const parameters = await routeContext.params;
    const provider = createConfiguredAiProvider(process.env);
    const created = await createChatRun(
      getRuntimeDatabaseClient().db,
      context.scope,
      idSchema.parse(parameters.boardId),
      idSchema.parse(parameters.nodeId),
      chatRunCreateCommandSchema.parse(await request.json()),
      provider
    );
    return NextResponse.json(
      { created },
      { status: 201, headers: { "Cache-Control": "private, no-store" } }
    );
  } catch (error) {
    return chatRouteError(error);
  }
}
