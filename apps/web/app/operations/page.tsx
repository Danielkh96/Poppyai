import { getOperationalSummary } from "@siftloom/db";
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Clock3,
  DatabaseZap,
  Gauge,
  Sparkles
} from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { getAuthContext } from "@/lib/server/auth-context";
import { getRuntimeDatabaseClient } from "@/lib/server/database";

export const dynamic = "force-dynamic";
export const metadata = { title: "运行健康" };

function statusLabel(status: "healthy" | "warning" | "critical") {
  if (status === "healthy") return "运行正常";
  return status === "warning" ? "需要关注" : "需要立即处理";
}

export default async function OperationsPage() {
  const context = await getAuthContext();
  if (!context) redirect("/sign-in");
  const summary = await getOperationalSummary(getRuntimeDatabaseClient().db, context.scope);
  const metrics = [
    {
      label: "保存失败 · 15 分钟",
      value: summary.metrics.canvasSaveFailures15m,
      detail: `${summary.metrics.canvasSaveConflicts15m} 次版本冲突`,
      icon: DatabaseZap
    },
    {
      label: "来源处理失败 · 24 小时",
      value: summary.metrics.ingestionFailures24h,
      detail: `${summary.metrics.stuckIngestionJobs} 个卡住任务`,
      icon: Activity
    },
    {
      label: "AI 生成失败 · 24 小时",
      value: summary.metrics.generationFailures24h,
      detail: `${summary.metrics.reconciliationRequired} 个待人工核对`,
      icon: Sparkles
    },
    {
      label: "最老活动任务",
      value: `${summary.metrics.oldestActiveQueueAgeSeconds}s`,
      detail: `${summary.metrics.aiRuns1h} 次 AI 运行 / 小时`,
      icon: Clock3
    },
    {
      label: "AI 用量 · 1 小时",
      value: summary.metrics.billedTokens1h.toLocaleString("zh-CN"),
      detail: "输入与输出 token 合计",
      icon: Gauge
    }
  ];

  return (
    <main className="operations-page" id="main-content">
      <header className="operations-header">
        <Link href="/boards" className="icon-button" aria-label="返回 Boards">
          <ArrowLeft size={16} />
        </Link>
        <div>
          <span className="eyebrow">Private alpha operations</span>
          <h1>运行健康</h1>
          <p>仅显示当前工作区的计数、队列时长和标准错误状态，不记录内容。</p>
        </div>
        <span className={`operations-status operations-status--${summary.status}`}>
          {summary.status === "healthy" ? (
            <CheckCircle2 size={15} />
          ) : (
            <AlertTriangle size={15} />
          )}
          {statusLabel(summary.status)}
        </span>
      </header>

      <section className="operations-grid" aria-label="运行指标">
        {metrics.map((metric) => {
          const Icon = metric.icon;
          return (
            <article key={metric.label}>
              <span aria-hidden="true">
                <Icon size={18} />
              </span>
              <small>{metric.label}</small>
              <strong>{metric.value}</strong>
              <p>{metric.detail}</p>
            </article>
          );
        })}
      </section>

      <section className="operations-alerts" aria-labelledby="operations-alert-title">
        <div>
          <span className="eyebrow">Alert inbox</span>
          <h2 id="operations-alert-title">当前告警</h2>
        </div>
        {summary.alerts.length === 0 ? (
          <p className="operations-empty">
            <CheckCircle2 size={16} /> 当前没有达到阈值的告警。
          </p>
        ) : (
          <ul>
            {summary.alerts.map((alert) => (
              <li key={alert.code} data-severity={alert.severity}>
                <AlertTriangle size={15} />
                <span>
                  <strong>{alert.code}</strong>
                  {alert.message}
                </span>
              </li>
            ))}
          </ul>
        )}
        <small>
          更新时间：{new Date(summary.generatedAt).toLocaleString("zh-CN")}
          。告警仅用于私测诊断，不包含提示词、回答、文件名、来源 URL 或签名链接。
        </small>
      </section>
    </main>
  );
}
