# M5 verification

Date: 2026-08-02

## Exit-criterion evidence

| Criterion                     | Local implementation evidence                                                                                                                                                                                                                                                                                                              |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Canonical release scenario    | One cross-browser journey creates and edits a Board, persists geometry and context edges, ingests a TXT source through the durable worker, generates a two-source grounded answer, opens the frozen citation after the live source changes, soft-deletes/restores a node, denies a second tenant, and archives/restores/reopens the Board. |
| Release checks and migrations | Root format, lint, strict typecheck, unit, PostgreSQL integration, dependency audit, production build, and browser commands are CI gates. Migration `0011` adds a composite-tenant operational event table with forced RLS and append-only web-role privileges; migration replay and backup restore are separate checks.                   |
| Accessibility and layout      | Automated WCAG 2 A/AA scans cover Boards, operations, and trust pages; skip navigation is keyboard-tested and the operations page is checked at 360×640 without horizontal overflow. The existing fixed 200-node/300-edge benchmark remains the canvas performance/soak gate.                                                              |
| Operations and alerts         | `/operations` and `/api/operations` are authenticated, tenant-scoped, private/no-store views of save failures/conflicts, ingestion failures, stuck jobs, oldest queue age, generation failures, reconciliation backlog, runs, and billed tokens. Alerts use shared thresholds and expose no source/prompt content.                         |
| Recovery and response         | `backup:smoke` creates an isolated temporary target, logical-dumps/restores, compares canonical row and forced-RLS counts, and removes its artifacts. `runbook.md` records P0/P1 containment for leakage, data loss, queues, ingestion, generation, reconciliation, duplicate usage, credentials, and schema-safe rollback.                |
| Disclosures                   | The `/trust` UI and `privacy-and-rights.md` cover minimum provider context, privacy-safe telemetry, source rights, public YouTube metadata limits, grounding caveat, 30-day primary deletion target, 35-day backup expiry, data access/deletion, and support.                                                                              |
| Security hardening            | Global CSP/frame/referrer/nosniff/permissions headers, forged-origin rejection, inert hostile-name rendering, tenant isolation, RLS, and append-only operational events have automated coverage.                                                                                                                                           |

## Local command record

- Formatting, ESLint with zero warnings, strict workspace TypeScript, production build,
  and high-severity dependency audit passed. The audit reported no known vulnerabilities.
- Unit suite: 9 files, 33 tests. PostgreSQL integration suite: 7 files, 25 tests.
- Full browser suite: 47 tests across Chromium, Firefox, and WebKit. The M5 subset accounts
  for 26 of those checks including setup/teardown and passed separately before the merged
  root gate. Browser projects run serially because one private-alpha workspace deliberately
  permits only one active AI run.
- A fresh temporary database applied all migrations twice, produced 25 public tables and
  21 forced-RLS tables, granted `INSERT` but not `UPDATE` on `operational_event` to the web
  role, and was removed.
- Local release configuration passed without printing values. The production profile
  correctly rejected the local URL, password auth, fake provider, local object storage,
  non-TLS database URLs, placeholder secret, and development mailboxes.
- Backup/restore smoke passed with canonical-count parity across 21 forced-RLS tables and
  removed its temporary database and dump.
- The current production-build 15-minute 200-node/300-edge soak sampled 53,999 frames:
  p95 17.3 ms, 100% at or below 20 ms, pointer-to-paint p95 15.8 ms, and 6.14% post-GC
  heap growth from minute 5 to 15. The accepted result is
  [`m5-2026-08-02-soak.json`](../performance/runs/m5-2026-08-02-soak.json).

No local fake, automated browser, or logical backup smoke is treated as external
production approval.

## External release gates

The code-complete M5 candidate is **not automatically approved for external users**. These
checks require owner, provider, deployment, security, accessibility, or legal authority
outside the local repository:

- production OAuth or magic-link delivery, HTTPS URL, monitored support/privacy mailboxes,
  least-privilege TLS database roles, and an approved deployment artifact;
- real S3 negative contract suite, production bucket/CORS/encryption/retention controls,
  and an authorized production restore/PITR exercise;
- approved live AI model, budget, data-processing and retention terms, evaluation corpus,
  and reconciliation access;
- native supported Edge/Safari and assistive-technology manual review, supported-device
  interaction review, and alert delivery/on-call ownership;
- final privacy/source-rights wording, deletion operator workflow, trademark/product-name
  decision, and professional legal/security review.

`corepack pnpm release:config` must fail closed until the production values above are
supplied; it validates presence and shape without printing secret values.
