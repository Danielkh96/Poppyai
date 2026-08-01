# M0 decision register

Last updated: 2026-08-01

This register converts the launch-blocking questions in the product specification into
implementation defaults. It distinguishes an engineering decision from an owner,
commercial, privacy, or legal approval. Codex may build against an implementation
default. On 2026-08-01, after receiving the decision summary and approval prompt, the
product owner instructed Codex to “开始执行”. This is recorded as approval to implement
the current defaults and create the initial repository baseline. It is not professional
legal/privacy advice and does not authorize unconfigured cloud or API spend.

Status meanings:

- `ACCEPTED` — sufficiently decided for implementation and recorded in an ADR where
  consequential.
- `PROVISIONAL` — safe to build behind central configuration, but must be calibrated or
  verified before external alpha.
- `OWNER APPROVED` — the product owner accepted the implementation default; any stated
  legal, procurement, account, or deployment gate still applies.

## Decision summary

| #   | Decision                                 | Implementation default                                                                                                                                                                                                                                                                                                                   | Status / evidence                                                                                                                                                     |
| --- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Product name and visual direction        | Working name **Siftloom**. “Editorial research field”: warm paper, ink typography, cobalt actions, coral only for warnings/references, source cards rather than a generic dashboard. No Poppy AI branding, copy, or proprietary assets.                                                                                                  | `OWNER APPROVED` for implementation. Professional trademark, company-name, domain, and social-handle clearance remains required before public use.                    |
| 2   | Launch locale                            | `zh-CN` first. All dates, quantities, status labels, and copy enter an i18n boundary from M1; English is the first added locale, not simultaneous P0 scope.                                                                                                                                                                              | `OWNER APPROVED`. Current scaffold uses `lang=zh-CN`.                                                                                                                 |
| 3   | Authentication and sessions              | Better Auth with server-validated, database-backed, revocable sessions. Private alpha uses Google OIDC plus verified email magic-link fallback. Session cookies are HttpOnly, Secure in non-local environments, SameSite=Lax, with explicit expiry/rotation.                                                                             | `ACCEPTED` architecture; OAuth consent screen, sending domain, and provider credentials remain an M1 operational gate. See ADR-0002.                                  |
| 4   | Tenant enforcement                       | Deny-by-default workspace-scoped repositories **and** PostgreSQL RLS for tenant-owned tables. Every worker transaction sets and verifies the same tenant scope. A valid session never substitutes for object authorization.                                                                                                              | `ACCEPTED`. See ADR-0002 and threat model.                                                                                                                            |
| 5   | Canvas library                           | `@xyflow/react` v12 behind `@siftloom/ui`. React Flow `Node`, `Edge`, and event types never enter domain/API/persistence packages.                                                                                                                                                                                                       | `ACCEPTED`. Fixed fixture exists at `/prototype/canvas`. See ADR-0003.                                                                                                |
| 6   | Autosave protocol                        | 750 ms debounce; ordered batch includes `mutationId`, `baseBoardRevision`, and per-record expected revisions. Atomic apply + durable mutation receipt. Stale edits return 409 canonical state; dirty client operations remain available to reload/reapply. No last-write-wins.                                                           | `ACCEPTED`. See ADR-0004.                                                                                                                                             |
| 7   | Storage, queue, worker, hosting          | PostgreSQL 17 + Drizzle; pg-boss in the same database transaction; S3 interface with real AWS S3 in production and Adobe S3Mock locally; separate Node web/worker containers. Production baseline is AWS `ap-southeast-1`: ECS/Fargate, RDS PostgreSQL, S3, ALB with SSE pass-through.                                                   | `OWNER APPROVED` implementation target. AWS account, actual budget, backup policy and deployment authorization remain external gates. See ADR-0001/0005.              |
| 8   | AI provider/model                        | Provider-neutral gateway. First evaluation candidate is OpenAI Responses API with exact model `gpt-5.6-terra`, reasoning effort `low`; automated tests use only `FakeAiProvider`. Freeze production model/config only after a 20–30 task grounded-answer evaluation.                                                                     | `OWNER APPROVED` evaluation default; still `PROVISIONAL` until evaluation. No paid call until API budget and data terms are separately authorized. See ADR-0006/0007. |
| 9   | Public YouTube path                      | Phase 1 uses YouTube Data API `videos.list` only for permitted public metadata, never scrapes watch/transcript endpoints, and does not request caption-management OAuth scopes. Show `transcript_unavailable` and offer upload of user-owned transcript/audio.                                                                           | `ACCEPTED` compliant fallback. Owner-caption OAuth or a third-party transcript supplier requires a separate rights/privacy/security decision. See ADR-0007.           |
| 10  | Content, token, rate, concurrency, quota | Central defaults in `@siftloom/shared/limits`: TXT 5 MiB/100k chars; PDF 25 MiB/200 pages; webpage 5 MiB/3 redirects/15 s; video 120 min; 20 AI sources; 64k input + 8k output reserve; 2 concurrent ingestion jobs and 1 chat per workspace; 30 chat/URL operations per hour; 2 GiB workspace storage.                                  | Safety ceilings `OWNER APPROVED`; commercial billing tiers and exception process remain deferred.                                                                     |
| 11  | Retention/deletion                       | Archived boards remain until a delete request. Soft-deleted nodes recover for 30 days. A verified deletion request immediately removes access and completes primary-system deletion within 30 days; backups expire within 35 days.                                                                                                       | `OWNER APPROVED` implementation default; privacy counsel, backup verification, and customer wording remain external-alpha gates.                                      |
| 12  | Browser/device support                   | Private-alpha full editing targets current stable Chrome/Edge/Firefox/Safari; older versions are best effort. Reference viewport 1440×900; minimum editor viewport 1024×720.                                                                                                                                                             | `PROVISIONAL` until native Safari/Edge smoke and the M1-class baseline are recorded.                                                                                  |
| 13  | Narrow mobile                            | 360×640 and above supports board outline, source/job status, retry, citation navigation, chat/cancel/copy, and read-only node inspection. Creation, drag, resize, grouping, and connections require desktop.                                                                                                                             | `ACCEPTED`.                                                                                                                                                           |
| 14  | Context assembly                         | Freeze authorized snapshot manifest, stable source ordering, snapshot-hash dedupe with node aliases, approximately 800-token chunks/100 overlap, deterministic BM25 within selected sources, per-source fair allocation, then original segment order. Include history only when its lineage is a subset of current authorized snapshots. | `ACCEPTED` algorithm for M4 evaluation; tokenization details remain versioned configuration. See ADR-0006.                                                            |
| 15  | Usage visibility before billing          | Show current-period chat runs, processed pages/minutes, storage, quota/reset date, and detailed tokens. Do not show dollar estimates or imply billing. Usage events remain append-only from P0 even though the summary UI is P1.                                                                                                         | `ACCEPTED`.                                                                                                                                                           |

