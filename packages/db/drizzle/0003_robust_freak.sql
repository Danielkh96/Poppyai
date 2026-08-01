CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "board" ADD COLUMN "create_mutation_id" uuid;--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "personal_owner_user_id" text;--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_user_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "account_provider_account_unique" ON "account" USING btree ("provider_id","account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "session_token_unique" ON "session" USING btree ("token");--> statement-breakpoint
CREATE INDEX "session_user_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_email_unique" ON "user" USING btree ("email");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");--> statement-breakpoint
ALTER TABLE "workspace" ADD CONSTRAINT "workspace_personal_owner_user_id_user_id_fk" FOREIGN KEY ("personal_owner_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "board_workspace_create_mutation_unique" ON "board" USING btree ("workspace_id","create_mutation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_personal_owner_unique" ON "workspace" USING btree ("personal_owner_user_id");--> statement-breakpoint
ALTER TABLE "board" ADD CONSTRAINT "board_name_length" CHECK (char_length(btrim("board"."name")) BETWEEN 1 AND 120);--> statement-breakpoint
ALTER TABLE "workspace" ADD CONSTRAINT "workspace_name_length" CHECK (char_length(btrim("workspace"."name")) BETWEEN 1 AND 120);
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'siftloom_auth') THEN
    RAISE EXCEPTION 'Required auth role siftloom_auth does not exist';
  END IF;
END
$$;--> statement-breakpoint

GRANT USAGE ON SCHEMA public TO siftloom_auth;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  "user",
  "session",
  "account",
  "verification"
TO siftloom_auth;--> statement-breakpoint

REVOKE ALL ON TABLE "user", "session", "account", "verification"
FROM siftloom_web, siftloom_worker;--> statement-breakpoint

CREATE FUNCTION "provision_personal_workspace"(
  "target_user_id" text,
  "target_user_name" text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  provisioned_workspace_id uuid;
  provisioned_workspace_name text;
BEGIN
  IF "target_user_id" IS NULL
    OR "target_user_id" <> nullif(current_setting('app.user_id', true), '') THEN
    RAISE EXCEPTION 'workspace provisioning denied' USING ERRCODE = '42501';
  END IF;

  provisioned_workspace_name := left(
    coalesce(nullif(btrim("target_user_name"), ''), '个人') || ' 的工作区',
    120
  );

  INSERT INTO "workspace" ("name", "personal_owner_user_id")
  VALUES (provisioned_workspace_name, "target_user_id")
  ON CONFLICT ("personal_owner_user_id") DO UPDATE
    SET "personal_owner_user_id" = EXCLUDED."personal_owner_user_id"
  RETURNING "id" INTO provisioned_workspace_id;

  INSERT INTO "workspace_membership" (
    "workspace_id",
    "user_id",
    "role",
    "status"
  )
  VALUES (provisioned_workspace_id, "target_user_id", 'owner', 'active')
  ON CONFLICT ("workspace_id", "user_id") DO NOTHING;

  IF NOT EXISTS (
    SELECT 1
    FROM "workspace_membership"
    WHERE "workspace_id" = provisioned_workspace_id
      AND "user_id" = "target_user_id"
      AND "status" = 'active'
  ) THEN
    RAISE EXCEPTION 'workspace membership is inactive' USING ERRCODE = '42501';
  END IF;

  RETURN provisioned_workspace_id;
END
$$;--> statement-breakpoint

REVOKE ALL ON FUNCTION provision_personal_workspace(text, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION provision_personal_workspace(text, text) TO siftloom_web;
