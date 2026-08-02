import { describe, expect, it, vi } from "vitest";

import { OpenAiResponsesProvider } from "./openai-provider.js";
import type { GenerateEvent } from "./provider.js";

function sseResponse(events: readonly unknown[]): Response {
  return new Response(
    events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""),
    {
      status: 200,
      headers: { "content-type": "text/event-stream" }
    }
  );
}

describe("OpenAiResponsesProvider", () => {
  it("uses the Responses stream without tools and normalizes usage", async () => {
    const fetchImplementation = vi.fn(async (...arguments_: Parameters<typeof fetch>) => {
      void arguments_[0];
      return sseResponse([
        { type: "response.created", response: { id: "resp_1" } },
        { type: "response.output_text.delta", delta: "Answer [S1]" },
        {
          type: "response.completed",
          response: {
            usage: {
              input_tokens: 11,
              output_tokens: 4,
              input_tokens_details: { cached_tokens: 3 }
            }
          }
        }
      ]);
    });
    const provider = new OpenAiResponsesProvider(
      "test-key",
      "gpt-5.6-terra",
      "https://api.openai.test/v1/responses",
      fetchImplementation as typeof fetch
    );
    const events: GenerateEvent[] = [];
    for await (const event of provider.stream({
      runId: "run-1",
      userPrompt: "Answer",
      history: [],
      context: [
        {
          snapshotId: "snapshot-1",
          sourceHandle: "S1",
          title: "Source",
          exactText: "Grounded text",
          contentHash: "hash"
        }
      ],
      signal: new AbortController().signal
    })) {
      events.push(event);
    }
    const body = JSON.parse(String(fetchImplementation.mock.calls[0]?.[1]?.body)) as Record<
      string,
      unknown
    >;
    expect(body).toMatchObject({ model: "gpt-5.6-terra", stream: true, store: false });
    expect(body).not.toHaveProperty("tools");
    expect(String(body.input)).toContain("<untrusted_sources>");
    expect(events).toEqual([
      { type: "started", providerRequestId: "resp_1" },
      { type: "text_delta", delta: "Answer [S1]" },
      { type: "completed", inputTokens: 11, cachedInputTokens: 3, outputTokens: 4 }
    ]);
  });

  it("classifies a pre-response connection loss as ambiguous", async () => {
    const provider = new OpenAiResponsesProvider(
      "test-key",
      "gpt-5.6-terra",
      "https://api.openai.test/v1/responses",
      vi.fn(async () => {
        throw new TypeError("network lost");
      }) as typeof fetch
    );
    const consume = async () => {
      for await (const event of provider.stream({
        runId: "run-2",
        userPrompt: "Answer",
        history: [],
        context: [],
        signal: new AbortController().signal
      })) {
        void event;
      }
    };
    await expect(consume()).rejects.toMatchObject({
      kind: "ambiguous",
      code: "provider_connection_lost"
    });
  });
});
