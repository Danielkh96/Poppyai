ALTER TABLE "node" ADD COLUMN "parent_node_id" uuid;--> statement-breakpoint
UPDATE "node"
SET "payload" = "payload" || jsonb_build_object(
  'version', 1,
  'kind', "kind"::text,
  'title', left(coalesce(nullif(btrim("payload"->>'title'), ''), initcap("kind"::text)), 120),
  'summary', left(coalesce("payload"->>'summary', ''), 2000),
  'status', CASE
    WHEN "payload"->>'status' IN (
      'draft', 'queued', 'processing', 'ready', 'ready_with_warning', 'streaming', 'failed'
    ) THEN "payload"->>'status'
    ELSE 'draft'
  END,
  'progress', null
) || CASE "kind"::text
  WHEN 'note' THEN jsonb_build_object('body', left(coalesce("payload"->>'body', ''), 100000))
  WHEN 'text' THEN jsonb_build_object('body', left(coalesce("payload"->>'body', ''), 100000))
  WHEN 'pdf' THEN jsonb_build_object('fileName', left(coalesce("payload"->>'fileName', ''), 255))
  WHEN 'webpage' THEN jsonb_build_object(
    'url', CASE
      WHEN length(coalesce("payload"->>'url', '')) <= 2048
        AND coalesce("payload"->>'url', '') ~ '^https://[^/@[:space:]]+(/[^[:space:]]*)?$'
      THEN "payload"->>'url'
      ELSE ''
    END
  )
  WHEN 'video' THEN jsonb_build_object(
    'url', CASE
      WHEN length(coalesce("payload"->>'url', '')) <= 2048
        AND coalesce("payload"->>'url', '') ~ '^https://[^/@[:space:]]+(/[^[:space:]]*)?$'
      THEN "payload"->>'url'
      ELSE ''
    END
  )
  WHEN 'chat' THEN jsonb_build_object('prompt', left(coalesce("payload"->>'prompt', ''), 100000))
  WHEN 'group' THEN jsonb_build_object('description', left(coalesce("payload"->>'description', ''), 2000))
  ELSE '{}'::jsonb
END;--> statement-breakpoint
ALTER TABLE "node" ADD CONSTRAINT "node_parent_scope_fk" FOREIGN KEY ("workspace_id","board_id","parent_node_id") REFERENCES "public"."node"("workspace_id","board_id","id") ON DELETE cascade ON UPDATE no action;
