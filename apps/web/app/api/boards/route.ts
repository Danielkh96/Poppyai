import { boardListViewSchema, createBoardCommandSchema } from "@siftloom/shared";
import { createBoard, listBoards } from "@siftloom/db";
import { NextResponse } from "next/server";

import { getAuthContext } from "@/lib/server/auth-context";
import { getRuntimeDatabaseClient } from "@/lib/server/database";
import {
  boardRouteError,
  hasTrustedBrowserOrigin,
  invalidRequest,
  jsonError,
  unauthorized
} from "@/lib/server/http";

export async function GET(request: Request) {
  try {
    const context = await getAuthContext();
    if (!context) return unauthorized();

    const view = boardListViewSchema.parse(
      new URL(request.url).searchParams.get("view") ?? "active"
    );
    const boards = await listBoards(getRuntimeDatabaseClient().db, context.scope, view);
    return NextResponse.json({ boards });
  } catch (error) {
    if (error instanceof Error && error.name === "ZodError") return invalidRequest(error);
    return boardRouteError(error);
  }
}

export async function POST(request: Request) {
  if (!hasTrustedBrowserOrigin(request)) {
    return jsonError(403, "UNTRUSTED_ORIGIN", "无法验证请求来源。");
  }

  try {
    const context = await getAuthContext();
    if (!context) return unauthorized();

    const command = createBoardCommandSchema.parse(await request.json());
    const board = await createBoard(getRuntimeDatabaseClient().db, context.scope, command);
    return NextResponse.json({ board }, { status: 201 });
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
