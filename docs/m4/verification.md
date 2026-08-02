# M4 verification

Date: 2026-08-02

## Exit criteria

| Criterion                         | Evidence                                                                                                                                                                                                                                                                                                          |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Explicit authorized sources       | Every send reauthorizes the chat node, incoming context edges, group children, and confirmed one-time selections inside a tenant transaction. Deleted, empty, unsupported, or not-ready sources are excluded with a visible reason; a run with no eligible source is blocked.                                     |
| Frozen deterministic context      | Each run stores an immutable manifest and exact source snapshots with node/artifact versions, hashes, selected segment IDs, source handles, truncation state, token allocations, exclusions, and eligible history IDs. Stable round-robin allocation enforces the central 64k input budget and 8k output reserve. |
| Prompt-injection boundary         | Privileged grounding instructions stay server-side. Imported content is delimited as untrusted data, tools and web access are absent, and the current user request is structurally separate.                                                                                                                      |
| Durable run lifecycle             | Run creation and SSE subscription are separate. The user message, manifest, snapshots, quota-reserving run, and provider attempt commit before execution. Stream events have monotonic sequence IDs and replay from PostgreSQL; disconnect never creates another provider call.                                   |
| Canonical finalization            | Deltas remain non-canonical. Completion validates exact `[S#]` handles and atomically writes at most one assistant message, its source links, normalized input/cached/output usage, and the terminal event. Invalid citations fail while provider-reported usage is still committed once.                         |
| Cancellation and ambiguity        | Queued work cancels before a provider call; running work uses `AbortSignal`. Safe failures may be retried only as a new run. An outcome that may have been paid but cannot be proven enters `reconciliation_required` and is never automatically reinvoked.                                                       |
| Tenant and relationship isolation | All nine M4 tenant tables force RLS for the non-bypass web role. Board/chat/run/snapshot relationships are checked at each HTTP boundary, and cross-workspace reads return a non-disclosing not-found result.                                                                                                     |

## Automated evidence

- Fresh-database migration replay created all 24 public tables and verified forced RLS on
  all nine M4 tenant tables; the temporary verification database was then removed.
- Unit suite: 9 files, 33 tests. Database suite: 6 files, 23 tests. Browser suite:
  23 tests across Chromium, Firefox, and WebKit.
- Unit tests cover deterministic allocation, history-pair preservation, untrusted-source
  delimiters, exact citation validation, fake streaming, OpenAI SSE normalization, cached
  token accounting, and ambiguous connection loss without a live call.
- Database integration tests cover manifest/source freezing, idempotent create and
  mismatched replay, canonical message finalization, immutable snapshot access after
  source edits, once-only usage on success and citation failure, queued cancellation,
  reconciliation, and cross-tenant isolation.
- Browser tests cover source creation and connection, grounded SSE generation, canonical
  refetch after refresh, citation interaction, and generation-time snapshot display.
- Root formatting, ESLint, strict TypeScript, unit, database, production build,
  dependency audit, and cross-browser E2E commands are release gates.

## Provider gate

Automated evidence uses only `FakeAiProvider`. The OpenAI adapter follows the official
[Responses streaming guide](https://developers.openai.com/api/docs/guides/streaming-responses),
sets `stream: true`, sends no tools, disables provider storage, and keeps the stable run ID
as its idempotency key. A real-provider call remains intentionally blocked until the owner
approves the evaluation budget, data-processing terms, and exact model configuration.
