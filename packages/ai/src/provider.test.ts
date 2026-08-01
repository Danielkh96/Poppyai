import { describe, expect, it } from "vitest";

import { FakeAiProvider, type GenerateEvent } from "./provider.js";

describe("FakeAiProvider", () => {
  it("returns stable source handles without a paid network call", async () => {
    const provider = new FakeAiProvider();
    const events: GenerateEvent[] = [];

    for await (const event of provider.stream({
      runId: "run-1",
      userPrompt: "summarize",
      context: [
        {
          snapshotId: "snapshot-1",
          sourceHandle: "S1",
          title: "Source",
          exactText: "Grounded text",
          contentHash: "sha256:test"
        }
      ],
      signal: new AbortController().signal
    })) {
      events.push(event);
    }

    expect(events[0]).toEqual({ type: "started", providerRequestId: "fake:run-1" });
    expect(
      events.some((event) => event.type === "text_delta" && event.delta.includes("[S1]"))
    ).toBe(true);
    expect(events.at(-1)?.type).toBe("completed");
  });
});
