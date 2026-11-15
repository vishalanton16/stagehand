import { afterEach, describe, expect, it, vi } from "vitest";
import { guardActionTarget } from "../services/decisions/actionGuard.js";
import { resolveLocatorWithHops } from "../understudy/deepLocator.js";
import type { Page } from "../understudy/page.js";
import type { Progress } from "../understudy/progress.js";

vi.mock("../understudy/deepLocator.js", () => ({ resolveLocatorWithHops: vi.fn() }));
afterEach(() => vi.restoreAllMocks());

function setup(verdict = "ok", nodeId = 12) {
  const send = vi.fn(async (method: string) =>
    method === "Runtime.callFunctionOn" ? { result: { value: verdict } } : {},
  );
  const locator = {
    backendNodeId: vi.fn(async () => nodeId),
    getFrame: () => ({ frameId: "main", session: { send } }),
    resolveNode: vi.fn(async () => ({ objectId: "input" })),
  };
  vi.mocked(resolveLocatorWithHops).mockResolvedValue(locator as never);
  const page = { mainFrame: () => ({}), getOrdinal: () => 0 } as unknown as Page;
  const progress = { throwIfStopped: vi.fn() } as unknown as Progress;
  return { page, progress, send, locator };
}

describe("action execution eligibility", () => {
  it("rejects a replaced model target without reading or acting on the replacement", async () => {
    const { page, progress, locator, send } = setup("ok", 99);
    expect(
      await guardActionTarget(
        page,
        { selector: "input", method: "fill", description: "Field" },
        progress,
        "0-12",
      ),
    ).toBe("target_replaced");
    expect(locator.resolveNode).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });
  it.each(["target_disabled", "target_readonly", "target_hidden", "target_not_editable"])(
    "returns %s and releases the remote node",
    async (verdict) => {
      const { page, progress, send } = setup(verdict);
      expect(
        await guardActionTarget(
          page,
          { selector: "input", method: "fill", description: "Field" },
          progress,
          "0-12",
        ),
      ).toBe(verdict);
      expect(send).toHaveBeenLastCalledWith("Runtime.releaseObject", { objectId: "input" });
    },
  );
  it("fails closed when the eligibility probe has no result", async () => {
    const { page, progress, send } = setup();
    send.mockResolvedValueOnce({} as never);
    expect(
      await guardActionTarget(
        page,
        { selector: "input", method: "fill", description: "Field" },
        progress,
      ),
    ).toBe("target_unresolved");
    expect(send).toHaveBeenLastCalledWith("Runtime.releaseObject", { objectId: "input" });
  });
});
