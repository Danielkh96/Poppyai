import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const sourceValue = process.env.MIGRATION_DATABASE_URL;
if (!sourceValue) throw new Error("MIGRATION_DATABASE_URL is required");

const sourceUrl = new URL(sourceValue);
const isLocal = new Set(["localhost", "127.0.0.1", "::1"]).has(sourceUrl.hostname);
if (!isLocal && process.env.BACKUP_SMOKE_ALLOW_REMOTE !== "true") {
  throw new Error("Remote backup smoke requires BACKUP_SMOKE_ALLOW_REMOTE=true");
}

const targetName = `siftloom_restore_smoke_${Date.now()}_${randomUUID().replaceAll("-", "").slice(0, 8)}`;
if (!/^siftloom_restore_smoke_[a-z0-9_]+$/.test(targetName)) {
  throw new Error("Unsafe restore target name");
}

const maintenanceUrl = new URL(sourceUrl);
maintenanceUrl.pathname = "/postgres";
const targetUrl = new URL(sourceUrl);
targetUrl.pathname = `/${targetName}`;
const sourceDatabase = decodeURIComponent(sourceUrl.pathname.slice(1));
const databaseUser = decodeURIComponent(sourceUrl.username);
const databasePassword = decodeURIComponent(sourceUrl.password);
const temporaryDirectory = await mkdtemp(path.join(tmpdir(), "siftloom-backup-smoke-"));
const dumpPath = path.join(temporaryDirectory, "backup.dump");
let targetCreated = false;

function spawn(program, args, options = {}) {
  return spawnSync(program, args, {
    maxBuffer: 512 * 1024 * 1024,
    ...options
  });
}

const hostCliAvailable =
  spawn("psql", ["--version"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  }).status === 0;

function assertSuccess(result, label) {
  if (result.status !== 0) {
    throw new Error(`${label} failed with exit code ${String(result.status)}`);
  }
}

function hostRun(program, args, label, options = {}) {
  const result = spawn(program, args, options);
  assertSuccess(result, label);
  return result;
}

function dockerRun(program, args, label, options = {}) {
  const result = spawn(
    "docker",
    [
      "compose",
      "exec",
      "-T",
      "-e",
      `PGPASSWORD=${databasePassword}`,
      "postgres",
      program,
      ...args
    ],
    options
  );
  assertSuccess(result, label);
  return result;
}

if (!hostCliAvailable && !isLocal) {
  throw new Error("Remote backup smoke requires local PostgreSQL client tools");
}

const countQuery = `
select json_build_object(
  'workspaces', (select count(*) from workspace),
  'boards', (select count(*) from board),
  'nodes', (select count(*) from node),
  'ingestions', (select count(*) from ingestion_job),
  'chat_runs', (select count(*) from chat_run),
  'usage_events', (select count(*) from usage_event),
  'operational_events', (select count(*) from operational_event),
  'forced_rls_tables', (
    select count(*) from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and c.relforcerowsecurity
  )
)::text;
`;

function verify(database) {
  if (hostCliAvailable) {
    const url = new URL(sourceUrl);
    url.pathname = `/${database}`;
    return hostRun(
      "psql",
      [
        "--no-psqlrc",
        "--tuples-only",
        "--no-align",
        "--dbname",
        url.href,
        "--command",
        countQuery
      ],
      "database verification",
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
    ).stdout.trim();
  }
  return dockerRun(
    "psql",
    ["-U", databaseUser, "-d", database, "-tA", "-c", countQuery],
    "database verification",
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
  ).stdout.trim();
}

try {
  const sourceCounts = verify(sourceDatabase);
  if (hostCliAvailable) {
    hostRun(
      "createdb",
      ["--maintenance-db", maintenanceUrl.href, targetName],
      "temporary database creation",
      { stdio: ["ignore", "ignore", "pipe"] }
    );
  } else {
    dockerRun("createdb", ["-U", databaseUser, targetName], "temporary database creation", {
      stdio: ["ignore", "ignore", "pipe"]
    });
  }
  targetCreated = true;

  if (hostCliAvailable) {
    hostRun(
      "pg_dump",
      [
        "--format=custom",
        "--no-owner",
        "--no-privileges",
        `--file=${dumpPath}`,
        sourceUrl.href
      ],
      "database backup",
      { stdio: ["ignore", "ignore", "pipe"] }
    );
    hostRun(
      "pg_restore",
      ["--no-owner", "--no-privileges", `--dbname=${targetUrl.href}`, dumpPath],
      "database restore",
      { stdio: ["ignore", "ignore", "pipe"] }
    );
  } else {
    const dump = dockerRun(
      "pg_dump",
      ["-U", databaseUser, "-d", sourceDatabase, "-Fc", "--no-owner", "--no-privileges"],
      "database backup",
      { stdio: ["ignore", "pipe", "pipe"] }
    ).stdout;
    await writeFile(dumpPath, dump, { mode: 0o600 });
    dockerRun(
      "pg_restore",
      ["-U", databaseUser, "-d", targetName, "--no-owner", "--no-privileges"],
      "database restore",
      { input: await readFile(dumpPath), stdio: ["pipe", "ignore", "pipe"] }
    );
  }

  const restoredCounts = verify(targetName);
  if (restoredCounts !== sourceCounts) {
    throw new Error("Restored canonical counts do not match the source database");
  }
  process.stdout.write(
    `Backup/restore smoke passed for ${JSON.parse(restoredCounts).forced_rls_tables} forced-RLS tables; temporary artifacts removed.\n`
  );
} finally {
  if (targetCreated) {
    if (hostCliAvailable) {
      hostRun(
        "dropdb",
        ["--if-exists", "--maintenance-db", maintenanceUrl.href, targetName],
        "temporary database cleanup",
        { stdio: ["ignore", "ignore", "pipe"] }
      );
    } else {
      dockerRun(
        "dropdb",
        ["-U", databaseUser, "--if-exists", targetName],
        "temporary database cleanup",
        { stdio: ["ignore", "ignore", "pipe"] }
      );
    }
  }
  await rm(temporaryDirectory, { recursive: true, force: true });
}
