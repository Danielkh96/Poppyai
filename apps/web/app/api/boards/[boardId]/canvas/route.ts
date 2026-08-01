import {
  BoardNotFoundError,
  CanvasConflictError,
  getCanvasSnapshot,
  saveCanvas
} from "@siftloom/db";
import { canvasSaveCommandSchema } from "@siftloom/shared";
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
  const parsed = boardIdSchema.safeParse((await context.params).boardId);
  if (!parsed.success) throw new BoardNotFoundError();
  return parsed.data;
}

export async function GET(_request: Request, routeContext: RouteContext) {
  try {
    const context = await getAuthContext();
    if (!context) return unauthorized();

    const snapshot = await getCanvasSnapshot(
      getRuntimeDatabaseClient().db,
      context.scope,
      await readBoardId(routeContext)
    );
    return NextResponse.json(
      { snapshot },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch (error) {
    return boardRouteError(error);
  }
}

export async function PUT(request: Request, routeContext: RouteContext) {
  if (!hasTrustedBrowserOrigin(request)) {
    return jsonError(403, "UNTRUSTED_ORIGIN", "无法验证请求来源。");
  }

  try {
    const context = await getAuthContext();
    if (!context) return unauthorized();
    const command = canvasSaveCommandSchema.parse(await request.json());
    const result = await saveCanvas(
      getRuntimeDatabaseClient().db,
      context.scope,
      await readBoardId(routeContext),
      command
    );
    return NextResponse.json(
      { result },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch (error) {
    if (error instanceof CanvasConflictError) {
      return NextResponse.json(
        {
          error: {
            code: "CANVAS_CONFLICT",
            message: "Board 已在其他位置更新。",
            latestRevision: error.latestRevision,
            targetId: error.targetId
          }
        },
        { status: 409, headers: { "Cache-Control": "private, no-store" } }
      );
    }
    if (
      error instanceof SyntaxError ||
      (error instanceof Error && error.name === "ZodError")
    ) {
      return invalidRequest(error);
    }
    return boardRouteError(error);
  }
}
