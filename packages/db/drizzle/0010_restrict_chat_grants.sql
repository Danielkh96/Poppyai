-- M4 canonical messages, frozen manifests/snapshots, stream events, and usage are
-- append-only. Earlier local databases briefly received UPDATE through the initial
-- table grant, so explicitly remove it while retaining SELECT/INSERT.
REVOKE UPDATE ON TABLE
  chat_message,
  chat_message_source,
  context_manifest,
  context_source_snapshot,
  chat_run_event,
  usage_event
FROM siftloom_web;
