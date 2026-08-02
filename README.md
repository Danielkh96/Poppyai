# Siftloom

Siftloom is an original visual AI workspace for arranging sources on a canvas and
producing grounded answers from explicitly connected context. The working product name
still requires formal trademark clearance before public launch.

## M4 status

M4 adds the grounded-chat vertical slice on top of identity, persistent canvas, and
tenant-safe ingestion. A send reauthorizes only incoming or explicitly confirmed sources,
freezes exact source versions in a context manifest, applies deterministic fair token
budgeting, and persists the user message plus provider attempt before any model call.
Creation and SSE subscription are separate; deltas are replayable but non-canonical, while
one validated assistant message, cited snapshots, and append-only usage are finalized in a
single transaction. Cancellation, safe retry, citation failure, source-change disclosure,
and ambiguous paid outcomes have explicit terminal states.

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

Open <http://localhost:3000> and use <http://localhost:3000/sign-in> to enter the M4
workspace. The M0 canvas fixture remains available at
<http://localhost:3000/prototype/canvas>.

The root `dev` command starts both the web process and worker with the root `.env` loaded.
Use `corepack pnpm dev:web` when only the UI is needed. Migrations use the local admin
URL; auth, web, and worker use separate `NOSUPERUSER`/`NOBYPASSRLS` roles. The auth role
can access only Better Auth identity tables, while the web role reaches business data
through RLS-scoped transactions and a narrow default-workspace provisioning function.

`AUTH_ENABLE_PASSWORD=true` is honored only outside production. For a production login
path, configure `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` and/or
`RESEND_API_KEY`/`AUTH_EMAIL_FROM`. Never commit real values.

Set `YOUTUBE_API_KEY` to enable public YouTube metadata ingestion. Siftloom never
downloads video bytes or scrapes restricted transcripts; when a transcript is unavailable,
the UI keeps the metadata result with a warning and suggests uploading a rights-cleared
UTF-8 transcript as a separate file source.

Local development and all automated tests use `AI_PROVIDER=fake` and make no paid model
calls. To evaluate the current server-side OpenAI Responses adapter, separately authorize
a budget/data-processing configuration, then set `AI_PROVIDER=openai`, `OPENAI_API_KEY`,
and an approved `OPENAI_MODEL`. Provider keys and privileged grounding instructions never
enter browser code.

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

The database test is intentionally separate from unit tests and fails if its admin,
auth-role, and real runtime URLs are absent; copying `.env.example` supplies safe
local-only values.

Run the 5-second canvas baseline with `corepack pnpm benchmark:canvas`. For the M0 soak,
set `CANVAS_BENCHMARK_MS=900000`; it builds/starts the production Next.js bundle, disables
trace overhead, and uses Chromium CDP for post-GC heap at minute 5 and 15.

The canonical requirements are in
[`docs/product-spec.md`](docs/product-spec.md). See
[`docs/m0/decision-register.md`](docs/m0/decision-register.md) for the decisions that
are ready for implementation and the owner approvals still needed to close M0.
Local evidence and remaining external gates are recorded in
[`docs/m4/verification.md`](docs/m4/verification.md).
