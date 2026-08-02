# Private-alpha privacy and source-rights disclosure

Status: owner/legal review draft  
Date: 2026-08-02

This is the canonical content basis for the in-product `/trust` page. It is implementation
documentation, not a claim that legal, trademark, provider, or jurisdictional review has
been completed.

## Data and AI-provider processing

Boards, nodes, uploaded files, extracted content, and conversations belong to the active
workspace. For a grounded request, Siftloom sends only the source versions explicitly
connected to the AI node or confirmed for that request, together with the current request
and the minimum eligible conversation history. Other Boards and unselected sources are not
part of the provider request.

Automated/local evidence uses a deterministic fake provider and makes no paid call. An
external alpha requires an approved provider, model, region/retention configuration,
budget, and data-processing terms. Provider storage is disabled by the current OpenAI
adapter, but production configuration and agreement review remain release gates.

Operational logs contain opaque IDs, state, duration, byte/token counts, queue age, and
normalized errors. They exclude full prompts, answers, source text, sensitive filenames,
raw source URLs, credentials, authorization headers, and signed URLs.

## User responsibility and remote sources

Users may upload or import only content they are authorized to process. Siftloom does not
bypass authentication, paywalls, DRM, robots controls, or platform technical restrictions.
Phase 1 YouTube support uses the official API for public metadata only; it does not download
video bytes or obtain restricted transcripts. When transcript text is unavailable, the
product directs the user to upload a rights-cleared UTF-8 transcript as a separate source.

Generated output is grounded to selected material and exposes generation-time snapshots.
This means the response can be traced to those materials; it does not mean Siftloom has
independently verified their truth or the generated conclusion.

## Retention, access, correction, and deletion

- Soft-deleted nodes remain recoverable for 30 days.
- After a verified account/workspace deletion request, access must stop immediately and
  deletion from primary systems is targeted within 30 days.
- Backup copies expire within at most 35 days under the Phase 1 policy.
- Queued work must stop using tombstoned data; deleted content cannot be newly signed,
  processed, cited, or regenerated.

Private-alpha users request a data copy, profile correction, or deletion through the
configured `PRIVACY_CONTACT_EMAIL`. Identity must be verified before data is disclosed or
deleted. The external alpha must configure a monitored, deliverable address; `.local`
fallbacks are development-only.

## Support and security reports

Saving failures, stuck processing, incorrect citations, suspected cross-workspace access,
exposed credentials, or duplicate usage should be reported through the configured
`SUPPORT_EMAIL`. A report should include time, Board name, and visible state, but must not
send credentials, signed links, or complete private source/prompt/answer content by email.

## Approval gates

Before external private-alpha access, the owner must record approval for the final product
name, launch jurisdiction/language, privacy/retention wording, provider processing terms,
support/privacy mailboxes, production authentication and delivery path, and data deletion
operator procedure. Professional legal review is recommended and remains outstanding.
