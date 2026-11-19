export type Arguments = Record<string, unknown>;

export type Descriptor = {
  name: string;
  title: string;
  description: string;
  schema: unknown;
  annotations: Record<string, boolean>;
  kind: "Form" | "Script";
};

export type Tool = Descriptor & {
  key: string;
  frameId: number;
  documentId: string;
  url: string;
};

export function needsReview(tool: Tool) {
  return Boolean(tool.annotations.consequentialHint || !tool.annotations.readOnlyHint);
}

export type Page = {
  tabId: number;
  windowId: number;
  documentId: string;
  url: string;
  title: string;
  tools: Tool[];
  frames: number;
  skippedFrames: number;
  status: "ready" | "unavailable" | "disconnected";
};

export type PageCheck = { selector: string; expected: string };

export type CheckResult = PageCheck &
  (
    | { status: "passed" | "failed"; observed: string | null }
    | { status: "skipped"; reason: string }
  );

export type Receipt = {
  id: string;
  tool: Tool;
  pageUrl: string;
  check?: CheckResult;
  input: Arguments;
  time: number;
  duration: number;
  outcome: "success" | "error" | "navigated";
  output: unknown;
};

type NativeTool = {
  name: string;
  title?: string;
  description?: string;
  inputSchema?: unknown;
  annotations?: Record<string, boolean>;
  window: Window;
};

interface ModelContext {
  getTools(): Promise<NativeTool[]>;
  executeTool(
    tool: NativeTool,
    args: Arguments,
    options: { signal: AbortSignal },
  ): Promise<unknown>;
}

type Probe =
  | { mode: "list" }
  | { mode: "run"; expected: Descriptor; input: Arguments; url: string };

type Probed =
  | { supported: boolean; title: string; url: string; tools: Descriptor[] }
  | { output: unknown }
  | { error: string };

// The browser serializes this function into the isolated world. Keep its dependencies local.
async function probe(request: Probe): Promise<Probed> {
  try {
    const url = location.href;
    const model = (document as Document & { modelContext?: ModelContext }).modelContext;
    if (typeof model?.getTools !== "function" || typeof model.executeTool !== "function") {
      return { supported: false, title: document.title, url, tools: [] };
    }
    const forms = new Set(
      [...document.querySelectorAll("form[toolname]")].map((element) =>
        element.getAttribute("toolname"),
      ),
    );
    const describe = (tool: NativeTool): Descriptor => ({
      name: tool.name,
      title: tool.title || "",
      description: tool.description || "",
      schema: tool.inputSchema ?? {},
      annotations: tool.annotations ?? {},
      kind: forms.has(tool.name) ? "Form" : "Script",
    });
    const tools = (await model.getTools()).filter((tool) => tool.window === window);
    if (request.mode === "list") {
      return { supported: true, title: document.title, url, tools: tools.map(describe) };
    }
    // The browser can reorder object keys when it transports values between worlds.
    const canonical = (value: Descriptor) =>
      JSON.stringify(value, (_key, item: unknown) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) return item;
        return Object.fromEntries(
          Object.entries(item).sort(([left], [right]) => left.localeCompare(right)),
        );
      });
    const fingerprint = canonical(request.expected);
    const tool = tools.find(
      (item) => item.name === request.expected.name && canonical(describe(item)) === fingerprint,
    );
    if (!tool || url !== request.url || location.href !== url) {
      return {
        error: "The tool or page changed. Refresh and review the current tool before running.",
      };
    }
    const output = await model.executeTool(tool, request.input, {
      signal: AbortSignal.timeout(25_000),
    });
    return { output: output ?? null };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

async function inspectDocument(tabId: number, documentId: string, request: Probe) {
  const [injection] = await chrome.scripting.executeScript<[Probe], Promise<Probed>>({
    target: { tabId, documentIds: [documentId] },
    world: "ISOLATED",
    func: probe,
    args: [request],
  });
  return injection?.result as unknown as Probed | undefined;
}

async function activeTab(windowId: number) {
  const [tab] = await chrome.tabs.query({ active: true, windowId });
  return tab;
}

