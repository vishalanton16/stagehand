import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanupActiveRunResources } from "../framework/activeRunCleanup.js";
import { initStagehand } from "../initStagehand.js";
import type { EvalLogger } from "../logger.js";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  connectBrowserbase: vi.fn(),
  launchLocal: vi.fn(),
  launchRemote: vi.fn(),
  resolveKey: vi.fn(),
}));

vi.mock("@browserbasehq/stagehand", () => ({
  Stagehand: { create: mocks.create },
  browserbase: { connect: mocks.connectBrowserbase },
  localBrowser: { launch: mocks.launchLocal },
}));
vi.mock("../core/targets/browserbase.js", () => ({
  launchRunnerProvidedBrowserbaseChrome: mocks.launchRemote,
}));
vi.mock("../tui/welcomeStatus.js", () => ({ resolveKey: mocks.resolveKey }));

describe("native Stagehand evaluation initialization", () => {
  const page = { id: "test-page" };
  const browser = { close: vi.fn() };
  const stagehand = {
    close: vi.fn(),
    act: vi.fn(),
    observe: vi.fn(),
    experimentalDecisions: { act: vi.fn(), observe: vi.fn(), extract: vi.fn() },
    browser: { context: { activePage: vi.fn() } },
  };
  const releaseSession = vi.fn();
  const logger = { log: vi.fn() } as unknown as EvalLogger;

  beforeEach(() => {
    vi.resetAllMocks();
    mocks.resolveKey.mockImplementation((name: string) => ({
      value:
        name === "OPENAI_API_KEY"
          ? "test-model-key"
          : name === "BROWSERBASE_API_KEY"
            ? "test-browser-key"
            : "",
      source: "process-env",
    }));
    mocks.launchLocal.mockResolvedValue(browser);
    mocks.connectBrowserbase.mockResolvedValue(browser);
    mocks.launchRemote.mockResolvedValue({
      sessionId: "test-session",
      sessionUrl: "https://browserbase.test/sessions/test-session",
      debugUrl: "https://browserbase.test/debug/test-session",
      cleanup: releaseSession,
    });
    mocks.create.mockResolvedValue(stagehand);
    stagehand.browser.context.activePage.mockResolvedValue(page);
    stagehand.close.mockResolvedValue(undefined);
    browser.close.mockResolvedValue(undefined);
    releaseSession.mockResolvedValue(undefined);
  });

  afterEach(async () => {
    await cleanupActiveRunResources();
    vi.unstubAllEnvs();
  });

  it("routes decision observation without the harness prompt that would force fallback", async () => {
    vi.stubEnv("EVAL_DECISIONS", "1");
    vi.stubEnv("EVAL_DECISIONS_OBSERVE", "1");
    vi.stubEnv("EVAL_DECISIONS_PROVIDER", "perplexity");
    mocks.resolveKey.mockReturnValue({ value: "test-key", source: "process-env" });
    await initStagehand({ logger, modelName: "openai/gpt-6-astra", environment: "LOCAL" });
    expect(mocks.create.mock.calls[0]![0]).not.toHaveProperty("systemPrompt");
    expect(mocks.create.mock.calls[0]![0].experimentalDecisions).toMatchObject({
      provider: "perplexity",
    });
    await stagehand.observe("Find Submit");
    expect(stagehand.experimentalDecisions.observe).toHaveBeenCalledWith("Find Submit");
  });

  it.each(["LOCAL", "BROWSERBASE"] as const)(
    "keeps structured SDK operations on their default policy through %s initialization",
    async (environment) => {
      const result = await initStagehand({
        logger,
        modelName: "openai/gpt-6-astra",
        environment,
      });

      expect(mocks.create).toHaveBeenCalledExactlyOnceWith({
        browser,
        selfHeal: true,
        model: { modelName: "openai/gpt-6-astra", apiKey: "test-model-key" },
        logging: { onLog: expect.any(Function) },
      });
      expect(result.stagehand).toBe(stagehand);
      expect(result.page).toBe(page);
      expect(stagehand.browser.context.activePage).toHaveBeenCalledOnce();
      if (environment === "LOCAL") {
        expect(mocks.launchLocal).toHaveBeenCalledExactlyOnceWith({ headless: false });
        expect(mocks.launchRemote).not.toHaveBeenCalled();
        expect(mocks.connectBrowserbase).not.toHaveBeenCalled();
        expect(result.sessionUrl).toBe("");
        expect(result.debugUrl).toBe("");
      } else {
        expect(mocks.launchLocal).not.toHaveBeenCalled();
        expect(mocks.launchRemote).toHaveBeenCalledOnce();
        expect(mocks.connectBrowserbase).toHaveBeenCalledExactlyOnceWith({
          apiKey: "test-browser-key",
          sessionId: "test-session",
        });
        expect(result.sessionUrl).toBe("https://browserbase.test/sessions/test-session");
        expect(result.debugUrl).toBe("https://browserbase.test/debug/test-session");
      }

      await result.cleanup();
      await result.cleanup();
      await cleanupActiveRunResources();
      expect(stagehand.close).toHaveBeenCalledOnce();
      expect(browser.close).toHaveBeenCalledOnce();
      expect(releaseSession).toHaveBeenCalledTimes(environment === "BROWSERBASE" ? 1 : 0);
    },
  );

  it.each([false, true])(
    "releases the remote session after create failure even if browser close fails (%s)",
    async (closeFails) => {
      if (closeFails) browser.close.mockRejectedValue(new Error("close failed"));
      const error = new Error("synthetic initialization failure");
      mocks.create.mockRejectedValue(error);

      await expect(
        initStagehand({ logger, modelName: "openai/gpt-6-astra", environment: "BROWSERBASE" }),
      ).rejects.toBe(error);

      expect(mocks.create.mock.calls[0]![0]).not.toHaveProperty("systemPrompt");
      expect(browser.close).toHaveBeenCalledOnce();
      expect(releaseSession).toHaveBeenCalledOnce();
      expect(stagehand.close).not.toHaveBeenCalled();
      expect(stagehand.browser.context.activePage).not.toHaveBeenCalled();
    },
  );
});
