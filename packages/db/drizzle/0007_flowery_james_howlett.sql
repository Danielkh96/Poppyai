CREATE TYPE "public"."chat_message_role" AS ENUM('user', 'assistant');--> statement-breakpoint
CREATE TYPE "public"."chat_run_status" AS ENUM('queued', 'running', 'completed', 'cancelled', 'failed', 'reconciliation_required');--> statement-breakpoint
CREATE TYPE "public"."provider_attempt_status" AS ENUM('pending', 'running', 'succeeded', 'failed', 'indeterminate', 'cancelled');--> statement-breakpoint
CREATE TABLE "chat_message_source" (
	"workspace_id" uuid NOT NULL,
	"board_id" uuid NOT NULL,
	"message_id" uuid NOT NULL,
	"snapshot_id" uuid NOT NULL,
	"source_handle" text NOT NULL,
	"ordinal" integer NOT NULL,
	CONSTRAINT "chat_message_source_message_id_snapshot_id_pk" PRIMARY KEY("message_id","snapshot_id"),
	CONSTRAINT "chat_message_source_ordinal_nonnegative" CHECK ("chat_message_source"."ordinal" >= 0)
);
--> statement-breakpoint
CREATE TABLE "chat_message" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"board_id" uuid NOT NULL,
	"chat_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"role" "chat_message_role" NOT NULL,
	"sequence" bigint NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chat_message_sequence_nonnegative" CHECK ("chat_message"."sequence" >= 0),
	CONSTRAINT "chat_message_content_not_empty" CHECK (char_length("chat_message"."content") > 0)
);
--> statement-breakpoint
CREATE TABLE "chat_run_event" (
	"workspace_id" uuid NOT NULL,
	"board_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"sequence" bigint NOT NULL,
	"type" text NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chat_run_event_run_id_sequence_pk" PRIMARY KEY("run_id","sequence"),
	CONSTRAINT "chat_run_event_sequence_positive" CHECK ("chat_run_event"."sequence" > 0),
	CONSTRAINT "chat_run_event_type_valid" CHECK ("chat_run_event"."type" IN ('started', 'delta', 'snapshot', 'completed', 'failed', 'cancelled', 'reconciliation_required'))
);
--> statement-breakpoint
CREATE TABLE "chat_run" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"board_id" uuid NOT NULL,
	"chat_id" uuid NOT NULL,
	"mutation_id" uuid NOT NULL,
	"retry_of_run_id" uuid,
	"status" "chat_run_status" DEFAULT 'queued' NOT NULL,
	"provider_name" text NOT NULL,
	"model" text NOT NULL,
	"streamed_text" text DEFAULT '' NOT NULL,
	"stream_sequence" bigint DEFAULT 0 NOT NULL,
	"cancellation_requested_at" timestamp with time zone,
	"error_code" text,
	"error_message" text,
	"retryable" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chat_run_sequence_nonnegative" CHECK ("chat_run"."stream_sequence" >= 0),
	CONSTRAINT "chat_run_terminal_finished" CHECK ("chat_run"."status" NOT IN ('completed', 'cancelled', 'failed', 'reconciliation_required') OR "chat_run"."finished_at" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "chat" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"board_id" uuid NOT NULL,
	"node_id" uuid NOT NULL,
	"next_message_sequence" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chat_next_sequence_nonnegative" CHECK ("chat"."next_message_sequence" >= 0)
);
--> statement-breakpoint
CREATE TABLE "context_manifest" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"board_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"scope_hash" text NOT NULL,
	"source_tokens" integer NOT NULL,
	"history_tokens" integer NOT NULL,
	"output_reserve_tokens" integer NOT NULL,
	"included_history_message_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"exclusions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "context_manifest_source_tokens_nonnegative" CHECK ("context_manifest"."source_tokens" >= 0),
	CONSTRAINT "context_manifest_history_tokens_nonnegative" CHECK ("context_manifest"."history_tokens" >= 0),
	CONSTRAINT "context_manifest_output_tokens_positive" CHECK ("context_manifest"."output_reserve_tokens" > 0)
);
--> statement-breakpoint
CREATE TABLE "context_source_snapshot" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"board_id" uuid NOT NULL,
	"manifest_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"node_id" uuid NOT NULL,
	"node_revision" bigint NOT NULL,
	"source_handle" text NOT NULL,
	"title" text NOT NULL,
	"source_kind" "canvas_node_kind" NOT NULL,
	"exact_text" text NOT NULL,
	"content_hash" text NOT NULL,
	"artifact_id" uuid,
	"artifact_version" integer,
	"segment_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"truncated" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "context_snapshot_revision_nonnegative" CHECK ("context_source_snapshot"."node_revision" >= 0),
	CONSTRAINT "context_snapshot_text_not_empty" CHECK (char_length("context_source_snapshot"."exact_text") > 0),
	CONSTRAINT "context_snapshot_handle_format" CHECK ("context_source_snapshot"."source_handle" ~ '^S[1-9][0-9]*$')
);
--> statement-breakpoint
CREATE TABLE "provider_attempt" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"board_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"idempotency_key" text NOT NULL,
	"provider_name" text NOT NULL,
	"model" text NOT NULL,
	"status" "provider_attempt_status" DEFAULT 'pending' NOT NULL,
	"provider_request_id" text,
	"input_tokens" integer,
	"cached_input_tokens" integer,
	"output_tokens" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "usage_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"board_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"provider_attempt_id" uuid NOT NULL,
	"idempotency_key" text NOT NULL,
	"input_tokens" integer NOT NULL,
	"cached_input_tokens" integer NOT NULL,
	"output_tokens" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "usage_input_tokens_nonnegative" CHECK ("usage_event"."input_tokens" >= 0),
	CONSTRAINT "usage_cached_tokens_nonnegative" CHECK ("usage_event"."cached_input_tokens" >= 0),
	CONSTRAINT "usage_output_tokens_nonnegative" CHECK ("usage_event"."output_tokens" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "chat_message_workspace_board_id_unique" ON "chat_message" USING btree ("workspace_id","board_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "chat_run_workspace_board_id_unique" ON "chat_run" USING btree ("workspace_id","board_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "chat_workspace_board_id_unique" ON "chat" USING btree ("workspace_id","board_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "context_manifest_workspace_board_id_unique" ON "context_manifest" USING btree ("workspace_id","board_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "context_snapshot_workspace_board_id_unique" ON "context_source_snapshot" USING btree ("workspace_id","board_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_attempt_workspace_board_id_unique" ON "provider_attempt" USING btree ("workspace_id","board_id","id");--> statement-breakpoint
ALTER TABLE "chat_message_source" ADD CONSTRAINT "chat_message_source_message_scope_fk" FOREIGN KEY ("workspace_id","board_id","message_id") REFERENCES "public"."chat_message"("workspace_id","board_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_message_source" ADD CONSTRAINT "chat_message_source_snapshot_scope_fk" FOREIGN KEY ("workspace_id","board_id","snapshot_id") REFERENCES "public"."context_source_snapshot"("workspace_id","board_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_message" ADD CONSTRAINT "chat_message_chat_scope_fk" FOREIGN KEY ("workspace_id","board_id","chat_id") REFERENCES "public"."chat"("workspace_id","board_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_message" ADD CONSTRAINT "chat_message_run_scope_fk" FOREIGN KEY ("workspace_id","board_id","run_id") REFERENCES "public"."chat_run"("workspace_id","board_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_run_event" ADD CONSTRAINT "chat_run_event_run_scope_fk" FOREIGN KEY ("workspace_id","board_id","run_id") REFERENCES "public"."chat_run"("workspace_id","board_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_run" ADD CONSTRAINT "chat_run_chat_scope_fk" FOREIGN KEY ("workspace_id","board_id","chat_id") REFERENCES "public"."chat"("workspace_id","board_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_run" ADD CONSTRAINT "chat_run_retry_scope_fk" FOREIGN KEY ("workspace_id","board_id","retry_of_run_id") REFERENCES "public"."chat_run"("workspace_id","board_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat" ADD CONSTRAINT "chat_node_scope_fk" FOREIGN KEY ("workspace_id","board_id","node_id") REFERENCES "public"."node"("workspace_id","board_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "context_manifest" ADD CONSTRAINT "context_manifest_run_scope_fk" FOREIGN KEY ("workspace_id","board_id","run_id") REFERENCES "public"."chat_run"("workspace_id","board_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "context_source_snapshot" ADD CONSTRAINT "context_snapshot_manifest_scope_fk" FOREIGN KEY ("workspace_id","board_id","manifest_id") REFERENCES "public"."context_manifest"("workspace_id","board_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "context_source_snapshot" ADD CONSTRAINT "context_snapshot_run_scope_fk" FOREIGN KEY ("workspace_id","board_id","run_id") REFERENCES "public"."chat_run"("workspace_id","board_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "context_source_snapshot" ADD CONSTRAINT "context_snapshot_node_scope_fk" FOREIGN KEY ("workspace_id","board_id","node_id") REFERENCES "public"."node"("workspace_id","board_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_attempt" ADD CONSTRAINT "provider_attempt_run_scope_fk" FOREIGN KEY ("workspace_id","board_id","run_id") REFERENCES "public"."chat_run"("workspace_id","board_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_event" ADD CONSTRAINT "usage_event_run_scope_fk" FOREIGN KEY ("workspace_id","board_id","run_id") REFERENCES "public"."chat_run"("workspace_id","board_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_event" ADD CONSTRAINT "usage_event_attempt_scope_fk" FOREIGN KEY ("workspace_id","board_id","provider_attempt_id") REFERENCES "public"."provider_attempt"("workspace_id","board_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "chat_message_source_handle_unique" ON "chat_message_source" USING btree ("message_id","source_handle");--> statement-breakpoint
CREATE UNIQUE INDEX "chat_message_chat_sequence_unique" ON "chat_message" USING btree ("workspace_id","chat_id","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "chat_message_assistant_run_unique" ON "chat_message" USING btree ("run_id") WHERE "chat_message"."role" = 'assistant';--> statement-breakpoint
CREATE UNIQUE INDEX "chat_run_workspace_mutation_unique" ON "chat_run" USING btree ("workspace_id","mutation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "chat_run_one_active_per_chat_unique" ON "chat_run" USING btree ("workspace_id","chat_id") WHERE "chat_run"."status" IN ('queued', 'running');--> statement-breakpoint
CREATE INDEX "chat_run_chat_created_idx" ON "chat_run" USING btree ("workspace_id","chat_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "chat_workspace_board_node_unique" ON "chat" USING btree ("workspace_id","board_id","node_id");--> statement-breakpoint
CREATE UNIQUE INDEX "context_manifest_run_unique" ON "context_manifest" USING btree ("run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "context_snapshot_run_handle_unique" ON "context_source_snapshot" USING btree ("run_id","source_handle");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_attempt_run_unique" ON "provider_attempt" USING btree ("run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_attempt_idempotency_unique" ON "provider_attempt" USING btree ("provider_name","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "usage_event_workspace_board_id_unique" ON "usage_event" USING btree ("workspace_id","board_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "usage_event_idempotency_unique" ON "usage_event" USING btree ("workspace_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "usage_event_run_unique" ON "usage_event" USING btree ("run_id");
--> statement-breakpoint

ALTER TABLE "chat" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "chat_run" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "chat_message" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "chat_message_source" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "context_manifest" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "context_source_snapshot" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "provider_attempt" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "usage_event" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "chat_run_event" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint

ALTER TABLE "chat" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "chat_run" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "chat_message" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "chat_message_source" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "context_manifest" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "context_source_snapshot" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "provider_attempt" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "usage_event" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "chat_run_event" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

CREATE POLICY "chat_tenant_isolation" ON "chat"
  USING (
    "workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid
    AND "app_has_active_membership"("workspace_id")
  )
  WITH CHECK (
    "workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid
    AND "app_has_active_membership"("workspace_id")
  );--> statement-breakpoint

CREATE POLICY "chat_run_tenant_isolation" ON "chat_run"
  USING (
    "workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid
    AND "app_has_active_membership"("workspace_id")
  )
  WITH CHECK (
    "workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid
    AND "app_has_active_membership"("workspace_id")
  );--> statement-breakpoint

CREATE POLICY "chat_message_tenant_isolation" ON "chat_message"
  USING (
    "workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid
    AND "app_has_active_membership"("workspace_id")
  )
  WITH CHECK (
    "workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid
    AND "app_has_active_membership"("workspace_id")
  );--> statement-breakpoint

CREATE POLICY "chat_message_source_tenant_isolation" ON "chat_message_source"
  USING (
    "workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid
    AND "app_has_active_membership"("workspace_id")
  )
  WITH CHECK (
    "workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid
    AND "app_has_active_membership"("workspace_id")
  );--> statement-breakpoint

CREATE POLICY "context_manifest_tenant_isolation" ON "context_manifest"
  USING (
    "workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid
    AND "app_has_active_membership"("workspace_id")
  )
  WITH CHECK (
    "workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid
    AND "app_has_active_membership"("workspace_id")
  );--> statement-breakpoint

CREATE POLICY "context_source_snapshot_tenant_isolation" ON "context_source_snapshot"
  USING (
    "workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid
    AND "app_has_active_membership"("workspace_id")
  )
  WITH CHECK (
    "workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid
    AND "app_has_active_membership"("workspace_id")
  );--> statement-breakpoint

CREATE POLICY "provider_attempt_tenant_isolation" ON "provider_attempt"
  USING (
    "workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid
    AND "app_has_active_membership"("workspace_id")
  )
  WITH CHECK (
    "workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid
    AND "app_has_active_membership"("workspace_id")
  );--> statement-breakpoint

CREATE POLICY "usage_event_tenant_isolation" ON "usage_event"
  USING (
    "workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid
    AND "app_has_active_membership"("workspace_id")
  )
  WITH CHECK (
    "workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid
    AND "app_has_active_membership"("workspace_id")
  );--> statement-breakpoint

CREATE POLICY "chat_run_event_tenant_isolation" ON "chat_run_event"
  USING (
    "workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid
    AND "app_has_active_membership"("workspace_id")
  )
  WITH CHECK (
    "workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid
    AND "app_has_active_membership"("workspace_id")
  );--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE ON TABLE
  chat,
  chat_run,
  provider_attempt
TO siftloom_web;--> statement-breakpoint

GRANT SELECT, INSERT ON TABLE
  chat_message,
  chat_message_source,
  context_manifest,
  context_source_snapshot,
  chat_run_event,
  usage_event
TO siftloom_web;
