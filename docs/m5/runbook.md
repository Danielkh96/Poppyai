# M5 P0 response notes

Date: 2026-08-02

These notes are the minimum exercised private-alpha response path. They are not a formal
SLO or complete disaster-recovery runbook. Every incident record may include opaque user,
workspace, Board, run, job, and request IDs, timestamps, counts, age, and normalized error
codes. It must not include session tokens, keys, signed URLs, raw source URLs or filenames,
prompts, answers, or extracted source content.

## Severity and first response

- **P0:** suspected tenant leakage, acknowledged data loss, active credential exposure,
  duplicated paid usage, unrecoverable canonical corruption, or a privacy/security event.
  Stop the affected path immediately, preserve privacy-safe evidence, notify the owner,
  and do not resume until the control failure is understood and verified.
- **P1:** a critical operations alert, repeated save/generation failures, or a sustained
  queue outage without evidence of leakage, loss, or duplicate billing. Disable only the
  affected capability when possible and keep Board reading/editing available.
- The responder records UTC start time, detection source, affected opaque IDs, last known
  good release/migration, containment decision, and an owner for the next update.

## Triage entry points

1. Open `/operations` in the affected workspace and capture counts, queue age, alert codes,
   and generation time. Do not copy private Board content.
2. Check `/api/health`, web/worker availability, the current release identifier, PostgreSQL,
   object storage, and configured provider status.
3. Correlate only on opaque IDs and normalized error codes in structured logs.
4. Before any mutation, establish whether the problem is scoped to one workspace, one
   capability, or the whole release. Prefer reversible containment.

## Response matrix

| Signal or report                                          | Immediate checks                                                                                                               | Containment and recovery                                                                                                                               | Close only when                                                                                                                                      |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Suspected cross-workspace access                          | Preserve request/workspace/resource IDs; verify session actor, membership, RLS scope, composite parent chain, and object key   | P0: disable the implicated route or release; revoke affected sessions/credentials; do not ask the reporter to explore further                          | A two-tenant negative reproducer passes at API, repository, RLS, stream/object, and worker boundaries; impact and notification decision are recorded |
| Save-failure burst or conflict                            | Compare `CANVAS_SAVE_FAILURE_BURST`, HTTP status/error code, Board revision, and database health                               | Keep the client dirty; instruct reload/reapply only after canonical state is fetched; roll back the application if the current release caused failures | Acknowledged mutations survive reload and retained local operations recover without silent overwrite                                                 |
| Queue age over two minutes or stuck job over five minutes | Check web enqueue, pg-boss state, worker heartbeat, attempt lease, storage/provider availability, and job parent authorization | Pause new ingestion if backlog grows; restart only the worker when safe; never hand-edit a terminal attempt or replay an unverified external effect    | The oldest age trends down, stale leases cannot overwrite newer outcomes, and one controlled job completes                                           |
| Ingestion failures                                        | Group by normalized code, content kind, retry class, and release; inspect bytes/duration, never file contents                  | Disable the affected adapter; allow only bounded safe retries; quarantine malformed input and preserve provenance                                      | Representative valid input succeeds and unsafe/oversized input still fails closed                                                                    |
| Generation failures                                       | Check provider status, run/attempt state, manifest existence, citation validation, and cancellation                            | Keep Board editing available; stop new calls if failures are systemic; retry only explicitly safe failures as a new run                                | One authorized grounded run finalizes exactly one assistant message and usage event                                                                  |
| `AI_RECONCILIATION_REQUIRED`                              | Compare the persisted attempt/idempotency key with provider-side status using approved operator access                         | Do not reinvoke. Resolve the existing outcome or mark it failed; record usage separately and append-only                                               | Canonical message and billed usage each exist at most once, with the reconciliation decision recorded                                                |
| Usage anomaly or suspected duplicate charge               | Compare run count, append-only usage uniqueness, quota reservation, provider attempt ID, and provider ledger                   | Suspend new generation for the workspace/provider if duplication is plausible; preserve financial evidence without source content                      | Every billed operation maps to one logical run and one usage event; the affected quota is corrected by an auditable entry                            |
| Credential exposure                                       | Identify credential class and access scope without copying the secret into the incident record                                 | P0: revoke/rotate, invalidate dependent sessions or signed URLs, restrict the affected role, and inspect privacy-safe access metadata                  | Old credentials fail, new credentials have least privilege, and deployment/config validation passes                                                  |

## Backup and restore smoke

Run `corepack pnpm backup:smoke` against an explicitly authorized database. Remote targets
are refused unless `BACKUP_SMOKE_ALLOW_REMOTE=true`; the responder must obtain deployment
owner approval before setting it. The script creates a uniquely prefixed temporary
database and mode-0600 temporary dump, restores without ownership/privileges, compares
canonical table counts and the forced-RLS table count, then drops only that temporary
database and removes the dump.

The smoke proves logical dump/restore mechanics and count parity. It does not prove a
production recovery-time objective, point-in-time recovery, object-store recovery,
encryption policy, or backup expiry. Those require an authorized production exercise.

## Release rollback rule

Rollback is preferred when the current application release caused a P0/P1 and the prior
artifact remains schema-compatible. Database migrations are forward-only: do not manually
reverse a shared/production migration. If the schema is incompatible, ship a reviewed
forward corrective migration or disable the affected capability. After containment, rerun
the canonical release scenario and the narrow regression for the failed control.
