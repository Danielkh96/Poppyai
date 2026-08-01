const MIB = 1024 * 1024;
const GIB = 1024 * MIB;

/**
 * Phase 1 private-alpha safety and spend limits. Every API and worker adapter must
 * import these values (or an injected stricter configuration) rather than duplicate
 * literals. Commercial quota approval is still tracked in the M0 decision register.
 */
export const PHASE_1_LIMITS = Object.freeze({
  text: {
    maxCharacters: 100_000,
    maxTxtBytes: 5 * MIB
  },
  pdf: {
    maxBytes: 25 * MIB,
    maxPages: 200
  },
  webpage: {
    maxDecodedBytes: 5 * MIB,
    maxRedirects: 3,
    timeoutMs: 15_000
  },
  publicVideo: {
    maxDurationSeconds: 120 * 60
  },
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
  workspace: {
    maxStorageBytes: 2 * GIB
  },
  retention: {
    softDeletedNodeDays: 30,
    deletionCompletionDays: 30,
    backupExpiryDays: 35
  }
});

export type Phase1Limits = typeof PHASE_1_LIMITS;
