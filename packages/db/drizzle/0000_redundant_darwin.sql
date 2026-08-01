CREATE TYPE "public"."canvas_node_kind" AS ENUM('note', 'text', 'pdf', 'webpage', 'video', 'chat', 'group');--> statement-breakpoint
CREATE TYPE "public"."membership_role" AS ENUM('owner', 'member');--> statement-breakpoint
CREATE TYPE "public"."membership_status" AS ENUM('active', 'suspended');--> statement-breakpoint
CREATE TABLE "board" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"revision" bigint DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "board_revision_nonnegative" CHECK ("board"."revision" >= 0)
);
--> statement-breakpoint
CREATE TABLE "edge" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"board_id" uuid NOT NULL,
	"source_node_id" uuid NOT NULL,
	"target_node_id" uuid NOT NULL,
	"rank" bigint DEFAULT 0 NOT NULL,
	"revision" bigint DEFAULT 0 NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "edge_not_self" CHECK ("edge"."source_node_id" <> "edge"."target_node_id"),
	CONSTRAINT "edge_revision_nonnegative" CHECK ("edge"."revision" >= 0)
);
--> statement-breakpoint
CREATE TABLE "mutation_receipt" (
	"workspace_id" uuid NOT NULL,
	"board_id" uuid NOT NULL,
	"mutation_id" uuid NOT NULL,
	"base_revision" bigint NOT NULL,
	"result_revision" bigint NOT NULL,
	"response_payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mutation_receipt_workspace_id_board_id_mutation_id_pk" PRIMARY KEY("workspace_id","board_id","mutation_id"),
	CONSTRAINT "mutation_revision_order" CHECK ("mutation_receipt"."result_revision" >= "mutation_receipt"."base_revision")
);
--> statement-breakpoint
CREATE TABLE "node" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"board_id" uuid NOT NULL,
	"kind" "canvas_node_kind" NOT NULL,
	"x" real NOT NULL,
	"y" real NOT NULL,
	"width" real NOT NULL,
	"height" real NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"revision" bigint DEFAULT 0 NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "node_revision_nonnegative" CHECK ("node"."revision" >= 0),
	CONSTRAINT "node_geometry_finite_bounds" CHECK (
      "node"."x" BETWEEN -1000000 AND 1000000 AND
      "node"."y" BETWEEN -1000000 AND 1000000 AND
      "node"."width" BETWEEN 80 AND 4000 AND
      "node"."height" BETWEEN 60 AND 4000
    )
);
--> statement-breakpoint
CREATE TABLE "workspace_membership" (
	"workspace_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"role" "membership_role" DEFAULT 'member' NOT NULL,
	"status" "membership_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_membership_workspace_id_user_id_pk" PRIMARY KEY("workspace_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "workspace" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- Referenced composite uniqueness must exist before PostgreSQL creates the scoped
-- foreign keys below. Drizzle otherwise emits these indexes after the constraints.
CREATE UNIQUE INDEX "board_workspace_id_unique" ON "board" USING btree ("workspace_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "node_workspace_board_id_unique" ON "node" USING btree ("workspace_id","board_id","id");--> statement-breakpoint
ALTER TABLE "board" ADD CONSTRAINT "board_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "edge" ADD CONSTRAINT "edge_board_scope_fk" FOREIGN KEY ("workspace_id","board_id") REFERENCES "public"."board"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "edge" ADD CONSTRAINT "edge_source_scope_fk" FOREIGN KEY ("workspace_id","board_id","source_node_id") REFERENCES "public"."node"("workspace_id","board_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "edge" ADD CONSTRAINT "edge_target_scope_fk" FOREIGN KEY ("workspace_id","board_id","target_node_id") REFERENCES "public"."node"("workspace_id","board_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mutation_receipt" ADD CONSTRAINT "mutation_receipt_board_scope_fk" FOREIGN KEY ("workspace_id","board_id") REFERENCES "public"."board"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "node" ADD CONSTRAINT "node_board_scope_fk" FOREIGN KEY ("workspace_id","board_id") REFERENCES "public"."board"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_membership" ADD CONSTRAINT "workspace_membership_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "board_workspace_updated_idx" ON "board" USING btree ("workspace_id","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "edge_workspace_board_id_unique" ON "edge" USING btree ("workspace_id","board_id","id");--> statement-breakpoint
CREATE INDEX "edge_workspace_board_idx" ON "edge" USING btree ("workspace_id","board_id");--> statement-breakpoint
CREATE INDEX "node_workspace_board_idx" ON "node" USING btree ("workspace_id","board_id");--> statement-breakpoint
CREATE INDEX "workspace_membership_user_idx" ON "workspace_membership" USING btree ("user_id");--> statement-breakpoint

-- Drizzle owns table/constraint migrations. Tenant policies are reviewed SQL because
-- they are a security boundary, not an ORM convenience.
ALTER TABLE "workspace" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "workspace_membership" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "board" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "node" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "edge" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "mutation_receipt" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint

ALTER TABLE "workspace" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "workspace_membership" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "board" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "node" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "edge" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "mutation_receipt" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

CREATE POLICY "workspace_scope" ON "workspace"
  USING ("id" = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK ("id" = nullif(current_setting('app.workspace_id', true), '')::uuid);--> statement-breakpoint

CREATE POLICY "workspace_membership_scope" ON "workspace_membership"
  USING ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid);--> statement-breakpoint

CREATE FUNCTION "app_has_active_membership"("target_workspace_id" uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM "workspace_membership" AS membership
    WHERE membership."workspace_id" = "target_workspace_id"
      AND membership."user_id" = nullif(current_setting('app.user_id', true), '')
      AND membership."status" = 'active'
  )
$$;--> statement-breakpoint

CREATE POLICY "board_tenant_isolation" ON "board"
  USING (
    "workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid
    AND "app_has_active_membership"("workspace_id")
  )
  WITH CHECK (
    "workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid
    AND "app_has_active_membership"("workspace_id")
  );--> statement-breakpoint

CREATE POLICY "node_tenant_isolation" ON "node"
  USING (
    "workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid
    AND "app_has_active_membership"("workspace_id")
  )
  WITH CHECK (
    "workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid
    AND "app_has_active_membership"("workspace_id")
  );--> statement-breakpoint

CREATE POLICY "edge_tenant_isolation" ON "edge"
  USING (
    "workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid
    AND "app_has_active_membership"("workspace_id")
  )
  WITH CHECK (
    "workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid
    AND "app_has_active_membership"("workspace_id")
  );--> statement-breakpoint

CREATE POLICY "mutation_receipt_tenant_isolation" ON "mutation_receipt"
  USING (
    "workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid
    AND "app_has_active_membership"("workspace_id")
  )
  WITH CHECK (
    "workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid
    AND "app_has_active_membership"("workspace_id")
  );
