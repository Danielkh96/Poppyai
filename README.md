# Siftloom

Siftloom is an original visual AI workspace for arranging sources on a canvas and
producing grounded answers from explicitly connected context. The working product name
still requires formal trademark clearance before public launch.

## M0 status

M0 establishes the architecture, security boundaries, decision records, runnable
workspace, and a deterministic React Flow performance fixture. It intentionally does
not implement product authentication, paid AI calls, or ingestion. Engineering defaults
are owner-approved for implementation; M0 remains open for the remaining reference-device,
native-browser and remote-CI gates in the decision register.

## Prerequisites

- Node.js 24
- Corepack with pnpm 11
- Docker Desktop for PostgreSQL and local S3-compatible storage

## Local setup

```bash
corepack pnpm install
cp .env.example .env
corepack pnpm infra:up
corepack pnpm db:migrate
corepack pnpm dev
```

Open <http://localhost:3000>. The M0 canvas fixture is at
<http://localhost:3000/prototype/canvas>.

The root `dev` command starts both the web process and worker with the root `.env` loaded.
Use `corepack pnpm dev:web` when only the UI is needed. Migrations use the local admin
URL; web and worker use separate `NOSUPERUSER`/`NOBYPASSRLS` roles.

## Required root checks

```bash
corepack pnpm format:check
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm test
corepack pnpm test:db
corepack pnpm audit:deps
corepack pnpm build
corepack pnpm test:e2e
```

The database test is intentionally separate from unit tests and fails if its admin and
real runtime URLs are absent; copying `.env.example` supplies safe local-only values.

Run the 5-second canvas baseline with `corepack pnpm benchmark:canvas`. For the M0 soak,
set `CANVAS_BENCHMARK_MS=900000`; it builds/starts the production Next.js bundle, disables
trace overhead, and uses Chromium CDP for post-GC heap at minute 5 and 15.

The canonical requirements are in
[`docs/product-spec.md`](docs/product-spec.md). See
[`docs/m0/decision-register.md`](docs/m0/decision-register.md) for the decisions that
are ready for implementation and the owner approvals still needed to close M0.
Local evidence and remaining external gates are recorded in
[`docs/m0/verification.md`](docs/m0/verification.md).
