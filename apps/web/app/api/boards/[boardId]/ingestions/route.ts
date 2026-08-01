import {
  BoardNotFoundError,
  listIngestionStatuses,
  submitRemoteIngestion
} from "@siftloom/db";
import { submitRemoteSourceSchema } from "@siftloom/shared";
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

const boardIdSchema = z.uuid();
type RouteContext = { params: Promise<{ boardId: string }> };

async function boardIdFrom(context: RouteContext): Promise<string> {
  const parsed = boardIdSchema.safeParse((await context.params).boardId);
  if (!parsed.success) throw new BoardNotFoundError();
  return parsed.data;
}

export async function GET(_request: Request, routeContext: RouteContext) {
  try {
    const context = await getAuthContext();
    if (!context) return unauthorized();
    const ingestions = await listIngestionStatuses(
      getRuntimeDatabaseClient().db,
      context.scope,
      await boardIdFrom(routeContext)
    );
    return NextResponse.json(
      { ingestions },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch (error) {
    return ingestionRouteError(error);
  }
}

export async function POST(request: Request, routeContext: RouteContext) {
  if (!hasTrustedBrowserOrigin(request)) {
    return jsonError(403, "UNTRUSTED_ORIGIN", "无法验证请求来源。");
  }
  try {
    const context = await getAuthContext();
    if (!context) return unauthorized();
    const command = submitRemoteSourceSchema.parse(await request.json());
    const ingestion = await submitRemoteIngestion(
      getRuntimeDatabaseClient().db,
      await getRuntimeQueue(),
      context.scope,
      await boardIdFrom(routeContext),
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
