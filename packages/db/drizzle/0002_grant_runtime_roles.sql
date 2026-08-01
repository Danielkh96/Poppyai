-- Role creation belongs to deployment/bootstrap. Failing here when the roles are absent
-- prevents an operator from silently running the application as the migration owner.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'siftloom_web') THEN
    RAISE EXCEPTION 'Required runtime role siftloom_web does not exist';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'siftloom_worker') THEN
    RAISE EXCEPTION 'Required runtime role siftloom_worker does not exist';
  END IF;
END
$$;--> statement-breakpoint

GRANT USAGE ON SCHEMA public TO siftloom_web, siftloom_worker;--> statement-breakpoint
GRANT SELECT ON TABLE
  workspace,
  workspace_membership
TO siftloom_web, siftloom_worker;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  board,
  node,
  edge,
  mutation_receipt
TO siftloom_web, siftloom_worker;--> statement-breakpoint

REVOKE ALL ON FUNCTION app_has_active_membership(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_has_active_membership(uuid)
TO siftloom_web, siftloom_worker;
