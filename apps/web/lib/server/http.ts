import "server-only";

import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { BoardNotFoundError } from "@siftloom/db";

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
