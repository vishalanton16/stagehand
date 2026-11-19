import { useEffect, useRef, useState } from "react";
import { ArrowRight, Code2, Compass, PanelsTopLeft, Plug, RefreshCw, Search } from "lucide-react";
import {
  discover,
  runTool,
  type Arguments,
  type Page,
  type PageCheck,
  type Receipt,
  type Tool,
} from "../../lib/webmcp";
import { pretty } from "../../lib/schema";
import { AgentView } from "./agent-view";
import { Copy, Editor } from "./editor";
import { ReplayView, Result } from "./results";

const nav = [
  { id: "inspect", label: "Inspect" },
  { id: "replay", label: "Replay" },
  { id: "agent", label: "Agent" },
] as const;
type View = (typeof nav)[number]["id"];

function siteName(url: string) {
  const address = URL.parse(url);
  return address?.host || address?.protocol || "No site selected";
}

function sameDefinition(first: Tool, second: Tool, sameDocument = true) {
  return (
    (!sameDocument || first.key === second.key) &&
    first.name === second.name &&
    (first.frameId === 0) === (second.frameId === 0) &&
    first.url === second.url &&
    first.title === second.title &&
    first.description === second.description &&
    first.kind === second.kind &&
    pretty(first.schema) === pretty(second.schema) &&
    pretty(first.annotations) === pretty(second.annotations)
  );
}

