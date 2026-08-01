# M1 verification

Date: 2026-08-01

## Exit criteria

| Criterion                                       | Evidence                                                                                                                                                                                |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Authentication and idempotent default workspace | Better Auth database sessions use a dedicated database role. Concurrent provisioning integration tests produce one personal workspace and one active owner membership.                  |
| Board lifecycle                                 | Authenticated UI and API support ordered active/archived lists, idempotent create, canonical open, rename, archive, and restore. Board names are trimmed and limited to 120 characters. |
| Tenant isolation                                | PostgreSQL RLS, scoped repositories, forged-scope tests, and two-user browser tests return the same non-disclosing `404` for foreign reads and mutations.                               |
| Complete UI states                              | Board routes include loading, empty, error, and retry states. Archive requires confirmation and remains recoverable.                                                                    |

## Checks run

- Reviewed migrations applied twice against PostgreSQL 17.9.
- Unit tests: 5 files, 15 tests.
- Database integration tests: 3 files, 9 tests.
- Browser tests: 12 tests across Chromium, Firefox, and WebKit.
- ESLint, strict TypeScript checks, formatting checks, dependency audit, and the production build are release gates in CI.

## Authentication delivery

- Google OIDC is enabled only when both Google credentials are configured.
- Magic links use hashed verification tokens, a ten-minute expiry, and bounded send rate.
  Delivery is enabled only when Resend credentials and the sender are configured.
- Email/password authentication is restricted to non-production local development and
  automated tests. It is not a production fallback.

Production provider credentials, redirect URI registration, domain/DNS setup, and a
live email-delivery contract check remain deployment configuration rather than source
code or local-test requirements.
