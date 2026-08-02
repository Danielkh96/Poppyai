CREATE TYPE "public"."operational_event_kind" AS ENUM('canvas_save_failed', 'canvas_save_conflict');--> statement-breakpoint
CREATE TABLE "operational_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"board_id" uuid,
	"kind" "operational_event_kind" NOT NULL,
	"error_code" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "operational_event_error_code_format" CHECK ("operational_event"."error_code" ~ '^[A-Z][A-Z0-9_]{2,63}$')
);
--> statement-breakpoint
ALTER TABLE "operational_event" ADD CONSTRAINT "operational_event_board_scope_fk" FOREIGN KEY ("workspace_id","board_id") REFERENCES "public"."board"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "operational_event_workspace_created_idx" ON "operational_event" USING btree ("workspace_id","created_at");--> statement-breakpoint

ALTER TABLE "operational_event" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "operational_event" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

CREATE POLICY "operational_event_tenant_isolation" ON "operational_event"
  USING (
    "workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid
    AND "app_has_active_membership"("workspace_id")
  )
  WITH CHECK (
    "workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid
    AND "app_has_active_membership"("workspace_id")
  );--> statement-breakpoint

GRANT SELECT, INSERT ON TABLE operational_event TO siftloom_web;
