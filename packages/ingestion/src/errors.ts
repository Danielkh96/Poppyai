export class IngestionError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable: boolean
  ) {
    super(message);
    this.name = "IngestionError";
  }
}

export function normalizeIngestionError(error: unknown): IngestionError {
  if (error instanceof IngestionError) return error;
  if (error instanceof Error && error.name === "AbortError") {
    return new IngestionError("source_timeout", "来源处理超时，请稍后重试。", true);
  }
  return new IngestionError("processing_failed", "来源处理失败，请稍后重试。", true);
}
