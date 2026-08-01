# ADR-0006: Immutable grounded context, SSE deltas, and canonical finalization

- Status: Accepted for M0 implementation
- Date: 2026-08-01

## Context

An answer must be reconstructable from the exact authorized text supplied at generation
time. Current board membership alone is insufficient because sources can change, be
deleted, or become unauthorized. Streaming deltas can be missed or duplicated and are
not safe canonical messages. Provider timeouts may have an indeterminate paid outcome.

## Decision

Before every run, the server authorizes chat/board/workspace and resolves only explicit
incoming connections plus confirmed one-time selections. It freezes:

- exact text or immutable artifact segment references;
- node/artifact revisions and hashes;
- stable source handles and all node aliases after content dedupe;
- exclusions/truncations and included history message IDs;
- deterministic ordering and token allocation.

Default assembly uses user-selected chip order, then edge rank/node ID, stable source
dedupe, approximately 800-token chunks with 100-token overlap, deterministic BM25 within
the authorized set, per-source fair allocation, and original segment order in the final
prompt. History enters only when its snapshot lineage is a subset of the new authorized
manifest.

Imported content is delimited untrusted data. Grounded chat has no side-effecting tools or
secrets. Generated handles are validated against the frozen manifest and authority is
rechecked before canonical finalization.

SSE carries temporary sequence-numbered run events. Completion atomically creates at
most one canonical assistant message, validated message-source records, and append-only
unique usage events. The browser refetches canonical state. Retry creates a new linked
run. An ambiguous provider result becomes terminal `reconciliation_required` and is not
automatically reinvoked.

## Consequences

- Historic citations remain reproducible after a source changes.
- Snapshot storage and retention must be explicitly budgeted and included in deletion.
- SSE reconnection needs replay bounds plus canonical refetch; WebSockets remain deferred.
- Source exclusion/truncation and changed-source state must be visible to users.

## Source

- [OpenAI streaming Responses with SSE](https://developers.openai.com/api/docs/guides/streaming-responses)
