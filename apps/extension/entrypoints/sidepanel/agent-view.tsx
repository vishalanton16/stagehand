import { useEffect, useRef, useState } from "react";
import { ArrowUp, ArrowUpRight, ChevronDown, ImagePlus, ScanLine, X } from "lucide-react";
import {
  loadConnections,
  providers,
  type Connections,
  type Provider,
} from "../../lib/agent/connections";
import { imageTypes, type Attachment } from "../../lib/agent/input";
import { Result } from "./results";
import { MarkdownText } from "./markdown-text";
import { ModelSettings } from "./model-settings";
import { useAgentRun } from "./use-agent-run";
import { pretty } from "../../lib/schema";
import type { Arguments, Page, Receipt, Tool } from "../../lib/webmcp";

export function AgentView({
  active,
  page,
  review,
  call,
  toolRunning,
}: {
  active: boolean;
  page: Page | null;
  review: (tool: Tool, input: Arguments) => void;
  call: (page: Page, tool: Tool, input: Arguments, signal: AbortSignal) => Promise<Receipt>;
  toolRunning: boolean;
}) {
  const [saved, setSaved] = useState<Connections>({});
  const [loading, setLoading] = useState(true);
  const [provider, setProvider] = useState<Provider>("gateway");
  const [settings, setSettings] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [attachment, setAttachment] = useState<Attachment | null>(null);
  const [issue, setIssue] = useState("");
  const approvalHeading = useRef<HTMLHeadingElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const connection = saved[provider];
  const { send, stop, reset, turns, approval, busy } = useAgentRun(call);
  useEffect(() => {
    if (!active) stop();
  }, [active, stop]);
  const transcript = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  useEffect(() => {
    const log = transcript.current;
    if (log && follow.current) log.scrollTop = log.scrollHeight;
  }, [turns]);
  const composer = useRef<HTMLTextAreaElement>(null);
  function submit(message = prompt) {
    if (!connection || busy || !message.trim()) return;
    follow.current = true;
    void send(connection, message.trim(), attachment, page);
    composer.current?.focus();
    setPrompt("");
    setAttachment(null);
    setIssue("");
  }
  useEffect(() => {
    if (active && !settings && connection && !loading) composer.current?.focus();
  }, [active, settings, connection, loading]);

  useEffect(() => {
    let mounted = true;
    void loadConnections()
      .then(({ provider, saved }) => {
        if (!mounted) return;
        setSaved(saved);
        setProvider(provider);
      })
      .catch(() => {
        if (mounted) setIssue("Reopen the panel to load your model settings.");
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (active && approval) approvalHeading.current?.focus();
  }, [active, approval]);

  function addImage(file: File | undefined) {
    if (!file) return;
    if (!imageTypes.includes(file.type) || file.size > 5 * 1024 * 1024) {
      setIssue("Choose a PNG, JPEG, WebP, or GIF under 5 MB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") setAttachment({ name: file.name, url: reader.result });
    };
    reader.onerror = () => setIssue("Choose the image again or try another file.");
    reader.readAsDataURL(file);
    setIssue("");
  }

  async function capture() {
    if (!page || page.status !== "ready") return;
    try {
      const [tab] = await chrome.tabs.query({ active: true, windowId: page.windowId });
      if (tab?.id !== page.tabId) throw new Error("Switch back to the inspected tab first.");
      const url = await chrome.tabs.captureVisibleTab(page.windowId, {
        format: "jpeg",
        quality: 80,
      });
      const [current] = await chrome.tabs.query({ active: true, windowId: page.windowId });
      if (current?.id !== page.tabId || current.url !== page.url) {
        throw new Error("The page changed during capture.");
      }
      setAttachment({ name: "Tab screenshot", url });
      setIssue("");
    } catch {
      setIssue("Click the extension icon on this tab to capture it.");
    }
  }

  const latest = turns.at(-1);
  const firstTool = page?.tools[0];
  if (loading)
    return (
      <p role="status" className="muted">
        Loading model settings…
      </p>
    );

  return (
    <section className={connection && !settings ? "agent-chat" : "stack"}>
      {!connection || settings ? (
        <ModelSettings
          saved={saved}
          initialProvider={connection?.provider ?? provider}
          onSaved={(next) => {
            setSaved((current) => ({ ...current, [next.provider]: next }));
            setProvider(next.provider);
            setSettings(false);
            reset();
            setIssue("");
          }}
          onRemoved={(removed) => {
            setSaved((current) => ({ ...current, [removed]: undefined }));
            if (provider === removed) reset();
          }}
          onCancel={connection ? () => setSettings(false) : undefined}
        />
      ) : (
        <>
          <span className="sr-only" role="status">
            {active && latest?.status === "Finished" ? "Response complete." : ""}
          </span>
          <div
            className="transcript stack"
            ref={transcript}
            aria-label="Conversation"
            role="region"
            onScroll={(event) => {
              const log = event.currentTarget;
              follow.current = log.scrollHeight - log.scrollTop - log.clientHeight < 48;
            }}
          >
            {turns.length === 0 && (
              <div className="chat-empty">
                <h2>Ask about this tab</h2>
                {firstTool ? (
                  <div className="chat-starters">
                    {["What can I do on this page?", `Explain ${firstTool.name}`].map(
                      (question) => (
                        <button
                          type="button"
                          className="secondary"
                          disabled={Boolean(prompt || attachment)}
                          key={question}
                          onClick={() => submit(question)}
                        >
                          {question}
                          <ArrowUpRight size={14} aria-hidden="true" />
                        </button>
                      ),
                    )}
                  </div>
                ) : (
                  <p>Ask a question or attach an image to get started.</p>
                )}
                <small>
                  {providers[connection.provider].name} receives recent messages, tool definitions
                  and any image you send.
                </small>
              </div>
            )}
            {turns.map((turn) => (
              <article className="chat-turn stack" key={turn.id}>
                <div className="user-message">
                  <strong className="sr-only">You</strong>
                  <p>{turn.prompt}</p>
                  {turn.image && <small>{turn.image}</small>}
                </div>
                <div className="agent-message stack">
                  <strong>Agent</strong>
                  {turn.parts.map((part, index) =>
                    part.type === "text" ? (
                      <MarkdownText
                        key={index}
                        text={part.text}
                        streaming={turn.status === "Responding…" && index === turn.parts.length - 1}
                      />
                    ) : (
                      <section
                        key={part.id}
                        className="chat-tool stack"
                        data-pending={approval?.id === part.id}
                      >
                        <h3
                          ref={approval?.id === part.id ? approvalHeading : undefined}
                          tabIndex={-1}
                        >
                          {approval?.id === part.id ? (
                            <>
                              Run <code>{part.tool.name}</code>?
                            </>
                          ) : (
                            <code>{part.tool.name}</code>
                          )}
                        </h3>
                        <small>
                          {part.tool.url} ·{" "}
                          {part.tool.frameId ? `Frame ${part.tool.frameId}` : "Top frame"}
                        </small>
                        {Object.keys(part.input).length || approval?.id === part.id ? (
                          <details
                            open={approval?.id === part.id && Object.keys(part.input).length > 0}
                          >
                            <summary>
                              {Object.keys(part.input).length ? "Arguments" : "No arguments"}
                            </summary>
                            <pre>{pretty(part.input)}</pre>
                            {approval?.id === part.id && (
                              <button
                                className="subtle"
                                onClick={() => review(part.tool, part.input)}
                              >
                                Edit in Inspect
                              </button>
                            )}
                          </details>
                        ) : null}
                        {approval?.id === part.id ? (
                          <>
                            {connection.provider === "gateway" && (
                              <p>Gateway will receive the result.</p>
                            )}
                            <form
                              className="stack"
                              onSubmit={(event) => {
                                event.preventDefault();
                                approval.resolve(
                                  new FormData(event.currentTarget).has("remember")
                                    ? "request"
                                    : "once",
                                );
                                composer.current?.focus();
                              }}
                            >
                              {approval.canRemember && (
                                <label>
                                  <input type="checkbox" name="remember" /> Allow this tool for the
                                  rest of this request
                                </label>
                              )}
                              <div className="inline-actions">
                                <button
                                  type="button"
                                  className="secondary"
                                  onClick={() => {
                                    approval.resolve("skip");
                                    composer.current?.focus();
                                  }}
                                >
                                  Skip
                                </button>
                                <button type="submit" className="primary" disabled={toolRunning}>
                                  Run tool
                                </button>
                              </div>
                            </form>
                          </>
                        ) : (
                          <>
                            {part.receipt ? (
                              <details open={connection.provider !== "gateway"}>
                                <summary>Tool output · {part.receipt.outcome}</summary>
                                <Result receipt={part.receipt} />
                              </details>
                            ) : (
                              <small>{part.status}</small>
                            )}
                          </>
                        )}
                      </section>
                    ),
                  )}
                  {turn.status !== "Finished" && !(approval && turn.status === "Responding…") && (
                    <small role="status">{turn.status}</small>
                  )}
                  {turn.error && (
                    <p className="error" role="alert">
                      {turn.error}
                    </p>
                  )}
                </div>
              </article>
            ))}
          </div>
          <form
            className="chat-composer stack"
            onSubmit={(event) => {
              event.preventDefault();
              submit();
            }}
          >
            {attachment && (
              <div className="attachment">
                <img alt="Image attached to prompt" src={attachment.url} />
                <span>{attachment.name}</span>
                <button
                  type="button"
                  className="icon-button"
                  aria-label="Remove image"
                  disabled={busy}
                  onClick={() => setAttachment(null)}
                >
                  <X size={15} />
                </button>
              </div>
            )}
            <textarea
              ref={composer}
              aria-label="Message"
              rows={1}
              value={prompt}
              placeholder="Message the Agent…"
              onChange={(event) => setPrompt(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  submit();
                }
              }}
            />
            <div className="inline-actions">
              <input
                ref={fileInput}
                type="file"
                hidden
                accept={imageTypes.join(",")}
                onChange={(event) => {
                  addImage(event.target.files?.[0]);
                  event.target.value = "";
                }}
              />
              <button
                type="button"
                className="icon-button"
                title="Attach image"
                aria-label="Attach image"
                disabled={busy}
                onClick={() => fileInput.current?.click()}
              >
                <ImagePlus size={16} />
              </button>
              <button
                type="button"
                className="icon-button"
                title="Capture tab"
                aria-label="Capture tab"
                disabled={busy || page?.status !== "ready"}
                onClick={() => void capture()}
              >
                <ScanLine size={16} />
              </button>
              <button
                type="button"
                className="subtle chat-provider"
                disabled={busy}
                aria-label={`Settings for ${providers[connection.provider].name}`}
                onClick={() => {
                  setSettings(true);
                  setIssue("");
                }}
              >
                {connection.provider === "gateway"
                  ? "Gateway"
                  : providers[connection.provider].name}
                <ChevronDown size={14} aria-hidden="true" />
              </button>
              {busy ? (
                <button type="button" className="secondary chat-send" onClick={stop}>
                  Stop
                </button>
              ) : (
                <button
                  type="submit"
                  className="primary chat-send"
                  aria-label="Send"
                  title="Send (Enter)"
                  disabled={!prompt.trim()}
                >
                  <ArrowUp size={16} />
                </button>
              )}
            </div>
          </form>
        </>
      )}
      {issue && (
        <p className="error" role="alert">
          {issue}
        </p>
      )}
    </section>
  );
}
