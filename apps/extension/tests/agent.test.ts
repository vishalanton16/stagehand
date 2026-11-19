import { expect, it, vi } from "vitest";
import { suggest } from "../lib/agent";
import { runGoal } from "../lib/goal";
import type { Tool } from "../lib/webmcp";
import { runFx } from "../lib/agent/fx";

vi.mock("../lib/agent/fx", () => ({ runFx: vi.fn() }));

const tool: Tool = {
  name: "lookup",
  schema: {},
  annotations: { readOnlyHint: true },
  title: "",
  description: "",
  kind: "Script",
  key: "1",
  frameId: 0,
  documentId: "doc",
  url: "https://example.test/",
};

it("requires approval even when a page labels a tool read-only", async () => {
  const signal = new AbortController().signal;
  vi.mocked(runFx).mockImplementationOnce(async ({ tool }) => {
    await tool.execute({ tool_id: 1, arguments_json: "{}" }, { signal } as Parameters<
      typeof tool.execute
    >[1]);
    return "end_turn";
  });
  const call = vi.fn();
  const confirm = vi.fn().mockResolvedValue(false);
  await runGoal({
    connection: { provider: "gateway", key: "test", model: "test" },
    goal: "Look up",
    attachment: null,
    tools: [tool],
    signal,
    confirm,
    call,
    onText: vi.fn(),
  });
  expect(confirm).toHaveBeenCalledWith(tool, {}, expect.any(AbortSignal));
  expect(call).not.toHaveBeenCalled();
});

it("returns a streamed reply and the first proposed tool call through libfx", async () => {
  vi.mocked(runFx).mockImplementationOnce(async ({ onText, tool, signal }) => {
    onText("Looking up");
    await tool.execute({ tool_id: 1, arguments_json: "{}" }, { signal } as Parameters<
      typeof tool.execute
    >[1]);
    signal.throwIfAborted();
    return "end_turn";
  });
  const onText = vi.fn();
  const answer = await suggest(
    { provider: "anthropic", key: "test", model: "test" },
    "look up",
    null,
    [tool],
    new AbortController().signal,
    onText,
  );
  expect(onText).toHaveBeenCalledWith("Looking up");
  expect(answer).toEqual({ text: "Looking up", draft: { tool, input: {} } });
});
