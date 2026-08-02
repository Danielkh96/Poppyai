import "server-only";

import { NextResponse } from "next/server";
import { ZodError } from "zod";

import {
  BoardNotFoundError,
  ChatNotFoundError,
  ChatLimitError,
  ChatRunActiveError,
  ChatRunStateError,
  ChatSourceRequiredError,
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

export function chatRouteError(error: unknown) {
  if (error instanceof ChatNotFoundError || error instanceof BoardNotFoundError) {
    return jsonError(404, "CHAT_NOT_FOUND", "找不到该 AI 对话或运行。");
  }
  if (error instanceof ChatRunActiveError) {
    return jsonError(409, "CHAT_RUN_ACTIVE", "该对话已有一个正在进行的回答。");
  }
  if (error instanceof ChatRunStateError) {
    return jsonError(409, "CHAT_RUN_STATE", "当前运行状态不允许此操作。");
  }
  if (error instanceof ChatLimitError) {
    return jsonError(error.httpStatus, error.code, error.message);
  }
  if (error instanceof ChatSourceRequiredError) {
    return NextResponse.json(
      {
        error: {
          code: "CHAT_SOURCE_REQUIRED",
          message: "请至少连接一个内容已就绪的来源。",
          exclusions: error.exclusions
        }
      },
      { status: 422, headers: { "Cache-Control": "private, no-store" } }
    );
  }
  if (
    error instanceof SyntaxError ||
    (error instanceof Error && error.name === "ZodError")
  ) {
    return invalidRequest(error);
  }
  console.error("Chat request failed", {
    errorName: error instanceof Error ? error.name : "UnknownError"
  });
  return jsonError(500, "INTERNAL_ERROR", "AI 对话操作失败，请稍后重试。");
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
