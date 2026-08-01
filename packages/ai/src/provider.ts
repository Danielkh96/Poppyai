export interface ContextSnapshot {
  readonly snapshotId: string;
  readonly sourceHandle: string;
  readonly title: string;
  readonly exactText: string;
  readonly contentHash: string;
}

export interface GenerateRequest {
  readonly runId: string;
  readonly userPrompt: string;
  readonly context: readonly ContextSnapshot[];
  readonly signal: AbortSignal;
}

export type GenerateEvent =
  | { readonly type: "started"; readonly providerRequestId: string }
  | { readonly type: "text_delta"; readonly delta: string }
  | {
      readonly type: "completed";
      readonly inputTokens: number;
      readonly outputTokens: number;
    };

export interface AiProvider {
  readonly name: string;
  stream(request: GenerateRequest): AsyncIterable<GenerateEvent>;
}

/** Deterministic and free: the only provider used by tests and M0. */
export class FakeAiProvider implements AiProvider {
  public readonly name = "fake";

  public async *stream(request: GenerateRequest): AsyncIterable<GenerateEvent> {
    if (request.signal.aborted) throw request.signal.reason;

    yield { type: "started", providerRequestId: `fake:${request.runId}` };
    const handles = request.context
      .map((snapshot) => `[${snapshot.sourceHandle}]`)
      .join(" ");
    const answer = `已根据 ${request.context.length} 个授权来源生成。${handles}`;

    for (const word of answer.split(" ")) {
      if (request.signal.aborted) throw request.signal.reason;
      yield { type: "text_delta", delta: `${word} ` };
      await Promise.resolve();
    }

    yield {
      type: "completed",
      inputTokens: request.context.reduce((sum, item) => sum + item.exactText.length, 0),
      outputTokens: answer.length
    };
  }
}
