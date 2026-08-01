# ADR-0002: Better Auth sessions plus repository scope and PostgreSQL RLS

- Status: Accepted for M0 implementation
- Date: 2026-08-01

## Context

The product specification treats any cross-tenant read, write, existence disclosure,
stream, citation, worker action, or object access as release-blocking. Authentication
identifies a user but cannot establish authorization to every child resource. Relying
only on developer discipline in ad-hoc query filters leaves a single missed predicate as
a breach; relying only on RLS makes relationship and response semantics harder to audit.

Auth.js has joined Better Auth and its maintainers recommend Better Auth for new work.
Better Auth supports Next.js, database sessions, revocation, and Drizzle/PostgreSQL.

## Decision

Use Better Auth with server-validated, database-backed, revocable sessions. The private
alpha provider set is Google OIDC plus verified email magic link. Cookie presence alone,
Next.js proxy/middleware, or client state is never a protected-resource authorization
decision.

Tenant enforcement uses two mandatory layers:

1. repository/API/worker methods require a server-resolved `WorkspaceScope`, verify
   active membership and same-workspace parent chains, and return uniform non-disclosing
   not-found responses;
2. every tenant-owned database transaction sets transaction-local `app.workspace_id`
   and `app.user_id`; PostgreSQL RLS denies rows outside that scope.

Tenant-owned tables carry `workspace_id` directly where practical and use composite
foreign keys to prevent mixed-workspace relationships. Runtime web/worker roles cannot
`BYPASSRLS`; migrations use a distinct role. Workers re-resolve scope from canonical IDs
instead of trusting queue payloads.

## Consequences

- A missed repository predicate should still fail at the database layer.
- Integration tests must run with the real runtime roles; testing as a superuser gives
  false confidence.
- Better Auth organization features do not replace project `workspace_membership`.
- OAuth/mail credentials, consent screen, and sending-domain verification are M1 gates.

## Sources

- [Better Auth Next.js integration](https://better-auth.com/docs/integrations/next)
- [Better Auth session management](https://better-auth.com/docs/concepts/session-management)
- [Auth.js joins Better Auth](https://better-auth.com/blog/authjs-joins-better-auth)
