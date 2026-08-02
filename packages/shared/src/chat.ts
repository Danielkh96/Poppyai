import { z } from "zod";

export const CHAT_RUN_STATUSES = [
  "queued",
  "running",
  "completed",
  "cancelled",
  "failed",
  "reconciliation_required"
] as const;

export const chatRunStatusSchema = z.enum(CHAT_RUN_STATUSES);
export type ChatRunStatus = z.infer<typeof chatRunStatusSchema>;

export const CHAT_RUN_TERMINAL_STATUSES = [
  "completed",
  "cancelled",
  "failed",
  "reconciliation_required"
] as const satisfies readonly ChatRunStatus[];

export const chatRunCreateCommandSchema = z.object({
  mutationId: z.uuid(),
  prompt: z.string().trim().min(1).max(20_000),
  selectedSourceNodeIds: z.array(z.uuid()).max(100).default([]),
  retryOfRunId: z.uuid().nullable().default(null)
});

export type ChatRunCreateCommand = z.infer<typeof chatRunCreateCommandSchema>;

export const chatCitationSchema = z.object({
  handle: z.string().regex(/^S[1-9][0-9]*$/),
  snapshotId: z.uuid(),
  nodeId: z.uuid(),
  nodeRevision: z.number().int().nonnegative(),
  title: z.string().max(120),
  sourceChanged: z.boolean()
});

export type ChatCitation = z.infer<typeof chatCitationSchema>;

export const chatMessageSchema = z.object({
  id: z.uuid(),
  role: z.enum(["user", "assistant"]),
  content: z.string(),
  sequence: z.number().int().nonnegative(),
  runId: z.uuid(),
  citations: z.array(chatCitationSchema).default([]),
  createdAt: z.iso.datetime()
});

export type ChatMessage = z.infer<typeof chatMessageSchema>;

export const chatRunSchema = z.object({
  id: z.uuid(),
  status: chatRunStatusSchema,
  error: z
    .object({
      code: z.string(),
      message: z.string(),
      retryable: z.boolean()
    })
    .nullable(),
  exclusions: z.array(
    z.object({
      nodeId: z.uuid().nullable(),
      title: z.string(),
      reason: z.string()
    })
  ),
  sourceCount: z.number().int().nonnegative(),
  createdAt: z.iso.datetime(),
  finishedAt: z.iso.datetime().nullable()
});

export type ChatRun = z.infer<typeof chatRunSchema>;

export const chatThreadSchema = z.object({
  chatId: z.uuid().nullable(),
  nodeId: z.uuid(),
  messages: z.array(chatMessageSchema),
  activeRun: chatRunSchema.nullable(),
  latestRun: chatRunSchema.nullable()
});

export type ChatThread = z.infer<typeof chatThreadSchema>;

export const CHAT_STREAM_EVENT_TYPES = [
  "started",
  "delta",
  "snapshot",
  "completed",
  "failed",
  "cancelled",
  "reconciliation_required"
] as const;

export const chatStreamEventSchema = z.object({
  sequence: z.number().int().positive(),
  type: z.enum(CHAT_STREAM_EVENT_TYPES),
  data: z.object({
    text: z.string().optional(),
    messageId: z.uuid().optional(),
    errorCode: z.string().optional(),
    retryable: z.boolean().optional()
  })
});

export type ChatStreamEvent = z.infer<typeof chatStreamEventSchema>;

export const chatSourceSnapshotSchema = z.object({
  id: z.uuid(),
  handle: z.string().regex(/^S[1-9][0-9]*$/),
  nodeId: z.uuid(),
  nodeRevision: z.number().int().nonnegative(),
  title: z.string(),
  exactText: z.string(),
  contentHash: z.string(),
  artifactId: z.uuid().nullable(),
  artifactVersion: z.number().int().positive().nullable(),
  segmentIds: z.array(z.uuid()),
  truncated: z.boolean(),
  sourceChanged: z.boolean()
});

export type ChatSourceSnapshot = z.infer<typeof chatSourceSnapshotSchema>;