export function App() {
  const [view, setView] = useState<View>("inspect");
  const [page, setPage] = useState<Page | null>(null);
  const [pending, setPending] = useState(true);
  const [issue, setIssue] = useState("");
  const refreshNow = useRef<() => void>(() => {});
  const [discoveryError, setDiscoveryError] = useState("");
  const [selected, setSelected] = useState("");
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState<{ id: number; input: Arguments; check?: PageCheck }>();
  const [receipts, setReceipts] = useState<Record<number, Receipt[]>>({});
  const [running, setRunning] = useState<string>();
  const runLock = useRef(false);
  const nextDraftId = useRef(0);
  const previousTab = useRef<number | undefined>(undefined);

  useEffect(() => {
    let closed = false;
    let inProgress = false;
    let queued = false;
    let revision = 0;
    let windowId: number | undefined;

    async function refresh() {
      if (closed) return;
      if (inProgress) {
        queued = true;
        return;
      }
      inProgress = true;
      const started = revision;
      try {
        windowId ??= (await chrome.windows.getCurrent()).id;
        if (windowId === undefined) throw new Error("Could not find the current browser window.");
        const found = await discover(windowId);
        if (closed || started !== revision) return;
        if (found?.tabId !== previousTab.current) {
          previousTab.current = found?.tabId;
          setQuery("");
          setSelected("");
          setDraft(undefined);
        }
        setPage(found);
        setDiscoveryError("");
      } catch (error) {
        if (!closed && started === revision) {
          setPage(null);
          setDiscoveryError((error as Error).message);
        }
      } finally {
        inProgress = false;
        if (!closed && started === revision) setPending(false);
        if (queued) {
          queued = false;
          void refresh();
        }
      }
    }

    function invalidate() {
      revision += 1;
      setPage(null);
      setPending(true);
      void refresh();
    }

    function activate(event: { windowId: number }) {
      if (event.windowId === windowId) invalidate();
    }

    function onNavigate(event: { tabId: number; frameId: number }) {
      if (event.tabId !== previousTab.current) return;
      if (event.frameId === 0) invalidate();
      else void refresh();
    }

    refreshNow.current = () => void refresh();
    void refresh();
    const interval = window.setInterval(() => void refresh(), 1800);
    chrome.tabs.onActivated.addListener(activate);
    chrome.webNavigation.onCommitted.addListener(onNavigate);
    chrome.webNavigation.onHistoryStateUpdated.addListener(onNavigate);
    chrome.webNavigation.onReferenceFragmentUpdated.addListener(onNavigate);
    return () => {
      closed = true;
      window.clearInterval(interval);
      chrome.tabs.onActivated.removeListener(activate);
      chrome.webNavigation.onCommitted.removeListener(onNavigate);
      chrome.webNavigation.onHistoryStateUpdated.removeListener(onNavigate);
      chrome.webNavigation.onReferenceFragmentUpdated.removeListener(onNavigate);
    };
  }, []);

  const tools = page?.tools ?? [];
  const filter = query.trim().toLowerCase();
  const visible = tools.filter(
    (tool) =>
      !filter ||
      `${tool.name} ${tool.title} ${tool.description} ${tool.url} ${tool.kind}`
        .toLowerCase()
        .includes(filter),
  );
  const groups = new Map<number, Tool[]>();
  for (const item of visible) {
    const group = groups.get(item.frameId);
    if (group) group.push(item);
    else groups.set(item.frameId, [item]);
  }
  const tool = visible.find((item) => item.key === selected) ?? visible[0];
  const history = page ? (receipts[page.tabId] ?? []) : [];
  const last = tool && history.find((entry) => sameDefinition(entry.tool, tool));

  function review(target: Tool, input: Arguments, check?: PageCheck) {
    if (!tools.some((item) => sameDefinition(item, target))) {
      setIssue("Tool changed. Select it again in Inspect.");
      return;
    }
    setIssue("");
    setQuery("");
    setSelected(target.key);
    setDraft({ id: ++nextDraftId.current, input, check });
    setView("inspect");
  }

  function replay(receipt: Receipt) {
    if (page?.url === receipt.pageUrl) {
      const exact = tools.find((item) => sameDefinition(item, receipt.tool));
      const candidates = tools.filter((item) => sameDefinition(item, receipt.tool, false));
      const target = exact ?? (candidates.length === 1 ? candidates[0] : undefined);
      if (target) {
        review(target, receipt.input, receipt.check);
        return;
      }
    }
    setIssue("Return to the original page to rerun this call.");
  }

  async function execute(
    page: Page,
    tool: Tool,
    input: Arguments,
    check?: PageCheck,
    signal?: AbortSignal,
  ) {
    if (runLock.current) throw new Error("Wait for the current tool call to finish.");
    runLock.current = true;
    setRunning(tool.key);
    try {
      const entry = await runTool(page, tool, input, check, signal);
      setReceipts((old) => ({
        ...old,
        [page.tabId]: [entry, ...(old[page.tabId] ?? [])].slice(0, 40),
      }));
      return entry;
    } finally {
      runLock.current = false;
      setRunning(undefined);
      refreshNow.current();
    }
  }

  async function run(input: Arguments, check?: PageCheck) {
    if (!page || !tool || runLock.current) return;
    await execute(page, tool, input, check);
  }

  async function openFlags() {
    const [current] = await chrome.tabs.query({ active: true, currentWindow: true });
    await chrome.tabs.create({
      windowId: current?.windowId,
      url: "chrome://flags/#enable-webmcp-testing",
    });
  }

  const connected = page?.status === "ready";
  const isWeb = page?.url && /^https?:\/\//.test(page.url);
  const scope = page ? `${page.tabId}:${page.documentId}` : "no-page";

  return (
    <div className="shell">
      <header className="site" aria-label="Inspected tab">
        <div className="site-identity">
          <strong title={page?.title}>{page?.title || "No page connected"}</strong>
          {page?.url && <small title={page.url}>{siteName(page.url)}</small>}
        </div>
        <div className="site-actions">
          <span className={`connection ${connected ? "online" : ""}`} role="status">
            <i aria-hidden="true" />
            {pending
              ? "Checking"
              : connected
                ? `${tools.length} ${tools.length === 1 ? "tool" : "tools"}`
                : "Offline"}
          </span>
          <button
            className="icon-button refresh"
            type="button"
            title="Refresh tools"
            aria-label="Refresh tools"
            onClick={() => {
              setPending(true);
              setIssue("");
              refreshNow.current();
            }}
          >
            <RefreshCw size={15} className={pending ? "spinning" : undefined} />
          </button>
        </div>
      </header>

      <nav className="navigation" aria-label="WebMCP views">
        {nav.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            aria-current={view === id ? "page" : undefined}
            onClick={() => {
              setIssue("");
              setView(id);
            }}
          >
            {label}
          </button>
        ))}
      </nav>

      <main>
        {(issue || discoveryError) && (
          <p className="error" role="alert">
            {issue || discoveryError}
          </p>
        )}
        {view === "replay" && <ReplayView key={page?.tabId} receipts={history} review={replay} />}
        <div className="agent-pane" hidden={view !== "agent"}>
          <AgentView
            key={scope}
            active={view === "agent"}
            review={review}
            page={page}
            call={(page, tool, input, signal) => execute(page, tool, input, undefined, signal)}
            toolRunning={Boolean(running)}
          />
        </div>
        <section className="stack" hidden={view !== "inspect"}>
          {tools.length > 0 ? (
            <>
              <div className="box catalog">
                <div className="search">
                  <Search size={16} />
                  <input
                    type="search"
                    aria-label="Filter tools"
                    placeholder="Filter tools…"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                  />
                </div>
                <div className="tool-list" aria-label="Discovered tools">
                  {[...groups].map(([frame, group]) => (
                    <section key={frame} aria-label={frame === 0 ? "Top frame" : `Frame ${frame}`}>
                      <div className="frame-label">
                        <span>{frame === 0 ? "Top frame" : `Frame ${frame}`}</span>
                      </div>
                      <ul>
                        {group.map((item) => (
                          <li key={item.key}>
                            <button
                              type="button"
                              aria-pressed={item.key === tool?.key}
                              onClick={() => {
                                setSelected(item.key);
                                setDraft(undefined);
                              }}
                            >
                              {item.kind === "Form" ? (
                                <PanelsTopLeft size={15} />
                              ) : (
                                <Code2 size={15} />
                              )}
                              <span>
                                <strong>{item.name}</strong>
                              </span>
                              {item.annotations.consequentialHint ? (
                                <span className="badge caution">Consequential</span>
                              ) : item.annotations.readOnlyHint ? (
                                <span className="badge success">Read-only</span>
                              ) : (
                                <span className="tool-kind">{item.kind}</span>
                              )}
                            </button>
                          </li>
                        ))}
                      </ul>
                    </section>
                  ))}
                  {!visible.length && <p className="no-results">No tools match “{query}”.</p>}
                </div>
              </div>

              {Boolean(page?.skippedFrames) && (
                <details className="subframe">
                  <summary>
                    {page?.skippedFrames} {page?.skippedFrames === 1 ? "frame" : "frames"}{" "}
                    unavailable
                  </summary>
                  <p>Your browser blocked access to these frames.</p>
                </details>
              )}

              {tool && (
                <>
                  <article className="tool-record">
                    <div className="tool-heading">
                      <h2>{tool.title || tool.name}</h2>
                      <Copy value={pretty(tool)} label="Copy tool definition" />
                    </div>
                    {tool.title && <code>{tool.name}</code>}
                    {tool.description && <p>{tool.description}</p>}
                    <div className="tool-tags">
                      {tool.annotations.readOnlyHint && <span className="badge">Read-only</span>}
                      {tool.annotations.consequentialHint && (
                        <span className="badge caution">Consequential</span>
                      )}
                      {tool.annotations.debugging && <span className="badge">Debugging</span>}
                    </div>
                  </article>
                  <Editor
                    key={`${tool.key}:${pretty(tool.schema)}:${pretty(tool.annotations)}:${draft?.id ?? 0}`}
                    tool={tool}
                    seed={tool.key === selected ? draft?.input : undefined}
                    busy={Boolean(running)}
                    initialCheck={tool.key === selected ? draft?.check : undefined}
                    run={(input, check) => void run(input, check)}
                  />
                  {last && <Result receipt={last} />}
                </>
              )}
            </>
          ) : (
            <div className="empty">
              {connected ? <Compass size={28} /> : <Plug size={28} />}
              <h2>
                {pending
                  ? "Looking for tools…"
                  : connected
                    ? "No tools on this page"
                    : page?.status === "unavailable"
                      ? "WebMCP is unavailable"
                      : "Connect to a page"}
              </h2>
              {!pending && !connected && (
                <p>
                  {page?.status === "unavailable"
                    ? "Enable WebMCP for testing and restart your browser."
                    : isWeb
                      ? "Click the extension icon on this tab."
                      : "Open a website, then click the extension icon."}
                </p>
              )}
              {page?.status === "unavailable" && (
                <button className="secondary" onClick={() => void openFlags()}>
                  Open WebMCP flag <ArrowRight size={14} />
                </button>
              )}
              {connected && (
                <a
                  className="secondary"
                  href="https://developer.chrome.com/docs/ai/webmcp"
                  target="_blank"
                  rel="noreferrer"
                >
                  WebMCP docs <ArrowRight size={14} />
                </a>
              )}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
