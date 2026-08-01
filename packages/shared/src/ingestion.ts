import { z } from "zod";

import { PHASE_1_LIMITS } from "./limits.js";

export const ASSET_SOURCE_TYPES = ["upload", "webpage", "youtube"] as const;
export const INGESTION_JOB_STATUSES = [
  "queued",
  "running",
  "succeeded",
  "failed",
  "cancelled"
] as const;
export const INGESTION_ATTEMPT_STAGES = [
  "validating",
  "fetching",
  "extracting",
  "transcribing",
  "normalizing",
  "storing"
] as const;

export type AssetSourceType = (typeof ASSET_SOURCE_TYPES)[number];
export type IngestionJobStatus = (typeof INGESTION_JOB_STATUSES)[number];
export type IngestionAttemptStage = (typeof INGESTION_ATTEMPT_STAGES)[number];

const safeFileNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .refine((value) => !/[\u0000-\u001f\u007f]/.test(value), "Filename contains controls");

export const supportedUploadMimeSchema = z.enum(["application/pdf", "text/plain"]);

export const createUploadIntentSchema = z
  .object({
    mutationId: z.uuid(),
    nodeId: z.uuid(),
    fileName: safeFileNameSchema,
    mimeType: supportedUploadMimeSchema,
    size: z.number().int().positive(),
    checksumSha256: z.string().regex(/^[a-f0-9]{64}$/)
  })
  .superRefine((value, context) => {
    const maxBytes =
      value.mimeType === "application/pdf"
        ? PHASE_1_LIMITS.pdf.maxBytes
        : PHASE_1_LIMITS.text.maxTxtBytes;
    if (value.size > maxBytes) {
      context.addIssue({
        code: "too_big",
        maximum: maxBytes,
        origin: "number",
        inclusive: true,
        path: ["size"],
        message: "File exceeds the configured limit"
      });
    }
    const lowerName = value.fileName.toLowerCase();
    const extensionMatches =
      value.mimeType === "application/pdf"
        ? lowerName.endsWith(".pdf")
        : lowerName.endsWith(".txt");
    if (!extensionMatches) {
      context.addIssue({
        code: "custom",
        path: ["fileName"],
        message: "Filename extension does not match the declared MIME type"
      });
    }
  });

export const completeUploadSchema = z.object({
  mutationId: z.uuid(),
  assetId: z.uuid(),
  nodeId: z.uuid()
});

export const submitRemoteSourceSchema = z.object({
  mutationId: z.uuid(),
  nodeId: z.uuid(),
  url: z
    .url()
    .max(2_048)
    .refine((value) => value.startsWith("https://"), "Only HTTPS sources are accepted")
    .refine((value) => {
      const url = new URL(value);
      return url.username === "" && url.password === "";
    }, "Credentials in source URLs are not accepted")
});

export const retryIngestionSchema = z.object({ mutationId: z.uuid() });

export const ingestionErrorSchema = z.object({
  code: z.string().min(1).max(100),
  message: z.string().min(1).max(500),
  retryable: z.boolean()
});

export const ingestionArtifactSummarySchema = z.object({
  id: z.uuid(),
  title: z.string().max(500).nullable(),
  sourceMime: z.string().max(255),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  segmentCount: z.number().int().nonnegative(),
  extractedCharacters: z.number().int().nonnegative(),
  extractorVersion: z.string().min(1).max(100)
});

export const ingestionStatusSchema = z.object({
  id: z.uuid(),
  assetId: z.uuid(),
  nodeId: z.uuid(),
  sourceType: z.enum(ASSET_SOURCE_TYPES),
  status: z.enum(INGESTION_JOB_STATUSES),
  stage: z.enum(INGESTION_ATTEMPT_STAGES).nullable(),
  progress: z.number().int().min(0).max(100),
  revision: z.number().int().nonnegative(),
  warnings: z.array(z.string().min(1).max(100)).max(20),
  error: ingestionErrorSchema.nullable(),
  artifact: ingestionArtifactSummarySchema.nullable(),
  retryOfJobId: z.uuid().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime()
});

export const ingestionStatusListSchema = z.object({
  ingestions: z.array(ingestionStatusSchema)
});

export type CreateUploadIntent = z.infer<typeof createUploadIntentSchema>;
export type CompleteUpload = z.infer<typeof completeUploadSchema>;
export type SubmitRemoteSource = z.infer<typeof submitRemoteSourceSchema>;
export type RetryIngestion = z.infer<typeof retryIngestionSchema>;
export type IngestionStatus = z.infer<typeof ingestionStatusSchema>;
export type IngestionArtifactSummary = z.infer<typeof ingestionArtifactSummarySchema>;

export const INGESTION_QUEUE = "ingestion.process";
export const INGESTION_CLEANUP_QUEUE = "ingestion.cleanup";

export const ingestionQueuePayloadSchema = z.object({ jobId: z.uuid() });
export type IngestionQueuePayload = z.infer<typeof ingestionQueuePayloadSchema>;
