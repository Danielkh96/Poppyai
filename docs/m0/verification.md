# M0 engineering verification

Last updated: 2026-08-01

Status: **local engineering verification, owner implementation approval, initial push,
and remote CI complete; M0 remains open for reference-device evidence and native-browser
smoke.**

This report records checks actually run for the repository's initial M0 baseline. It is
not evidence that M1–M5 product journeys are implemented.

## Verified environment

- Host: MacBook Air `Mac16,13`, Apple M4 (10 cores), 16 GiB RAM.
- OS: macOS 26.5.2 (25F84), Darwin 25.5.0.
- Runtime: Node.js 24.14.1, pnpm 11.18.0 through Corepack.
- Local services: PostgreSQL 17.9 and Adobe S3Mock 5.1.0, bound to loopback.
- Browser automation: Playwright 1.62.1; accepted performance run used Chromium
  151.0.7922.34.

## Final local verification

| Check                            | Result                                                                                                 |
| -------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `corepack pnpm format:check`     | Pass; all supported files matched Prettier.                                                            |
| `corepack pnpm lint`             | Pass; zero ESLint warnings/errors.                                                                     |
| `corepack pnpm typecheck`        | Pass; all seven application/package workspaces completed strict TypeScript checks.                     |
| `corepack pnpm test`             | Pass; 4 files, 12 unit tests.                                                                          |
| `corepack pnpm test:db`          | Pass; 2 files, 5 real PostgreSQL tenant/queue integration tests using non-bypass web and worker roles. |
| `corepack pnpm db:migrate` twice | Pass; reviewed Drizzle and pg-boss setup remained idempotent.                                          |
| `corepack pnpm audit:deps`       | Pass; pnpm reported no known vulnerabilities at the configured high threshold.                         |
| `corepack pnpm peers check`      | Pass; no peer-dependency issues.                                                                       |
| `corepack pnpm build`            | Pass; all seven workspaces built, including the optimized Next.js production bundle and Node worker.   |
| `corepack pnpm test:e2e`         | Pass; 9/9 smoke tests across Chromium, Firefox and WebKit.                                             |
| 15-minute production canvas soak | Pass on the documented M4 host; one Chromium test completed in 15.1 minutes.                           |

The health-route browser test asserts the exact public JSON shape, so additional private
fields fail the test. Unit tests freeze all centrally approved M0 safety limits and the
canvas graph semantics. Database tests fail, rather than skip, when real test URLs are
missing.

## Tenant and runtime evidence

- Compose exposes PostgreSQL and S3Mock only at `127.0.0.1`.
- Migrations use `siftloom_admin`; web and worker use separate `NOSUPERUSER`,
  `NOINHERIT`, `NOBYPASSRLS` login roles.
- The legacy local bootstrap `siftloom` role is `NOLOGIN`; it is not an application URL.
- Tenant tests prove own-workspace reads, deny cross-tenant reads/writes and prevent a
  runtime user from escalating its own membership role.
- Queue tests send with the web role and consume with the worker role using a unique
  per-test payload marker. A separate local smoke also started the built worker and
  consumed `m0.health`.
- The local S3 bucket `siftloom-local` exists. S3Mock remains an API double, not evidence
  for production signed-URL enforcement.

## Canvas acceptance evidence

The accepted evidence is
[`../performance/runs/m0-2026-08-01-m4-soak-v2.json`](../performance/runs/m0-2026-08-01-m4-soak-v2.json):

| Metric                               |                  Gate |           Result |
| ------------------------------------ | --------------------: | ---------------: |
| Rendered nodes in reference viewport |                  ≥ 30 |               63 |
| Fixture graph                        | 200 nodes / 300 edges |        200 / 300 |
| p95 frame interval                   |               ≤ 20 ms |          17.5 ms |
| Frames at or below 20 ms             |                 ≥ 95% | 99.99% of 53,991 |
| Pointer-to-next-paint p95            |               < 50 ms |          15.5 ms |
| Longest main-thread task             |              ≤ 200 ms |            66 ms |
| Post-GC heap growth, minute 5→15     |                 ≤ 20% |               6% |
| Workload active during final sample  |              Required |           `true` |

The result contains full machine and source-file SHA-256 fingerprints. An earlier run
found a teardown/sample race and is retained as `diagnostic_failed`; it is not counted as
acceptance evidence. See
[`../performance/canvas-baseline.md`](../performance/canvas-baseline.md) for the method,
limitations and audit trail.

## CI and reproducibility status

The workflow at `.github/workflows/ci.yml` provisions fresh PostgreSQL runtime roles,
applies migrations twice and runs static, unit, integration, dependency, build and
three-browser checks. Initial baseline commit
[`95b86e0258f45dac7f55e56402115adbba4b66e8`](https://github.com/Danielkh96/Poppyai/commit/95b86e0258f45dac7f55e56402115adbba4b66e8)
was pushed to `main`. GitHub Actions
[`CI #30692806616`](https://github.com/Danielkh96/Poppyai/actions/runs/30692806616)
completed successfully in 2 minutes 33 seconds, including 9/9 Chromium, Firefox and
WebKit smoke tests.

## Remaining M0 gates

1. Reproduce and approve the performance gate on the M1-class/8-GiB reference device.
2. Run current native Safari and Edge smoke tests; Playwright WebKit/Chromium are not the
   same as those native release binaries.
3. Complete the legal, procurement and paid-service gates listed in
   [`decision-register.md`](decision-register.md) before external alpha or deployment.

Until those gates are recorded, development may proceed against the documented defaults,
but the M0 milestone must not be marked closed.
