import { BoardNotFoundError, createUploadIntentRecord } from "@siftloom/db";
import { createUploadIntentSchema } from "@siftloom/shared";
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
import { getObjectStorage } from "@/lib/server/storage";

const boardIdSchema = z.uuid();
type RouteContext = { params: Promise<{ boardId: string }> };

export async function POST(request: Request, routeContext: RouteContext) {
  if (!hasTrustedBrowserOrigin(request)) {
    return jsonError(403, "UNTRUSTED_ORIGIN", "无法验证请求来源。");
  }
  try {
    const context = await getAuthContext();
    if (!context) return unauthorized();
    const parsedBoardId = boardIdSchema.safeParse((await routeContext.params).boardId);
    if (!parsedBoardId.success) throw new BoardNotFoundError();
    const command = createUploadIntentSchema.parse(await request.json());
    const record = await createUploadIntentRecord(
      getRuntimeDatabaseClient().db,
      context.scope,
      parsedBoardId.data,
      command
    );
    const uploadUrl = await getObjectStorage().createSignedUpload({
      workspaceId: context.scope.workspaceId,
      objectKey: record.objectKey,
      contentType: record.mimeType,
      contentLength: record.size,
      checksumSha256: record.checksumSha256,
      expiresInSeconds: 15 * 60
    });
    return NextResponse.json(
      {
        assetId: record.assetId,
        uploadUrl: uploadUrl.toString(),
        uploadHeaders: {
          "Content-Type": record.mimeType,
          "x-amz-meta-workspaceid": context.scope.workspaceId,
          "x-amz-meta-contentlength": String(record.size),
          "x-amz-meta-checksumsha256": record.checksumSha256
        }
      },
      { status: 201, headers: { "Cache-Control": "private, no-store" } }
    );
  } catch (error) {
    return ingestionRouteError(error);
  }
}
