import { BoardNotFoundError, getBoardSnapshot, mutateBoard } from "@siftloom/db";
import { boardMutationSchema } from "@siftloom/shared";
import { NextResponse } from "next/server";
import { z } from "zod";

import { getAuthContext } from "@/lib/server/auth-context";
import { getRuntimeDatabaseClient } from "@/lib/server/database";
import {
  boardRouteError,
  hasTrustedBrowserOrigin,
  invalidRequest,
  jsonError,
  unauthorized
} from "@/lib/server/http";

const boardIdSchema = z.uuid();
type RouteContext = { params: Promise<{ boardId: string }> };

async function readBoardId(context: RouteContext): Promise<string> {
  const { boardId } = await context.params;
  const parsed = boardIdSchema.safeParse(boardId);
  if (!parsed.success) throw new BoardNotFoundError();
  return parsed.data;
}

export async function GET(_request: Request, routeContext: RouteContext) {
  try {
    const context = await getAuthContext();
    if (!context) return unauthorized();

    const board = await getBoardSnapshot(
      getRuntimeDatabaseClient().db,
      context.scope,
      await readBoardId(routeContext)
    );
    return NextResponse.json({ board });
  } catch (error) {
    return boardRouteError(error);
  }
}

export async function PATCH(request: Request, routeContext: RouteContext) {
  if (!hasTrustedBrowserOrigin(request)) {
    return jsonError(403, "UNTRUSTED_ORIGIN", "无法验证请求来源。");
  }

  try {
    const context = await getAuthContext();
    if (!context) return unauthorized();

    const mutation = boardMutationSchema.parse(await request.json());
    const board = await mutateBoard(
      getRuntimeDatabaseClient().db,
      context.scope,
      await readBoardId(routeContext),
      mutation
    );
    return NextResponse.json({ board });
  } catch (error) {
    if (
      error instanceof SyntaxError ||
      (error instanceof Error && error.name === "ZodError")
    ) {
      return invalidRequest(error);
    }
    return boardRouteError(error);
  }
}
