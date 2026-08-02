import { and, count, eq, gte, inArray, lt, min, sql } from "drizzle-orm";

import {
  OPERATIONAL_THRESHOLDS,
  OPERATIONAL_WINDOWS,
  PHASE_1_LIMITS,
  type OperationalAlert,
  type OperationalEventKind,
  type OperationalSummary,
  type WorkspaceScope
} from "@siftloom/shared";

import type { SiftloomDatabase } from "./client.js";
import { chatRuns, ingestionJobs, operationalEvents, usageEvents } from "./schema.js";
import { withTenantTransaction } from "./tenant.js";

function startOf(now: Date, milliseconds: number): Date {
  return new Date(now.getTime() - milliseconds);
}

function secondsSince(now: Date, value: Date | null): number {
  if (!value) return 0;
  return Math.max(0, Math.floor((now.getTime() - value.getTime()) / 1_000));
}

function highestStatus(alerts: readonly OperationalAlert[]): OperationalSummary["status"] {
  if (alerts.some((alert) => alert.severity === "critical")) return "critical";
  return alerts.length > 0 ? "warning" : "healthy";
}

export async function recordOperationalEvent(
  database: SiftloomDatabase,
  scope: WorkspaceScope,
  event: {
    readonly boardId?: string;
    readonly kind: OperationalEventKind;
    readonly errorCode: string;
  }
): Promise<void> {
  await withTenantTransaction(database, scope, async (transaction) => {
    await transaction.insert(operationalEvents).values({
      workspaceId: scope.workspaceId,
      boardId: event.boardId,
      kind: event.kind,
      errorCode: event.errorCode
    });
  });
}

