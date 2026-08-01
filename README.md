# Siftloom

Siftloom is an original visual AI workspace for arranging sources on a canvas and
producing grounded answers from explicitly connected context. The working product name
still requires formal trademark clearance before public launch.

## M3 status

M3 adds the tenant-safe ingestion vertical slice on top of the M1 identity/Board and M2
persistent-canvas foundations. PDF and UTF-8 text files use exact-object signed uploads;
public webpages use a bounded SSRF-resistant fetch boundary; and configured public
YouTube URLs use the official Data API for metadata only. A durable pg-boss worker stores
immutable attempts, versioned extraction artifacts, ordered provenance-bearing segments,
warnings, failures, bounded retries, stale-lease replacement, and orphan-upload cleanup.
The canvas polls canonical status without writing worker progress into canvas history.

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

Open <http://localhost:3000> and use <http://localhost:3000/sign-in> to enter the M3
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
[`docs/m0/verification.md`](docs/m0/verification.md).
