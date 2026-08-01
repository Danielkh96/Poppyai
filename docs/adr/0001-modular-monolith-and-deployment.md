# ADR-0001: Modular monolith with separate web and worker processes

- Status: Accepted for M0 implementation
- Date: 2026-08-01

## Context

Phase 1 needs authenticated HTTP/SSE, transactional graph writes, durable long-running
ingestion, object storage, and a provider-neutral AI boundary. Splitting every domain
into a network service would add deployment, tracing, authentication, retry, and data
consistency problems before workload evidence justifies them. Running ingestion inside
ordinary Next.js requests would make timeouts, retries, cancellation, and scaling unsafe.

## Decision

Use one pnpm/strict-TypeScript modular monorepo with two independently deployable Node
processes:

- `apps/web`: Next.js App Router web, API, and SSE;
- `apps/worker`: durable leased jobs;
- project-owned domain/infrastructure packages under `packages/*`.

Both processes use PostgreSQL. Binaries use an S3-compatible interface. Production
containers target ECS/Fargate, RDS PostgreSQL, and S3 in AWS `ap-southeast-1`, behind an
ALB that preserves SSE flushing. Local infrastructure runs in Docker Compose; app
processes normally run on the host for fast feedback.

Domain types do not depend on Next.js, React Flow, Drizzle records, pg-boss payloads, or
AI provider SDKs. Network services may be extracted later only with measured scaling,
isolation, ownership, or release-cadence evidence.

## Consequences

- Business writes and internal job dispatch can share one transaction.
- Web and worker scale/fail independently without a distributed domain model.
- Production still needs separate migration, web, and worker database roles and deploy
  ordering.
- AWS region/budget is an owner approval; adapters keep a later platform move possible.

## Alternatives rejected

- Serverless-only Next.js with request-bound ingestion: unsuitable for bounded leases,
  parser isolation, and predictable streaming.
- Microservices per domain: premature operational and consistency cost.
- A single web process that also polls jobs: failure and scaling coupling.
