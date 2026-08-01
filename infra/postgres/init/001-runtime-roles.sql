-- Local-only credentials. Production creates equivalent roles through the deployment
-- secret/identity system before application migrations run.
CREATE ROLE siftloom_web
  LOGIN PASSWORD 'siftloom_web_local_only'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;

CREATE ROLE siftloom_worker
  LOGIN PASSWORD 'siftloom_worker_local_only'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
