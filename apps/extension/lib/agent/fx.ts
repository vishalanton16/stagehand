import { createFxEngine, supportsJspi, type FxHostTool, type FxPromptBlock } from "libfx/browser";
import { providers, type Connection } from "./connections";
import { readImage, type Attachment } from "./input";

export async function runFx({
  connection,
  instructions,
  prompt,
  attachment,
  tool,
  signal,
  onText,
}: {
  connection: Connection;
  instructions: readonly string[];
  prompt: string;
  attachment: Attachment | null;
  tool: FxHostTool<unknown>;
  signal: AbortSignal;
  onText: (text: string) => void;
}) {
  signal.throwIfAborted();
  if (!supportsJspi()) throw new Error("Agent requires a browser with WebAssembly JSPI support.");
  const { provider, key, model } = connection;
  const configured = providers[provider];
  const origin = new URL(configured.baseUrl).origin;
  let status: number | undefined;
  const content: FxPromptBlock[] = [{ type: "text", text: prompt }];
  if (attachment) content.push({ type: "image", ...readImage(attachment) });

  const engine = await createFxEngine({
    model,
    instructions,
    tools: [tool],
    ...(provider === "gateway"
      ? { apiKey: key }
      : {
          provider: {
            name: provider,
            baseUrl: configured.baseUrl,
            modelDefaults: {
              supportsToolUse: true,
              supportsVision: true,
              outputLimitField:
                provider === "openai"
                  ? ("max_completion_tokens" as const)
                  : ("max_tokens" as const),
            },
          },
          credentials: () => ({ apiKey: key }),
        }),
    async fetch(url, init) {
      if (new URL(url).origin !== origin) throw new Error("Unexpected model endpoint.");
      const requestSignal = init.signal ? AbortSignal.any([signal, init.signal]) : signal;
      const headers = new Headers(init.headers);
      if (provider === "anthropic") headers.set("anthropic-dangerous-direct-browser-access", "true");
      const response = await fetch(url, {
        ...init,
        headers,
        credentials: "omit",
        redirect: "error",
        signal: requestSignal,
      });
      status = response.ok ? undefined : response.status;
      return response;
    },
  });

  try {
    signal.throwIfAborted();
    const turn = engine.prompt(content, { signal });
    const result = turn.result.catch((error: unknown) => ({ error }));
    let previousText = false;
    let nextParagraph = false;
    for await (const event of turn) {
      if (event.type === "tool_start" && previousText) nextParagraph = true;
      if (event.type === "text_delta") {
        onText(nextParagraph ? `\n\n${event.delta}` : event.delta);
        nextParagraph = false;
        previousText = true;
      }
    }
    const finished = await result;
    if ("error" in finished) throw finished.error;
    return finished.stopReason;
  } catch (error) {
    if (signal.aborted) throw error;
    if (status === 401 || status === 403)
      throw new Error(`Check the ${configured.name} API key in Settings.`);
    if (status === 402) throw new Error(`Check your ${configured.name} balance.`);
    if (status === 429) throw new Error(`${configured.name} rate limit reached.`);
    if (status) throw new Error(`${configured.name} request failed (HTTP ${status}).`);
    throw error;
  } finally {
    await engine.close();
  }
}
