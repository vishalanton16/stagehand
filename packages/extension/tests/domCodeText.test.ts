import { describe, expect, it, vi } from "vitest";
import { readDomCodeText } from "../services/decisions/domCodeText.js";
import type { UnderstudyRuntimePage } from "../runtime.js";

describe("rendered code-cell evidence", () => {
  it("keeps rendered spaces and rejects a stale node or multiline result", async () => {
    const tree = [
      "[0-1] row",
      "  [0-2] cell: repo:USER/ REPO",
      "    [0-3] code",
      "      [0-4] StaticText: USER/",
      "  [0-5] cell: git  status",
      "    [0-6] code",
      "  [0-7] cell: npm test",
      "    [0-8] code",
      "  [0-9] cell: first second",
      "    [0-10] code",
      "  [0-11] cell: no code",
      "  [1-1] cell: child frame",
      "    [1-2] code",
    ].join("\n");
    const paths = {
      "0-2": "/one",
      "0-5": "/two",
      "0-7": "/three",
      "0-9": "/four",
      "0-11": "/five",
      "1-1": "/child",
    };
    const evaluate = vi
      .fn<UnderstudyRuntimePage["evaluate"]>()
      .mockResolvedValue(["repo:USER/REPO", "git status", "npm lint", "first\nsecond"]);

    expect(await readDomCodeText({ evaluate }, tree, paths)).toEqual({
      tree: tree.replace("USER/ REPO", "USER/REPO").replace("git  status", "git status"),
      inspected: 4,
      corrected: 2,
    });
    expect(evaluate).toHaveBeenCalledExactlyOnceWith(
      expect.stringContaining(')(["/one","/two","/three","/four"])'),
    );
  });

  it("batches at most 32 cells and skips evaluation without candidates", async () => {
    const evaluate = vi.fn<UnderstudyRuntimePage["evaluate"]>().mockResolvedValue([]);
    const xpathMap: Record<string, string> = {};
    const tree = Array.from({ length: 40 }, (_, i) => {
      const id = `0-${2 * i}`;
      xpathMap[id] = `/td[${i + 1}]`;
      return `[${id}] cell: copy me\n  [0-${2 * i + 1}] code`;
    }).join("\n");

    expect(await readDomCodeText({ evaluate }, tree, {})).toEqual({
      tree,
      inspected: 0,
      corrected: 0,
    });
    expect(evaluate).not.toHaveBeenCalled();
    expect(await readDomCodeText({ evaluate }, tree, xpathMap)).toEqual({
      tree,
      inspected: 32,
      corrected: 0,
    });
    expect(evaluate).toHaveBeenCalledTimes(1);
  });
});