## Performance decision

The canonical fixture is deterministic seed `20260801` with 200 mixed nodes, 300
context edges, one ingestion-progress node, one streaming chat node, and at least 30
nodes inside the reference viewport during interaction. The route and automated harness
are implemented. The measured local result and reference hardware are recorded in
[`../performance/canvas-baseline.md`](../performance/canvas-baseline.md).

Until calibration finishes, the product-spec targets remain provisional:

- p95 frame interval at or below 20 ms;
- at least 95% of sampled frames at or below 20 ms;
- p95 pointer-to-next-paint below 50 ms;
- no long task above 200 ms;
- post-GC heap growth from minute 5 to minute 15 no more than 20%, excluding documented
  bounded caches.

## Owner approval record and external gates

The product owner approved the current M0 implementation defaults on 2026-08-01. Before
external alpha or paid deployment, the project still requires:

1. Professional trademark/domain/social clearance for **Siftloom** in intended markets.
2. An AWS account, confirmed budget, backup policy, and explicit deployment authority.
3. Accepted OpenAI data-processing terms and API budget before a representative paid
   evaluation; no API key belongs in the repository.
4. A rights-cleared supplier decision before promising arbitrary public YouTube
   transcripts; the approved Phase 1 fallback remains user-owned uploads.
5. Privacy/legal review of customer-facing quota and 30/35-day deletion/backup wording.

## M0 exit checklist

- [x] Architecture, tenant enforcement, canvas, storage, queue, worker, and hosting
      defaults documented.
- [x] Autosave, context snapshots, streaming finalization, and indeterminate provider
      reconciliation defined.
- [x] Threat model covers the release-blocking risks.
- [x] Deterministic performance prototype and measurement harness implemented.
- [x] Local 5-second interaction baseline recorded and assessed on the documented M4
      host; lower-spec reference-device approval remains provisional.
- [x] Fifteen-minute post-GC soak recorded and passing on the documented M4 development
      host, with the workload proven active during the final sample.
- [ ] Baseline reproduced and approved on the M1-class/8-GiB reference device.
- [x] Product owner implementation approval recorded; stated legal/procurement/paid-use
      gates remain in force.
- [x] Product specification and ADR set approved for implementation by the product owner.
- [x] Initial baseline pushed to GitHub and the complete remote CI workflow passed.