export async function getOperationalSummary(
  database: SiftloomDatabase,
  scope: WorkspaceScope,
  now = new Date()
): Promise<OperationalSummary> {
  const burstSince = startOf(now, OPERATIONAL_WINDOWS.burstMinutes * 60 * 1_000);
  const usageSince = startOf(now, OPERATIONAL_WINDOWS.usageMinutes * 60 * 1_000);
  const historySince = startOf(now, OPERATIONAL_WINDOWS.historyHours * 60 * 60 * 1_000);
  const stuckBefore = startOf(now, OPERATIONAL_THRESHOLDS.queueAgeCriticalSeconds * 1_000);

  return withTenantTransaction(database, scope, async (transaction) => {
    // node-postgres transactions use one checked-out client. Queries must stay sequential;
    // concurrent client.query calls are deprecated and will fail in pg 9.
    const eventCounts = await transaction
      .select({ kind: operationalEvents.kind, value: count() })
      .from(operationalEvents)
      .where(
        and(
          eq(operationalEvents.workspaceId, scope.workspaceId),
          gte(operationalEvents.createdAt, burstSince)
        )
      )
      .groupBy(operationalEvents.kind);
    const ingestionFailureRows = await transaction
      .select({ value: count() })
      .from(ingestionJobs)
      .where(
        and(
          eq(ingestionJobs.workspaceId, scope.workspaceId),
          eq(ingestionJobs.status, "failed"),
          gte(ingestionJobs.updatedAt, historySince)
        )
      );
    const stuckRows = await transaction
      .select({ value: count() })
      .from(ingestionJobs)
      .where(
        and(
          eq(ingestionJobs.workspaceId, scope.workspaceId),
          inArray(ingestionJobs.status, ["queued", "running"]),
          lt(ingestionJobs.updatedAt, stuckBefore)
        )
      );
    const oldestIngestionRows = await transaction
      .select({ value: min(ingestionJobs.createdAt) })
      .from(ingestionJobs)
      .where(
        and(
          eq(ingestionJobs.workspaceId, scope.workspaceId),
          inArray(ingestionJobs.status, ["queued", "running"])
        )
      );
    const generationFailureRows = await transaction
      .select({ value: count() })
      .from(chatRuns)
      .where(
        and(
          eq(chatRuns.workspaceId, scope.workspaceId),
          eq(chatRuns.status, "failed"),
          gte(chatRuns.updatedAt, historySince)
        )
      );
    const reconciliationRows = await transaction
      .select({ value: count() })
      .from(chatRuns)
      .where(
        and(
          eq(chatRuns.workspaceId, scope.workspaceId),
          eq(chatRuns.status, "reconciliation_required")
        )
      );
    const oldestChatRows = await transaction
      .select({ value: min(chatRuns.createdAt) })
      .from(chatRuns)
      .where(
        and(
          eq(chatRuns.workspaceId, scope.workspaceId),
          inArray(chatRuns.status, ["queued", "running"])
        )
      );
    const runRows = await transaction
      .select({ value: count() })
      .from(chatRuns)
      .where(
        and(
          eq(chatRuns.workspaceId, scope.workspaceId),
          gte(chatRuns.createdAt, usageSince)
        )
      );
    const usageRows = await transaction
      .select({
        value: sql<number>`coalesce(sum(${usageEvents.inputTokens} + ${usageEvents.outputTokens}), 0)`
      })
      .from(usageEvents)
      .where(
        and(
          eq(usageEvents.workspaceId, scope.workspaceId),
          gte(usageEvents.createdAt, usageSince)
        )
      );

    const eventMap = new Map(eventCounts.map((row) => [row.kind, Number(row.value)]));
    const oldestIngestion = oldestIngestionRows[0]?.value ?? null;
    const oldestChat = oldestChatRows[0]?.value ?? null;
    const oldestActive =
      [oldestIngestion, oldestChat]
        .filter((value): value is Date => value instanceof Date)
        .sort((left, right) => left.getTime() - right.getTime())[0] ?? null;
    const metrics: OperationalSummary["metrics"] = {
      canvasSaveFailures15m: eventMap.get("canvas_save_failed") ?? 0,
      canvasSaveConflicts15m: eventMap.get("canvas_save_conflict") ?? 0,
      ingestionFailures24h: Number(ingestionFailureRows[0]?.value ?? 0),
      stuckIngestionJobs: Number(stuckRows[0]?.value ?? 0),
      generationFailures24h: Number(generationFailureRows[0]?.value ?? 0),
      reconciliationRequired: Number(reconciliationRows[0]?.value ?? 0),
      oldestActiveQueueAgeSeconds: secondsSince(now, oldestActive),
      aiRuns1h: Number(runRows[0]?.value ?? 0),
      billedTokens1h: Number(usageRows[0]?.value ?? 0)
    };

    const alerts: OperationalAlert[] = [];
    if (metrics.canvasSaveFailures15m >= OPERATIONAL_THRESHOLDS.canvasSaveFailuresWarning) {
      alerts.push({
        code: "CANVAS_SAVE_FAILURE_BURST",
        severity:
          metrics.canvasSaveFailures15m >= OPERATIONAL_THRESHOLDS.canvasSaveFailuresCritical
            ? "critical"
            : "warning",
        message: "最近 15 分钟的画布保存失败次数异常。"
      });
    }
    if (metrics.stuckIngestionJobs > 0) {
      alerts.push({
        code: "INGESTION_JOB_STUCK",
        severity: "critical",
        message: "存在超过五分钟未更新的来源处理任务。"
      });
    } else if (
      metrics.oldestActiveQueueAgeSeconds >= OPERATIONAL_THRESHOLDS.queueAgeWarningSeconds
    ) {
      alerts.push({
        code: "QUEUE_AGE_HIGH",
        severity:
          metrics.oldestActiveQueueAgeSeconds >=
          OPERATIONAL_THRESHOLDS.queueAgeCriticalSeconds
            ? "critical"
            : "warning",
        message: "当前任务排队时间超过私测阈值。"
      });
    }
    if (metrics.generationFailures24h >= OPERATIONAL_THRESHOLDS.generationFailuresWarning) {
      alerts.push({
        code: "GENERATION_FAILURE_BURST",
        severity:
          metrics.generationFailures24h >= OPERATIONAL_THRESHOLDS.generationFailuresCritical
            ? "critical"
            : "warning",
        message: "最近 24 小时的 AI 生成失败次数异常。"
      });
    }
    if (metrics.reconciliationRequired > 0) {
      alerts.push({
        code: "AI_RECONCILIATION_REQUIRED",
        severity: "critical",
        message: "存在必须人工核对的 AI 供应商结果。"
      });
    }
    const hourlyTokenBudget =
      (PHASE_1_LIMITS.ai.maxInputTokens + PHASE_1_LIMITS.ai.reservedOutputTokens) *
      PHASE_1_LIMITS.ai.chatRunsPerWorkspaceHour;
    if (
      metrics.aiRuns1h >=
        PHASE_1_LIMITS.ai.chatRunsPerWorkspaceHour *
          OPERATIONAL_THRESHOLDS.usageWarningRatio ||
      metrics.billedTokens1h >= hourlyTokenBudget * OPERATIONAL_THRESHOLDS.usageWarningRatio
    ) {
      alerts.push({
        code: "AI_USAGE_ANOMALY",
        severity:
          metrics.aiRuns1h >= PHASE_1_LIMITS.ai.chatRunsPerWorkspaceHour ||
          metrics.billedTokens1h >= hourlyTokenBudget
            ? "critical"
            : "warning",
        message: "最近一小时的 AI 使用量接近或达到私测上限。"
      });
    }

    return {
      generatedAt: now.toISOString(),
      status: highestStatus(alerts),
      metrics,
      alerts
    };
  });
}
