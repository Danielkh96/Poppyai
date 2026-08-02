import { getChatThread } from "@siftloom/db";
import { NextResponse } from "next/server";
import { z } from "zod";

import { getAuthContext } from "@/lib/server/auth-context";
import { getRuntimeDatabaseClient } from "@/lib/server/database";
import { chatRouteError, unauthorized } from "@/lib/server/http";

const idSchema = z.uuid();
type RouteContext = { params: Promise<{ boardId: string; nodeId: string }> };

export async function GET(_request: Request, routeContext: RouteContext) {
  try {
    const context = await getAuthContext();
    if (!context) return unauthorized();
    const parameters = await routeContext.params;
    const thread = await getChatThread(
      getRuntimeDatabaseClient().db,
      context.scope,
      idSchema.parse(parameters.boardId),
      idSchema.parse(parameters.nodeId)
    );
    return NextResponse.json(
      { thread },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch (error) {
    return chatRouteError(error);
  }
}
