CREATE TYPE "public"."asset_source_type" AS ENUM('upload', 'webpage', 'youtube');--> statement-breakpoint
CREATE TYPE "public"."asset_status" AS ENUM('pending', 'verified', 'ready', 'failed', 'quarantined');--> statement-breakpoint
CREATE TYPE "public"."ingestion_attempt_stage" AS ENUM('validating', 'fetching', 'extracting', 'transcribing', 'normalizing', 'storing');--> statement-breakpoint
CREATE TYPE "public"."ingestion_attempt_status" AS ENUM('queued', 'running', 'succeeded', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."ingestion_job_status" AS ENUM('queued', 'running', 'succeeded', 'failed', 'cancelled');--> statement-breakpoint
CREATE TABLE "asset" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"board_id" uuid NOT NULL,
	"source_type" "asset_source_type" NOT NULL,
	"status" "asset_status" DEFAULT 'pending' NOT NULL,
	"object_key" text,
	"original_file_name" text,
	"source_url" text,
	"declared_mime" text,
	"detected_mime" text,
	"declared_size" bigint,
	"actual_size" bigint,
	"content_hash" text,
	"upload_mutation_id" uuid,
	"completion_mutation_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "asset_source_locator_present" CHECK (("asset"."source_type" = 'upload' AND "asset"."object_key" IS NOT NULL AND "asset"."source_url" IS NULL)
        OR ("asset"."source_type" IN ('webpage', 'youtube') AND "asset"."source_url" IS NOT NULL AND "asset"."object_key" IS NULL)),
	CONSTRAINT "asset_size_nonnegative" CHECK ("asset"."declared_size" IS NULL OR "asset"."declared_size" > 0),
	CONSTRAINT "asset_actual_size_nonnegative" CHECK ("asset"."actual_size" IS NULL OR "asset"."actual_size" > 0)
);
--> statement-breakpoint
CREATE TABLE "extraction_artifact" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"board_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"attempt_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"title" text,
	"source_mime" text NOT NULL,
	"content_hash" text NOT NULL,
	"extractor_version" text NOT NULL,
	"extracted_characters" integer NOT NULL,
	"warning_codes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"provenance" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "extraction_artifact_version_positive" CHECK ("extraction_artifact"."version" > 0),
	CONSTRAINT "extraction_artifact_characters_nonnegative" CHECK ("extraction_artifact"."extracted_characters" >= 0)
);
--> statement-breakpoint
CREATE TABLE "extraction_segment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"board_id" uuid NOT NULL,
	"artifact_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"text" text NOT NULL,
	"location" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"content_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "extraction_segment_ordinal_nonnegative" CHECK ("extraction_segment"."ordinal" >= 0),
	CONSTRAINT "extraction_segment_text_not_empty" CHECK (char_length("extraction_segment"."text") > 0)
);
--> statement-breakpoint
CREATE TABLE "ingestion_attempt" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"board_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"attempt_number" integer NOT NULL,
	"status" "ingestion_attempt_status" DEFAULT 'queued' NOT NULL,
	"stage" "ingestion_attempt_stage" DEFAULT 'validating' NOT NULL,
	"progress" integer DEFAULT 0 NOT NULL,
	"lease_token" uuid NOT NULL,
	"error_code" text,
	"error_message" text,
	"retryable" boolean DEFAULT false NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ingestion_attempt_number_positive" CHECK ("ingestion_attempt"."attempt_number" > 0),
	CONSTRAINT "ingestion_attempt_progress_bounds" CHECK ("ingestion_attempt"."progress" BETWEEN 0 AND 100),
	CONSTRAINT "ingestion_attempt_terminal_finished" CHECK ("ingestion_attempt"."status" NOT IN ('succeeded', 'failed', 'cancelled') OR "ingestion_attempt"."finished_at" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "ingestion_job" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"board_id" uuid NOT NULL,
	"node_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"submission_mutation_id" uuid NOT NULL,
	"retry_of_job_id" uuid,
	"status" "ingestion_job_status" DEFAULT 'queued' NOT NULL,
	"warning_codes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error_code" text,
	"error_message" text,
	"retryable" boolean DEFAULT false NOT NULL,
	"revision" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "ingestion_job_revision_nonnegative" CHECK ("ingestion_job"."revision" >= 0),
	CONSTRAINT "ingestion_job_terminal_finished" CHECK ("ingestion_job"."status" NOT IN ('succeeded', 'failed', 'cancelled') OR "ingestion_job"."finished_at" IS NOT NULL)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "asset_workspace_board_id_unique" ON "asset" USING btree ("workspace_id","board_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "extraction_artifact_workspace_board_id_unique" ON "extraction_artifact" USING btree ("workspace_id","board_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "ingestion_attempt_workspace_board_id_unique" ON "ingestion_attempt" USING btree ("workspace_id","board_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "ingestion_job_workspace_board_id_unique" ON "ingestion_job" USING btree ("workspace_id","board_id","id");--> statement-breakpoint
ALTER TABLE "asset" ADD CONSTRAINT "asset_board_scope_fk" FOREIGN KEY ("workspace_id","board_id") REFERENCES "public"."board"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extraction_artifact" ADD CONSTRAINT "extraction_artifact_asset_scope_fk" FOREIGN KEY ("workspace_id","board_id","asset_id") REFERENCES "public"."asset"("workspace_id","board_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extraction_artifact" ADD CONSTRAINT "extraction_artifact_job_scope_fk" FOREIGN KEY ("workspace_id","board_id","job_id") REFERENCES "public"."ingestion_job"("workspace_id","board_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extraction_artifact" ADD CONSTRAINT "extraction_artifact_attempt_scope_fk" FOREIGN KEY ("workspace_id","board_id","attempt_id") REFERENCES "public"."ingestion_attempt"("workspace_id","board_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extraction_segment" ADD CONSTRAINT "extraction_segment_artifact_scope_fk" FOREIGN KEY ("workspace_id","board_id","artifact_id") REFERENCES "public"."extraction_artifact"("workspace_id","board_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingestion_attempt" ADD CONSTRAINT "ingestion_attempt_job_scope_fk" FOREIGN KEY ("workspace_id","board_id","job_id") REFERENCES "public"."ingestion_job"("workspace_id","board_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingestion_job" ADD CONSTRAINT "ingestion_job_board_scope_fk" FOREIGN KEY ("workspace_id","board_id") REFERENCES "public"."board"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingestion_job" ADD CONSTRAINT "ingestion_job_node_scope_fk" FOREIGN KEY ("workspace_id","board_id","node_id") REFERENCES "public"."node"("workspace_id","board_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingestion_job" ADD CONSTRAINT "ingestion_job_asset_scope_fk" FOREIGN KEY ("workspace_id","board_id","asset_id") REFERENCES "public"."asset"("workspace_id","board_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "asset_workspace_upload_mutation_unique" ON "asset" USING btree ("workspace_id","upload_mutation_id") WHERE "asset"."upload_mutation_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "asset_workspace_object_key_unique" ON "asset" USING btree ("workspace_id","object_key") WHERE "asset"."object_key" is not null;--> statement-breakpoint
CREATE INDEX "asset_workspace_board_created_idx" ON "asset" USING btree ("workspace_id","board_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "extraction_artifact_asset_version_unique" ON "extraction_artifact" USING btree ("workspace_id","asset_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "extraction_artifact_attempt_unique" ON "extraction_artifact" USING btree ("attempt_id");--> statement-breakpoint
CREATE UNIQUE INDEX "extraction_segment_artifact_ordinal_unique" ON "extraction_segment" USING btree ("artifact_id","ordinal");--> statement-breakpoint
CREATE INDEX "extraction_segment_workspace_artifact_idx" ON "extraction_segment" USING btree ("workspace_id","artifact_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ingestion_attempt_workspace_job_number_unique" ON "ingestion_attempt" USING btree ("workspace_id","job_id","attempt_number");--> statement-breakpoint
CREATE INDEX "ingestion_attempt_job_created_idx" ON "ingestion_attempt" USING btree ("job_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ingestion_job_workspace_submission_unique" ON "ingestion_job" USING btree ("workspace_id","submission_mutation_id");--> statement-breakpoint
CREATE INDEX "ingestion_job_workspace_board_updated_idx" ON "ingestion_job" USING btree ("workspace_id","board_id","updated_at");--> statement-breakpoint
CREATE INDEX "ingestion_job_asset_idx" ON "ingestion_job" USING btree ("workspace_id","asset_id");
--> statement-breakpoint
ALTER TABLE "ingestion_job" ADD CONSTRAINT "ingestion_job_retry_scope_fk"
  FOREIGN KEY ("workspace_id", "board_id", "retry_of_job_id")
  REFERENCES "public"."ingestion_job"("workspace_id", "board_id", "id")
  ON DELETE NO ACTION ON UPDATE NO ACTION;--> statement-breakpoint

ALTER TABLE "asset" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ingestion_job" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ingestion_attempt" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "extraction_artifact" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "extraction_segment" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint

ALTER TABLE "asset" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ingestion_job" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ingestion_attempt" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "extraction_artifact" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "extraction_segment" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

CREATE POLICY "asset_tenant_isolation" ON "asset"
  USING (
    "workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid
    AND "app_has_active_membership"("workspace_id")
  )
  WITH CHECK (
    "workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid
    AND "app_has_active_membership"("workspace_id")
  );--> statement-breakpoint

CREATE POLICY "ingestion_job_tenant_isolation" ON "ingestion_job"
  USING (
    "workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid
    AND "app_has_active_membership"("workspace_id")
  )
  WITH CHECK (
    "workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid
    AND "app_has_active_membership"("workspace_id")
  );--> statement-breakpoint

CREATE POLICY "ingestion_attempt_tenant_isolation" ON "ingestion_attempt"
  USING (
    "workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid
    AND "app_has_active_membership"("workspace_id")
  )
  WITH CHECK (
    "workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid
    AND "app_has_active_membership"("workspace_id")
  );--> statement-breakpoint

CREATE POLICY "extraction_artifact_tenant_isolation" ON "extraction_artifact"
  USING (
    "workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid
    AND "app_has_active_membership"("workspace_id")
  )
  WITH CHECK (
    "workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid
    AND "app_has_active_membership"("workspace_id")
  );--> statement-breakpoint

CREATE POLICY "extraction_segment_tenant_isolation" ON "extraction_segment"
  USING (
    "workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid
    AND "app_has_active_membership"("workspace_id")
  )
  WITH CHECK (
    "workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid
    AND "app_has_active_membership"("workspace_id")
  );--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE ON TABLE
  asset,
  ingestion_job
TO siftloom_web;--> statement-breakpoint
GRANT SELECT ON TABLE
  ingestion_attempt,
  extraction_artifact,
  extraction_segment
TO siftloom_web;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  asset,
  ingestion_job,
  ingestion_attempt,
  extraction_artifact,
  extraction_segment
TO siftloom_worker;--> statement-breakpoint

CREATE FUNCTION "resolve_ingestion_job_scope"("target_job_id" uuid)
RETURNS TABLE (
  "workspace_id" uuid,
  "board_id" uuid,
  "actor_user_id" text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    job."workspace_id",
    job."board_id",
    membership."user_id"
  FROM "ingestion_job" AS job
  JOIN "workspace_membership" AS membership
    ON membership."workspace_id" = job."workspace_id"
   AND membership."status" = 'active'
  WHERE job."id" = "target_job_id"
  ORDER BY (membership."role" = 'owner') DESC, membership."created_at", membership."user_id"
  LIMIT 1
$$;--> statement-breakpoint

REVOKE ALL ON FUNCTION resolve_ingestion_job_scope(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION resolve_ingestion_job_scope(uuid) TO siftloom_worker;
