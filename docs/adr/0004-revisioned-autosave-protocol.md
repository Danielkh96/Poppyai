# ADR-0004: Revisioned, idempotent autosave with retained local operations

- Status: Accepted for M0 implementation
- Date: 2026-08-01

## Context

Canvas edits are frequent and may encounter duplicated/delayed responses, refreshes,
offline periods, two tabs, and process failures. A single board-level compare-and-swap
creates false conflicts between unrelated nodes. Last-write-wins silently loses edits.
An HTTP success without a durable idempotency receipt cannot safely clean client state.

## Decision

The client stores ordered pending operations and visibly transitions
`clean → dirty → saving → saved`, with branches to retained `failed` or `conflict`.
After a 750 ms debounce it sends a bounded batch containing:

- stable `mutationId` UUID;
- `baseBoardRevision` for canonical snapshot ordering;
- ordered operations with target ID and per-record expected revision;
- validated finite geometry/payload versions.

One database transaction:

1. authorizes the board and all target/parent relationships;
2. returns the existing receipt when `mutationId` is already acknowledged;
3. validates per-record expected revisions;
4. atomically applies the batch, increments changed record revisions and one board
   revision, and stores the mutation receipt/result.

Only same-record stale revisions create 409 conflict. The client accepts acknowledgements
monotonically and removes only operations covered by the matching receipt. Failed or
conflicted edits stay locally available for retry, copy, reload, or explicit reapply.
Navigation warns while unacknowledged operations remain.

## Consequences

- Retrying after a lost response is safe and returns the canonical prior result.
- The protocol requires receipt retention/cleanup longer than the maximum retry window.
- Multi-user real-time merge is not provided; this is predictable single-operator/two-tab
  conflict behavior.
- Fault-injection and response-reordering tests are mandatory before M2 exits.

## Alternatives rejected

- Last-write-wins: silent data loss.
- Board-level revision as the only precondition: false conflicts and poor scalability.
- Browser local storage as canonical persistence: violates durable server workspace
  requirements and multi-device expectations.
