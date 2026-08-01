-- The initial scope-only policies were intentionally easy to inspect, but they allowed
-- a runtime role that knew a workspace UUID to see workspace/membership metadata and
-- to mutate its own membership. Runtime membership management is out of Phase 1, so
-- narrow these two root policies to read-only, active self-membership. A future invite
-- or provisioning path must use a reviewed, least-privilege command rather than broad
-- table writes.
DROP POLICY "workspace_scope" ON "workspace";--> statement-breakpoint
DROP POLICY "workspace_membership_scope" ON "workspace_membership";--> statement-breakpoint

CREATE POLICY "workspace_membership_read_self" ON "workspace_membership"
  FOR SELECT
  USING (
    "workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid
    AND "user_id" = nullif(current_setting('app.user_id', true), '')
    AND "status" = 'active'
  );--> statement-breakpoint

CREATE POLICY "workspace_read_member" ON "workspace"
  FOR SELECT
  USING (
    "id" = nullif(current_setting('app.workspace_id', true), '')::uuid
    AND "app_has_active_membership"("id")
  );
