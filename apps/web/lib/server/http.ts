import "server-only";

import { NextResponse } from "next/server";
import { ZodError } from "zod";

import {
  BoardNotFoundError,
  IngestionLimitError,
  IngestionNotFoundError,
  IngestionStateError
} from "@siftloom/db";

export function jsonError(
  status: number,
  code: string,
  message: string
): NextResponse<{ error: { code: string; message: string } }> {
  return NextResponse.json({ error: { code, message } }, { status });
}

export function invalidRequest(error?: unknown) {
  const message =
    error instanceof ZodError
      ? "请求内容无效，请检查名称长度和操作类型。"
      : "请求内容无效。";
  return jsonError(400, "INVALID_REQUEST", message);
}

export function unauthorized() {
  return jsonError(401, "UNAUTHENTICATED", "请先登录后继续。");
}

export function boardRouteError(error: unknown) {
  if (error instanceof BoardNotFoundError) {
    return jsonError(404, "BOARD_NOT_FOUND", "找不到该 Board。");
  }
  console.error("Board request failed", {
    errorName: error instanceof Error ? error.name : "UnknownError"
  });
  return jsonError(500, "INTERNAL_ERROR", "操作失败，请稍后重试。");
}

export function ingestionRouteError(error: unknown) {
  if (error instanceof BoardNotFoundError || error instanceof IngestionNotFoundError) {
    return jsonError(404, "INGESTION_NOT_FOUND", "找不到该来源处理记录。");
  }
  if (error instanceof IngestionStateError) {
    return jsonError(409, error.code, error.message);
  }
  if (error instanceof IngestionLimitError) {
    return jsonError(error.httpStatus, error.code, error.message);
  }
  if (
    error instanceof SyntaxError ||
    (error instanceof Error && error.name === "ZodError")
  ) {
    return invalidRequest(error);
  }
  console.error("Ingestion request failed", {
    errorName: error instanceof Error ? error.name : "UnknownError"
  });
  return jsonError(500, "INTERNAL_ERROR", "来源处理操作失败，请稍后重试。");
}

export function hasTrustedBrowserOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;

  try {
    const originUrl = new URL(origin);
    const requestUrl = new URL(request.url);
    const expectedHost =
      request.headers.get("x-forwarded-host") ??
      request.headers.get("host") ??
      requestUrl.host;
    const expectedProtocol =
      request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() ??
      requestUrl.protocol.replace(":", "");

    return originUrl.host === expectedHost && originUrl.protocol === `${expectedProtocol}:`;
  } catch {
    return false;
  }
}
