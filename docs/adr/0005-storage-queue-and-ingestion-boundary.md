# ADR-0005: S3 storage, transactional pg-boss dispatch, and isolated ingestion

- Status: Accepted for M0 implementation
- Date: 2026-08-01

## Context

Uploads are too large for ordinary application request bodies, while parsing, remote
fetching, and transcription require time/resource limits, retries, cancellation, and
crash recovery. A PostgreSQL write followed by enqueueing into another system can lose a
job or duplicate effects without an outbox. BullMQ would add Redis and still require a
PostgreSQL-to-Redis outbox relay.

MinIO's community repository was archived in 2026, so it is not selected as the default
new local dependency.

## Decision

- Use a project-owned `ObjectStorage` interface implemented with AWS SDK v3 S3 APIs.
- Use private real S3 in production and Adobe S3Mock 5.1.0 locally/CI. S3Mock is only a
  fast API double; a real-S3 opt-in contract suite proves signing/expiry/method/CORS.
- Sign only an exact workspace-derived object key, action, size/type/checksum, and short
  TTL. Completion reauthorizes and verifies actual object metadata/bytes.
- Use pg-boss 12 in the same PostgreSQL database. Its transaction adapter inserts the
  business intent and queue job atomically; no separate internal outbox relay is needed.
- Jobs carry opaque IDs, not trusted content/scope. The worker reauthorizes, creates
  immutable attempts, holds a lease, classifies retryability, and uses idempotent external
  effects. A stale worker cannot overwrite a newer terminal state.
- Remote retrieval/parsing runs behind an isolated boundary with no ambient credentials
  or parser network, DNS/redirect SSRF revalidation, and strict time/byte/page/CPU/memory/
  decompression limits.

## Consequences

- PostgreSQL and S3 are the only persistent infrastructure systems for Phase 1.
- pg-boss requires Node ≥22.12 and PostgreSQL ≥13; the project baseline satisfies both.
- The queue's delivery claims do not make external APIs exactly once; handlers remain
  idempotent and ambiguity-aware.
- Real S3 negative contract tests and production schema migration for pg-boss are launch
  gates.

## Sources

- [pg-boss](https://github.com/timgit/pg-boss)
- [AWS S3 presigned URLs](https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-presigned-url.html)
- [Adobe S3Mock](https://github.com/adobe/S3Mock)
- [Archived MinIO community repository](https://github.com/minio/minio)
