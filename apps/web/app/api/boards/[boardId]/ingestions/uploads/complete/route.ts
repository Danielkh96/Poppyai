import {
  BoardNotFoundError,
  IngestionStateError,
  completeUploadAndDispatch,
  getUploadIntentRecord
} from "@siftloom/db";
import { completeUploadSchema } from "@siftloom/shared";
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
import { getObjectStorage } from "@/lib/server/storage";

const boardIdSchema = z.uuid();
type RouteContext = { params: Promise<{ boardId: string }> };

function detectMime(prefix: Uint8Array): "application/pdf" | "text/plain" {
  if (new TextDecoder().decode(prefix.subarray(0, 5)) === "%PDF-") {
    return "application/pdf";
  }
  if (prefix.includes(0)) {
    throw new IngestionStateError("UPLOAD_VERIFICATION_FAILED", "上传文件格式无效。");
  }
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(prefix);
    return "text/plain";
  } catch {
    throw new IngestionStateError("UPLOAD_VERIFICATION_FAILED", "上传文件格式无效。");
  }
}

export async function POST(request: Request, routeContext: RouteContext) {
  if (!hasTrustedBrowserOrigin(request)) {
    return jsonError(403, "UNTRUSTED_ORIGIN", "无法验证请求来源。");
  }
  try {
    const context = await getAuthContext();
    if (!context) return unauthorized();
    const parsedBoardId = boardIdSchema.safeParse((await routeContext.params).boardId);
    if (!parsedBoardId.success) throw new BoardNotFoundError();
    const command = completeUploadSchema.parse(await request.json());
    const record = await getUploadIntentRecord(
      getRuntimeDatabaseClient().db,
      context.scope,
      parsedBoardId.data,
      command.assetId
    );
    const storage = getObjectStorage();
    const head = await storage.head(context.scope.workspaceId, record.objectKey);
    if (
      !head ||
      head.contentLength !== record.size ||
      head.contentType !== record.mimeType
    ) {
      throw new IngestionStateError("UPLOAD_VERIFICATION_FAILED", "上传文件校验失败。");
    }
    const prefix = await storage.getRange(
      context.scope.workspaceId,
      record.objectKey,
      0,
      Math.min(record.size - 1, 4_095)
    );
    const detectedMime = detectMime(prefix);
    if (detectedMime !== record.mimeType || head.checksumSha256 !== record.checksumSha256) {
      throw new IngestionStateError("UPLOAD_VERIFICATION_FAILED", "上传文件校验失败。");
    }
    const ingestion = await completeUploadAndDispatch(
      getRuntimeDatabaseClient().db,
      await getRuntimeQueue(),
      context.scope,
      parsedBoardId.data,
      command.nodeId,
      command.assetId,
      command.mutationId,
      {
        actualSize: head.contentLength,
        detectedMime,
        checksumSha256: head.checksumSha256
      }
    );
    return NextResponse.json(
      { ingestion },
      { status: 202, headers: { "Cache-Control": "private, no-store" } }
    );
  } catch (error) {
    return ingestionRouteError(error);
  }
}
