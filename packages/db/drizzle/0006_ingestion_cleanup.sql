CREATE FUNCTION "resolve_stale_upload_cleanup_candidates"("max_rows" integer)
RETURNS TABLE (
  "workspace_id" uuid,
  "actor_user_id" text,
  "asset_id" uuid
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    asset."workspace_id",
    membership."user_id",
    asset."id"
  FROM "asset" AS asset
  JOIN LATERAL (
    SELECT candidate."user_id"
    FROM "workspace_membership" AS candidate
    WHERE candidate."workspace_id" = asset."workspace_id"
      AND candidate."status" = 'active'
    ORDER BY (candidate."role" = 'owner') DESC, candidate."created_at", candidate."user_id"
    LIMIT 1
  ) AS membership ON true
  WHERE asset."source_type" = 'upload'
    AND asset."status" IN ('pending', 'quarantined')
    AND asset."updated_at" < now() - interval '1 hour'
    AND NOT EXISTS (
      SELECT 1 FROM "ingestion_job" AS job
      WHERE job."workspace_id" = asset."workspace_id"
        AND job."asset_id" = asset."id"
    )
  ORDER BY asset."updated_at", asset."id"
  LIMIT greatest(1, least("max_rows", 100))
$$;--> statement-breakpoint

REVOKE ALL ON FUNCTION resolve_stale_upload_cleanup_candidates(integer) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION resolve_stale_upload_cleanup_candidates(integer) TO siftloom_worker;