export async function discover(windowId: number): Promise<Page | null> {
  const tab = await activeTab(windowId);
  if (tab?.id === undefined) return null;
  const tabId = tab.id;
  const page: Page = {
    tabId,
    windowId,
    documentId: "",
    url: tab.url || "",
    title: tab.title || "Current tab",
    tools: [],
    frames: 0,
    skippedFrames: 0,
    status: "disconnected",
  };
  const frames = await chrome.webNavigation.getAllFrames({ tabId });
  const root = frames?.find((frame) => frame.frameId === 0);
  if (!root) return page;
  page.documentId = root.documentId;
  page.url = root.url;
  if (!/^https?:\/\//.test(root.url)) return page;
  const top = await inspectDocument(tabId, root.documentId, { mode: "list" }).catch(
    (error: unknown) => {
      const message = String(error);
      if (/cannot access|no document with id|no frame with id/i.test(message)) return;
      throw error;
    },
  );
  if (!top) return page;
  if ("error" in top) throw new Error(top.error);
  if (!("supported" in top)) return page;

  page.status = top.supported ? "ready" : "unavailable";
  page.url = top.url;
  page.title = top.title || page.title;
  const embedded = (frames ?? []).filter((frame) => frame.frameId !== 0);
  const origin = new URL(top.url).origin;
  const eligible = embedded.filter((frame) => {
    const url = URL.parse(frame.url);
    return url?.origin === origin || frame.url === "about:blank" || frame.url === "about:srcdoc";
  });

  function addTools(items: Descriptor[], frameId: number, documentId: string, url: string) {
    page.frames += 1;
    for (const tool of items) {
      page.tools.push({
        ...tool,
        frameId,
        documentId,
        url,
        key: JSON.stringify([documentId, tool.name]),
      });
    }
  }

  addTools(top.tools, 0, root.documentId, top.url);
  const inspected = await Promise.allSettled(
    eligible.map((frame) => inspectDocument(tabId, frame.documentId, { mode: "list" })),
  );
  page.skippedFrames = embedded.length - eligible.length;
  for (const [index, result] of inspected.entries()) {
    const frame = eligible[index];
    if (frame && result.status === "fulfilled" && result.value && "supported" in result.value) {
      addTools(result.value.tools, frame.frameId, frame.documentId, result.value.url);
      if (result.value.supported) page.status = "ready";
    } else {
      page.skippedFrames += 1;
    }
  }
  page.tools.sort((a, b) => a.frameId - b.frameId || a.name.localeCompare(b.name));
  return page;
}

function decodeOutput(output: unknown) {
  if (typeof output !== "string" || !/^\s*[[{]/.test(output)) return output;
  try {
    return JSON.parse(output) as unknown;
  } catch {
    return output;
  }
}

// This function runs in the inspected document and reads only the selected element.
async function observeText(url: string, check: PageCheck) {
  const end = performance.now() + 1_500;
  while (location.href === url) {
    const element = document.querySelector(check.selector);
    const visible = element?.checkVisibility({ opacityProperty: true, visibilityProperty: true });
    const text = visible
      ? element instanceof HTMLElement
        ? element.innerText
        : element?.textContent
      : undefined;
    const observed = text?.trim() ?? null;
    if (observed === check.expected || performance.now() >= end) return { observed };
    await new Promise((resolve) => setTimeout(resolve, 75));
  }
}

async function checkPage(page: Page, check: PageCheck): Promise<CheckResult> {
  try {
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId: page.tabId, documentIds: [page.documentId] },
      world: "ISOLATED",
      func: observeText,
      args: [page.url, check],
    });
    const result = injection?.result as Awaited<ReturnType<typeof observeText>>;
    if (result) {
      return {
        ...check,
        observed: result.observed,
        status: result.observed === check.expected ? "passed" : "failed",
      };
    }
  } catch {
    // The tool may have navigated away or closed its document.
  }
  return { ...check, status: "skipped", reason: "The original page could not be read." };
}

export async function runTool(
  page: Page,
  tool: Tool,
  input: Arguments,
  check?: PageCheck,
  signal?: AbortSignal,
): Promise<Receipt> {
  const time = Date.now();
  let outcome: Receipt["outcome"] = "error";
  let output: unknown;

  try {
    const tab = await activeTab(page.windowId);
    const current = await chrome.webNavigation.getFrame({ tabId: page.tabId, frameId: 0 });
    if (
      tab?.id !== page.tabId ||
      current?.documentId !== page.documentId ||
      current?.url !== page.url
    ) {
      throw new Error("The active tab or page changed. Refresh before running.");
    }
    signal?.throwIfAborted();
    const { name, title, description, schema, annotations, kind } = tool;
    const result = await inspectDocument(page.tabId, tool.documentId, {
      mode: "run",
      expected: { name, title, description, schema, annotations, kind },
      url: tool.url,
      input,
    });
    if (!result || !("output" in result)) {
      throw new Error(
        result && "error" in result ? result.error : "The tool is no longer available.",
      );
    }
    output = decodeOutput(result.output);
    outcome =
      output === null
        ? "navigated"
        : output && typeof output === "object" && "isError" in output && output.isError === true
          ? "error"
          : "success";
  } catch (error) {
    output = { message: error instanceof Error ? error.message : String(error) };
  }

  const duration = Date.now() - time;
  const verification: CheckResult | undefined = check
    ? outcome === "success"
      ? await checkPage(page, check)
      : { ...check, status: "skipped", reason: "The tool did not return a successful response." }
    : undefined;
  return {
    id: crypto.randomUUID(),
    time,
    duration,
    pageUrl: page.url,
    check: verification,
    tool,
    input,
    outcome,
    output,
  };
}
