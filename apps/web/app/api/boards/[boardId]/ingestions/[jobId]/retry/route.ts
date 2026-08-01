import { BoardNotFoundError, retryIngestion } from "@siftloom/db";
import { retryIngestionSchema } from "@siftloom/shared";
import { NextResponse } from "next/server";
import { z } from "zod";

import { getAuthContext } from "@/lib/server/auth-context";
import { getRuntimeDatabaseClient } from "@/lib/server/database";
import {
  hasTrustedBrowserOrigin,
  ingestionRouteError,
  jsonError,
  unauthorized
} from "@/lib/server/http";
import { getRuntimeQueue } from "@/lib/server/queue";

const idSchema = z.uuid();
type RouteContext = { params: Promise<{ boardId: string; jobId: string }> };

export async function POST(request: Request, routeContext: RouteContext) {
  if (!hasTrustedBrowserOrigin(request)) {
    return jsonError(403, "UNTRUSTED_ORIGIN", "无法验证请求来源。");
  }
  try {
    const context = await getAuthContext();
    if (!context) return unauthorized();
    const params = await routeContext.params;
    const boardId = idSchema.safeParse(params.boardId);
    const jobId = idSchema.safeParse(params.jobId);
    if (!boardId.success || !jobId.success) throw new BoardNotFoundError();
    const command = retryIngestionSchema.parse(await request.json());
    const ingestion = await retryIngestion(
      getRuntimeDatabaseClient().db,
      await getRuntimeQueue(),
      context.scope,
      boardId.data,
      jobId.data,
      command
    );
    return NextResponse.json(
      { ingestion },
      { status: 202, headers: { "Cache-Control": "private, no-store" } }
    );
  } catch (error) {
    return ingestionRouteError(error);
  }
}
