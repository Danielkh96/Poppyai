import { buildGroundedInput, GROUNDED_SYSTEM_INSTRUCTIONS } from "./context.js";
import {
  FakeAiProvider,
  ProviderError,
  type AiProvider,
  type GenerateEvent,
  type GenerateRequest
} from "./provider.js";

interface OpenAiStreamEvent {
  readonly type?: string;
  readonly delta?: string;
  readonly response?: {
    readonly id?: string;
    readonly usage?: {
      readonly input_tokens?: number;
      readonly output_tokens?: number;
      readonly input_tokens_details?: { readonly cached_tokens?: number };
    };
    readonly error?: { readonly code?: string; readonly message?: string };
  };
  readonly code?: string;
  readonly message?: string;
}

async function* readSse(response: Response): AsyncIterable<OpenAiStreamEvent> {
  if (!response.body) {
    throw new ProviderError("Provider returned no stream", "ambiguous", "empty_stream");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      buffer += decoder.decode(result.value, { stream: true });
      const blocks = buffer.split(/\r?\n\r?\n/);
      buffer = blocks.pop() ?? "";
      for (const block of blocks) {
        const payload = block
          .split(/\r?\n/)
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart())
          .join("\n");
        if (!payload || payload === "[DONE]") continue;
        yield JSON.parse(payload) as OpenAiStreamEvent;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export class OpenAiResponsesProvider implements AiProvider {
  public readonly name = "openai";

  public constructor(
    private readonly apiKey: string,
    public readonly model: string,
    private readonly endpoint = "https://api.openai.com/v1/responses",
    private readonly fetchImplementation: typeof fetch = fetch,
    private readonly requestTimeoutMs = 120_000
  ) {
    if (!apiKey) throw new Error("OPENAI_API_KEY is required for the OpenAI provider");
  }

  public async *stream(request: GenerateRequest): AsyncIterable<GenerateEvent> {
    let response: Response;
    try {
      response = await this.fetchImplementation(this.endpoint, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          "content-type": "application/json",
          "idempotency-key": request.runId
        },
        body: JSON.stringify({
          model: this.model,
          instructions: GROUNDED_SYSTEM_INSTRUCTIONS,
          input: buildGroundedInput(request),
          reasoning: { effort: "low" },
          stream: true,
          store: false
        }),
        signal: AbortSignal.any([
          request.signal,
          AbortSignal.timeout(this.requestTimeoutMs)
        ])
      });
    } catch (error) {
      if (request.signal.aborted) {
        throw new ProviderError("Generation cancelled", "cancelled", "cancelled", {
          cause: error
        });
      }
      throw new ProviderError(
        "Could not determine whether the provider accepted the request",
        "ambiguous",
        "provider_connection_lost",
        { cause: error }
      );
    }

    if (!response.ok) {
      const safelyRetryable =
        response.status === 408 || response.status === 429 || response.status >= 500;
      throw new ProviderError(
        `Provider rejected the request (${response.status})`,
        safelyRetryable ? "safe_to_retry" : "terminal",
        `provider_http_${response.status}`
      );
    }

    let providerRequestId: string | null = null;
    try {
      for await (const event of readSse(response)) {
        if (event.type === "response.created" && event.response?.id) {
          providerRequestId = event.response.id;
          yield { type: "started", providerRequestId };
        } else if (event.type === "response.output_text.delta" && event.delta) {
          yield { type: "text_delta", delta: event.delta };
        } else if (event.type === "response.completed") {
          const usage = event.response?.usage;
          yield {
            type: "completed",
            inputTokens: usage?.input_tokens ?? 0,
            cachedInputTokens: usage?.input_tokens_details?.cached_tokens ?? 0,
            outputTokens: usage?.output_tokens ?? 0
          };
          return;
        } else if (event.type === "response.failed" || event.type === "error") {
          throw new ProviderError(
            event.response?.error?.message ?? event.message ?? "Provider generation failed",
            "terminal",
            event.response?.error?.code ?? event.code ?? "provider_failed"
          );
        }
      }
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      if (request.signal.aborted) {
        throw new ProviderError("Generation cancelled", "cancelled", "cancelled", {
          cause: error
        });
      }
      throw new ProviderError(
        "Provider stream ended before a canonical result was observed",
        providerRequestId ? "ambiguous" : "safe_to_retry",
        "provider_stream_interrupted",
        { cause: error }
      );
    }
    throw new ProviderError(
      "Provider stream ended without completion",
      providerRequestId ? "ambiguous" : "safe_to_retry",
      "provider_incomplete"
    );
  }
}

export function createConfiguredAiProvider(
  environment: Readonly<Record<string, string | undefined>>
): AiProvider {
  if ((environment.AI_PROVIDER ?? "fake") === "fake") return new FakeAiProvider();
  if (environment.AI_PROVIDER !== "openai") {
    throw new Error(`Unsupported AI_PROVIDER: ${environment.AI_PROVIDER}`);
  }
  return new OpenAiResponsesProvider(
    environment.OPENAI_API_KEY ?? "",
    environment.OPENAI_MODEL ?? "gpt-5.6-terra"
  );
}
