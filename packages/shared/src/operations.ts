export const OPERATIONAL_WINDOWS = Object.freeze({
  burstMinutes: 15,
  usageMinutes: 60,
  historyHours: 24
});

export const OPERATIONAL_THRESHOLDS = Object.freeze({
  canvasSaveFailuresWarning: 3,
  canvasSaveFailuresCritical: 10,
  generationFailuresWarning: 3,
  generationFailuresCritical: 10,
  queueAgeWarningSeconds: 120,
  queueAgeCriticalSeconds: 300,
  usageWarningRatio: 0.8
});

export const operationalEventKinds = [
  "canvas_save_failed",
  "canvas_save_conflict"
] as const;

export type OperationalEventKind = (typeof operationalEventKinds)[number];
export type OperationalSeverity = "warning" | "critical";

export interface OperationalAlert {
  readonly code: string;
  readonly severity: OperationalSeverity;
  readonly message: string;
}

export interface OperationalSummary {
  readonly generatedAt: string;
  readonly status: "healthy" | "warning" | "critical";
  readonly metrics: {
    readonly canvasSaveFailures15m: number;
    readonly canvasSaveConflicts15m: number;
    readonly ingestionFailures24h: number;
    readonly stuckIngestionJobs: number;
    readonly generationFailures24h: number;
    readonly reconciliationRequired: number;
    readonly oldestActiveQueueAgeSeconds: number;
    readonly aiRuns1h: number;
    readonly billedTokens1h: number;
  };
  readonly alerts: readonly OperationalAlert[];
}
