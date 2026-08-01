import { z } from "zod";

export const WorkspaceScopeSchema = z.object({
  workspaceId: z.string().uuid(),
  actorUserId: z.string().min(1).max(255)
});

export type WorkspaceScope = z.infer<typeof WorkspaceScopeSchema>;

export function parseWorkspaceScope(value: unknown): WorkspaceScope {
  return WorkspaceScopeSchema.parse(value);
}
