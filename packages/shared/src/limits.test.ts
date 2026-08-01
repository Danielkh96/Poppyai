import { describe, expect, it } from "vitest";

import { PHASE_1_LIMITS } from "./limits.js";

describe("PHASE_1_LIMITS", () => {
  it("matches the M0-approved safety contract", () => {
    expect(PHASE_1_LIMITS).toEqual({
      text: { maxCharacters: 100_000, maxTxtBytes: 5 * 1024 * 1024 },
      pdf: { maxBytes: 25 * 1024 * 1024, maxPages: 200 },
      webpage: { maxDecodedBytes: 5 * 1024 * 1024, maxRedirects: 3, timeoutMs: 15_000 },
      publicVideo: { maxDurationSeconds: 120 * 60 },
      canvas: {
        maxNodesPerBoard: 500,
        maxEdgesPerBoard: 1_000,
        mutationBatchOperations: 100,
        autosaveDebounceMs: 750
      },
      ai: {
        maxSourcesPerRun: 20,
        maxInputTokens: 64_000,
        reservedOutputTokens: 8_000,
        chatRunsPerWorkspaceHour: 30,
        concurrentRunsPerWorkspace: 1
      },
      ingestion: {
        urlImportsPerWorkspaceHour: 30,
        concurrentJobsPerWorkspace: 2,
        maxAutomaticAttempts: 3
      },
      workspace: { maxStorageBytes: 2 * 1024 * 1024 * 1024 },
      retention: {
        softDeletedNodeDays: 30,
        deletionCompletionDays: 30,
        backupExpiryDays: 35
      }
    });
  });

  it("keeps the AI input budget above the output reserve", () => {
    expect(PHASE_1_LIMITS.ai.maxInputTokens).toBeGreaterThan(
      PHASE_1_LIMITS.ai.reservedOutputTokens
    );
  });

  it("keeps deletion completion inside backup expiry", () => {
    expect(PHASE_1_LIMITS.retention.deletionCompletionDays).toBeLessThanOrEqual(
      PHASE_1_LIMITS.retention.backupExpiryDays
    );
  });
});
