import { z } from "zod";

export const BOARD_NAME_MAX_LENGTH = 120;
export const UNTITLED_BOARD_NAME = "未命名 Board";

const optionalBoardNameSchema = z
  .string()
  .trim()
  .max(BOARD_NAME_MAX_LENGTH)
  .optional()
  .transform((value) => (value && value.length > 0 ? value : undefined));

export const createBoardCommandSchema = z
  .object({
    mutationId: z.uuid(),
    name: optionalBoardNameSchema
  })
  .strict();

export const boardMutationSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("rename"),
      name: z.string().trim().min(1).max(BOARD_NAME_MAX_LENGTH)
    })
    .strict(),
  z.object({ action: z.literal("archive") }).strict(),
  z.object({ action: z.literal("restore") }).strict()
]);

export const boardListViewSchema = z.enum(["active", "archived"]);

export type CreateBoardCommand = z.infer<typeof createBoardCommandSchema>;
export type BoardMutation = z.infer<typeof boardMutationSchema>;
export type BoardListView = z.infer<typeof boardListViewSchema>;

export const boardSummarySchema = z.object({
  id: z.uuid(),
  name: z.string().min(1).max(BOARD_NAME_MAX_LENGTH),
  revision: z.number().int().nonnegative(),
  archivedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime()
});

export const boardSnapshotSchema = boardSummarySchema.extend({
  nodes: z.array(z.unknown()),
  edges: z.array(z.unknown())
});

export type BoardSummary = z.infer<typeof boardSummarySchema>;
export type BoardSnapshot = z.infer<typeof boardSnapshotSchema>;
