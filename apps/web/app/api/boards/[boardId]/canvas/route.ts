import {
  BoardNotFoundError,
  CanvasConflictError,
  getCanvasSnapshot,
  recordOperationalEvent,
  saveCanvas
} from "@siftloom/db";
import type { OperationalEventKind, WorkspaceScope } from "@siftloom/shared";
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

async function recordSaveIssue(
  scope: WorkspaceScope,
  boardId: string,
  kind: OperationalEventKind,
  errorCode: string
) {
  try {
    await recordOperationalEvent(getRuntimeDatabaseClient().db, scope, {
      boardId,
      kind,
      errorCode
    });
    console.warn(
      JSON.stringify({
        event: kind,
        workspaceId: scope.workspaceId,
        boardId,
        errorCode
      })
    );
  } catch (telemetryError) {
    console.error(
      JSON.stringify({
        event: "operational_event_write_failed",
        workspaceId: scope.workspaceId,
        boardId,
        errorName: telemetryError instanceof Error ? telemetryError.name : "UnknownError"
      })
    );
  }
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

  let saveScope: WorkspaceScope | null = null;
  let saveBoardId: string | null = null;
  try {
    const context = await getAuthContext();
    if (!context) return unauthorized();
    saveScope = context.scope;
    saveBoardId = await readBoardId(routeContext);
    const command = canvasSaveCommandSchema.parse(await request.json());
    const result = await saveCanvas(
      getRuntimeDatabaseClient().db,
      context.scope,
      saveBoardId,
      command
    );
    return NextResponse.json(
      { result },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch (error) {
    if (error instanceof CanvasConflictError) {
      if (saveScope && saveBoardId) {
        await recordSaveIssue(
          saveScope,
          saveBoardId,
          "canvas_save_conflict",
          "CANVAS_CONFLICT"
        );
      }
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
    if (!(error instanceof BoardNotFoundError) && saveScope && saveBoardId) {
      await recordSaveIssue(
        saveScope,
        saveBoardId,
        "canvas_save_failed",
        "CANVAS_SAVE_FAILED"
      );
    }
    return boardRouteError(error);
  }
}
