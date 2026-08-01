# ADR-0007: Configured AI evaluation and compliant public-video fallback

- Status: Accepted for M0 implementation; provider spend/data gates remain
- Date: 2026-08-01

## Context

Provider model IDs, pricing, quality, latency, and policies change. Hard-coding one SDK
through the domain would make evaluation and migration unsafe. Likewise, YouTube's
official captions API does not grant arbitrary public-video transcript access: caption
download requires an authorized user with permission to edit the video. Undocumented
watch-page/transcript scraping is not a reliable or compliant product dependency.

## Decision

### AI

Use a project-owned gateway with normalized streaming, cancellation, error, capability,
and usage contracts. Provider SDK types remain inside adapters. Automated tests and CI
use `FakeAiProvider` and never call a paid model.

The first representative evaluation candidate is OpenAI Responses API with exact model
`gpt-5.6-terra`, reasoning effort `low`, chosen because current official guidance places
Terra at the intelligence/cost balance point. Do not use a floating `latest` alias. Run a
20–30 task evaluation for grounded-answer quality, valid-reference rate, source exclusion
behavior, latency/TTFT, tokens, and cost before freezing the alpha configuration. Provider
account, key, data-processing terms, region, and budget require owner approval.

### Public video

Use the YouTube Data API for permitted public metadata such as title, duration, and
caption availability. Phase 1 does not request YouTube caption-management OAuth scopes or
store a YouTube refresh token, so it does not call `captions.download`, even for a video
the user owns. Return `transcript_unavailable` and offer upload of a rights-controlled
transcript/audio file. A future owner-caption path needs a separate ADR covering scopes,
incremental consent, token encryption/revocation, privacy copy, and acceptance tests. Any
external transcript vendor likewise requires a documented rights chain, privacy/security
assessment, retention behavior, and legal owner approval before becoming an adapter.

## Consequences

- Model configuration can change through an evaluated, versioned adapter without changing
  context/citation semantics.
- Phase 1 deliberately cannot promise arbitrary public YouTube transcripts.
- User-facing copy must distinguish metadata import, transcript availability, and
  user-owned upload fallback.

## Sources

- [OpenAI model selection](https://developers.openai.com/api/docs/models)
- [OpenAI GPT-5.6 guidance](https://developers.openai.com/api/docs/guides/latest-model)
- [YouTube captions download permission](https://developers.google.com/youtube/v3/docs/captions/download)
- [YouTube video resource metadata](https://developers.google.com/youtube/v3/docs/videos)
