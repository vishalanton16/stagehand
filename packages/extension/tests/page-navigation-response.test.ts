import type { Protocol } from "devtools-protocol";
import { describe, expect, it, vi } from "vitest";
import type { StagehandLogger } from "../logger.js";
import type { CDPSessionLike, CdpConnection } from "../understudy/cdp.js";
import { executionContexts } from "../understudy/executionContextRegistry.js";
import { Page } from "../understudy/page.js";

const MAIN_FRAME_ID = "frame-1";

type NavigationOptions = {
  emitResponse?: boolean;
  emitLifecycle?: boolean;
  finalUrl?: string;
  finishAfterLifecycle?: boolean;
  omitLoaderId?: boolean;
  sameDocument?: boolean;
  status?: number;
  synchronousResponse?: boolean;
};

class NavigationCDPSession implements CDPSessionLike {
  readonly id = "main";
  readonly calls: Array<{ method: string; params?: object }> = [];
  readonly handlers = new Map<string, Set<(params: unknown) => void>>();

  currentUrl = "https://example.test/current";
  readyState = "complete";
  navigationOptions: NavigationOptions = {};
  historyEntries: Protocol.Page.NavigationEntry[] = [];
  historyIndex = -1;
  requestSequence = 0;

  async send<Result = unknown>(method: string, params?: object): Promise<Result> {
    this.calls.push({ method, params });

    if (method === "Page.navigate") {
      const url = String((params as { url?: string } | undefined)?.url ?? "");
      this.currentUrl = url;
      const loaderId = this.dispatchNavigation(url, {
        ...this.navigationOptions,
        synchronousResponse: true,
      });
      return {
        frameId: MAIN_FRAME_ID,
        ...(this.navigationOptions.sameDocument || this.navigationOptions.omitLoaderId
          ? {}
          : { loaderId }),
      } as Result;
    }

    if (method === "Page.reload") {
      this.dispatchNavigation(this.currentUrl, this.navigationOptions);
      return {} as Result;
    }

    if (method === "Page.getNavigationHistory") {
      return {
        currentIndex: this.historyIndex,
        entries: this.historyEntries,
      } as Result;
    }

    if (method === "Page.navigateToHistoryEntry") {
      const entryId = Number((params as { entryId?: number } | undefined)?.entryId);
      const nextIndex = this.historyEntries.findIndex((entry) => entry.id === entryId);
      if (nextIndex === -1) throw new Error(`Unknown history entry ${entryId}`);
      this.historyIndex = nextIndex;
      this.currentUrl = this.historyEntries[nextIndex]!.url;
      this.dispatchNavigation(this.currentUrl, this.navigationOptions);
      return {} as Result;
    }

    if (method === "Runtime.evaluate") {
      return {
        result: { type: "string", value: this.readyState },
      } as Result;
    }

    return {} as Result;
  }

  on<Params = unknown>(event: string, handler: (params: Params) => void): void {
    const handlers = this.handlers.get(event) ?? new Set<(params: unknown) => void>();
    handlers.add(handler as (params: unknown) => void);
    this.handlers.set(event, handlers);
  }

  off<Params = unknown>(event: string, handler: (params: Params) => void): void {
    this.handlers.get(event)?.delete(handler as (params: unknown) => void);
  }

  async close(): Promise<void> {}

  emit<Params>(event: string, params: Params): void {
    for (const handler of this.handlers.get(event) ?? []) handler(params);
  }

  callsFor(method: string): Array<{ method: string; params?: object }> {
    return this.calls.filter((call) => call.method === method);
  }

  private dispatchNavigation(url: string, options: NavigationOptions): string {
    const sequence = ++this.requestSequence;
    const requestId = `request-${sequence}`;
    const loaderId = `loader-${sequence}`;
    const finalUrl = options.finalUrl ?? url;

    const emitResponse = () => {
      if (options.emitResponse === false) return;
      this.emit<Protocol.Network.ResponseReceivedEvent>("Network.responseReceived", {
        requestId,
        loaderId,
        timestamp: sequence,
        type: "Document",
        frameId: MAIN_FRAME_ID,
        hasExtraInfo: false,
        response: networkResponse(finalUrl, options.status ?? 200),
      });
    };

    if (options.synchronousResponse) emitResponse();

    setTimeout(() => {
      if (options.sameDocument) {
        this.emit<Protocol.Page.NavigatedWithinDocumentEvent>("Page.navigatedWithinDocument", {
          frameId: MAIN_FRAME_ID,
          url: finalUrl,
          navigationType: "fragment",
        });
        return;
      }

      this.emit<Protocol.Page.FrameNavigatedEvent>("Page.frameNavigated", {
        frame: {
          id: MAIN_FRAME_ID,
          loaderId,
          url: finalUrl,
          domainAndRegistry: "example.test",
          securityOrigin: new URL(finalUrl).origin,
          mimeType: "text/html",
          secureContextType: "Secure",
          crossOriginIsolatedContextType: "NotIsolated",
          gatedAPIFeatures: [],
        },
        type: "Navigation",
      });
      if (!options.synchronousResponse) emitResponse();
      const emitFinished = () => {
        if (options.emitResponse === false) return;
        this.emit<Protocol.Network.LoadingFinishedEvent>("Network.loadingFinished", {
          requestId,
          timestamp: sequence,
          encodedDataLength: 0,
        });
      };
      if (!options.finishAfterLifecycle) emitFinished();
      if (options.emitLifecycle !== false) {
        this.emit<Protocol.Page.LifecycleEventEvent>("Page.lifecycleEvent", {
          frameId: MAIN_FRAME_ID,
          loaderId,
          name: "DOMContentLoaded",
          timestamp: sequence,
        });
      }
      if (options.finishAfterLifecycle) setTimeout(emitFinished, 0);
    }, 0);

    return loaderId;
  }
}

function networkResponse(url: string, status: number): Protocol.Network.Response {
  return {
    url,
    status,
    statusText: status === 200 ? "OK" : "Not Found",
    headers: { "content-type": "text/html; charset=utf-8" },
    mimeType: "text/html",
    charset: "utf-8",
    connectionReused: false,
    connectionId: 1,
    encodedDataLength: 0,
    securityState: "secure",
  };
}

function createPage(session: NavigationCDPSession): Page {
  executionContexts.register(session, MAIN_FRAME_ID, 1);
  return new Page({} as CdpConnection, session, "target-1", MAIN_FRAME_ID, {} as StagehandLogger);
}

function historyEntry(id: number, url: string): Protocol.Page.NavigationEntry {
  return {
    id,
    url,
    userTypedURL: url,
    title: url,
    transitionType: "typed",
  };
}

describe("Page navigation responses", () => {
  it("captures a goto response that arrives before Page.navigate resolves", async () => {
    const session = new NavigationCDPSession();
    session.navigationOptions = {
      finalUrl: "https://example.test/final",
      status: 404,
    };
    const page = createPage(session);

    const response = await page.goto("https://example.test/redirect");

    expect(response).not.toBeNull();
    expect(response!.url()).toBe("https://example.test/final");
    expect(response!.status()).toBe(404);
    expect(response!.ok()).toBe(false);
    await expect(response!.finished()).resolves.toBeNull();
  });

  it("captures a buffered goto response when Page.navigate omits its loader id", async () => {
    const session = new NavigationCDPSession();
    session.navigationOptions = {
      finalUrl: "https://example.test/final-without-loader",
      omitLoaderId: true,
    };
    const page = createPage(session);

    const response = await page.goto("https://example.test/no-loader");

    expect(response).not.toBeNull();
    expect(response!.url()).toBe("https://example.test/final-without-loader");
    expect(response!.status()).toBe(200);
    await expect(response!.finished()).resolves.toBeNull();
  });

  it("captures reload responses with the default options", async () => {
    const session = new NavigationCDPSession();
    const page = createPage(session);

    const response = await page.reload();

    expect(response).not.toBeNull();
    expect(response!.url()).toBe("https://example.test/current");
    expect(session.callsFor("Page.reload")).toStrictEqual([
      {
        method: "Page.reload",
        params: { ignoreCache: false },
      },
    ]);
  });

  it("keeps the response alive when loading finishes after navigation returns", async () => {
    const session = new NavigationCDPSession();
    session.navigationOptions = { finishAfterLifecycle: true };
    const page = createPage(session);

    const response = await page.goto("https://example.test/slow-body");

    expect(response).not.toBeNull();
    await expect(response!.finished()).resolves.toBeNull();
  });

  it("captures back and forward responses with the default options", async () => {
    const session = new NavigationCDPSession();
    session.historyEntries = [
      historyEntry(1, "https://example.test/first"),
      historyEntry(2, "https://example.test/second"),
    ];
    session.historyIndex = 1;
    session.currentUrl = session.historyEntries[1]!.url;
    const page = createPage(session);

    const backResponse = await page.goBack();
    const forwardResponse = await page.goForward();

    expect(backResponse?.url()).toBe("https://example.test/first");
    expect(forwardResponse?.url()).toBe("https://example.test/second");
    expect(session.callsFor("Page.navigateToHistoryEntry")).toStrictEqual([
      { method: "Page.navigateToHistoryEntry", params: { entryId: 1 } },
      { method: "Page.navigateToHistoryEntry", params: { entryId: 2 } },
    ]);
  });

  it("returns null when history traversal has nowhere to go", async () => {
    const session = new NavigationCDPSession();
    session.historyEntries = [historyEntry(1, "https://example.test/only")];
    session.historyIndex = 0;
    const page = createPage(session);

    await expect(page.goBack()).resolves.toBeNull();
    await expect(page.goForward()).resolves.toBeNull();
    expect(session.callsFor("Page.navigateToHistoryEntry")).toHaveLength(0);
  });

  it.each(["data:text/html,<p>inline</p>", "about:blank"])(
    "returns null for the non-network navigation %s",
    async (url) => {
      const session = new NavigationCDPSession();
      const page = createPage(session);

      await expect(page.goto(url)).resolves.toBeNull();
    },
  );

  it("returns null for a same-document navigation without a document response", async () => {
    const session = new NavigationCDPSession();
    session.navigationOptions = { emitResponse: false, sameDocument: true };
    const page = createPage(session);

    await expect(page.goto("https://example.test/current#details")).resolves.toBeNull();
  });
});

describe("Page navigation deadlines", () => {
  it("times out while waiting for Page.navigate and releases the watcher", async () => {
    vi.useFakeTimers();
    try {
      const session = new NavigationCDPSession();
      const send = session.send.bind(session);
      vi.spyOn(session, "send").mockImplementation((method, params) => {
        if (method === "Page.navigate") return new Promise(() => {});
        return send(method, params);
      });
      const page = createPage(session);
      const frameListeners = session.handlers.get("Page.frameNavigated")?.size ?? 0;
      const responseListeners = session.handlers.get("Network.responseReceived")?.size ?? 0;
      const pending = page.goto("https://example.test/slow-headers", { timeout: 100 });
      const outcome = pending.catch((error: unknown) => error);

      await vi.advanceTimersByTimeAsync(100);

      const error = await Promise.race([outcome, Promise.resolve("pending")]);
      expect(error).toMatchObject({ message: "Navigation command timed out after 100ms" });
      expect(session.handlers.get("Page.frameNavigated")?.size ?? 0).toBe(frameListeners);
      expect(session.handlers.get("Network.responseReceived")?.size ?? 0).toBe(responseListeners);
    } finally {
      vi.useRealTimers();
    }
  });

  it("deducts a delayed command response from the lifecycle budget", async () => {
    vi.useFakeTimers();
    try {
      const session = new NavigationCDPSession();
      session.readyState = "loading";
      session.navigationOptions = { emitLifecycle: false };
      const send = session.send.bind(session);
      vi.spyOn(session, "send").mockImplementation(async (method, params) => {
        if (method === "Page.navigate") {
          await new Promise((resolve) => setTimeout(resolve, 75));
        }
        return send(method, params);
      });
      const page = createPage(session);
      const pending = page.goto("https://example.test/slow-body", { timeout: 100 });
      const outcome = pending.catch((error: unknown) => error);

      await vi.advanceTimersByTimeAsync(100);

      const error = await Promise.race([outcome, Promise.resolve("pending")]);
      expect(error).toMatchObject({ message: "domcontentloaded timed out after 100ms" });
      expect(session.handlers.get("Page.lifecycleEvent")?.size).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("observes lifecycle events while a ready-state probe is stalled", async () => {
    vi.useFakeTimers();
    try {
      const session = new NavigationCDPSession();
      session.navigationOptions = { emitLifecycle: false };
      const send = session.send.bind(session);
      vi.spyOn(session, "send").mockImplementation((method, params) => {
        if (method === "Runtime.evaluate") return new Promise(() => {});
        return send(method, params);
      });
      const page = createPage(session);
      const pending = page.goto("https://example.test", { timeout: 100 });
      const outcome = pending.catch((error: unknown) => error);

      await vi.advanceTimersByTimeAsync(1);
      session.emit("Page.lifecycleEvent", {
        frameId: MAIN_FRAME_ID,
        name: "DOMContentLoaded",
      });
      await vi.advanceTimersByTimeAsync(1);

      const response = await Promise.race([outcome, Promise.resolve("pending")]);
      expect(response).toMatchObject({ status: expect.any(Function) });
      expect(session.handlers.get("Page.lifecycleEvent")?.size).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not let a superseded command's late reply overwrite the current URL", async () => {
    const session = new NavigationCDPSession();
    const send = session.send.bind(session);
    let release!: (response: Protocol.Page.NavigateResponse) => void;
    const oldReply = new Promise<Protocol.Page.NavigateResponse>((resolve) => {
      release = resolve;
    });
    const oldUrl = "https://example.test/old";
    const newUrl = "https://example.test/new";
    vi.spyOn(session, "send").mockImplementation((method, params) => {
      if (method === "Page.navigate" && (params as { url?: string })?.url === oldUrl) {
        return oldReply;
      }
      return send(method, params);
    });
    const page = createPage(session);
    const oldNavigation = page.goto(oldUrl);
    const superseded = expect(oldNavigation).rejects.toThrow(
      "Navigation was superseded by a new request",
    );

    await expect(page.goto(newUrl)).resolves.toMatchObject({ status: expect.any(Function) });
    release({ frameId: MAIN_FRAME_ID, loaderId: "stale" });

    await superseded;
    expect(page.url()).toBe(newUrl);
  });
});
