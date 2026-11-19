import { SelectField } from "./select-field";
import { useState } from "react";
import { ArrowRight } from "lucide-react";
import { objectValue, pretty } from "../../lib/schema";
import type { CheckResult, Receipt } from "../../lib/webmcp";
import { Copy } from "./editor";
import { MarkdownText } from "./markdown-text";

const media = {
  image: /^(image\/(png|jpeg|gif|webp|avif))$/,
  audio: /^(audio\/(mpeg|wav|ogg|webm|mp4|aac|flac))$/,
};

function RawResult({ value }: { value: string }) {
  return (
    <details className="schema">
      <summary>Raw result</summary>
      <pre>{value}</pre>
    </details>
  );
}

function Content({ value }: { value: unknown }) {
  if (typeof value === "string") {
    return (
      <>
        <MarkdownText text={value} />
        <RawResult value={value} />
      </>
    );
  }
  const blocks = objectValue(value) && Array.isArray(value.content) ? value.content : [];
  if (!blocks.length) return <pre>{pretty(value)}</pre>;
  return (
    <>
      {blocks.map((block: unknown, index: number) => {
        if (objectValue(block)) {
          if (block.type === "text" && typeof block.text === "string")
            return <MarkdownText key={index} text={block.text} />;
          const kind = block.type;
          if (
            (kind === "image" || kind === "audio") &&
            typeof block.mimeType === "string" &&
            media[kind].test(block.mimeType) &&
            typeof block.data === "string" &&
            /^[A-Za-z0-9+/=]+$/.test(block.data)
          ) {
            const src = `data:${block.mimeType};base64,${block.data}`;
            return kind === "image" ? (
              <img className="result-image" key={index} src={src} alt="Tool output" />
            ) : (
              <audio key={index} controls src={src} />
            );
          }
        }
        return <pre key={index}>{pretty(block)}</pre>;
      })}
      <RawResult value={pretty(value)} />
    </>
  );
}

const labels = { error: "Error", success: "Returned", navigated: "Empty result" };

function Verification({ check }: { check: CheckResult }) {
  return (
    <section className={`verification ${check.status}`} aria-label="Page check">
      <div className="detail-row">
        <strong>Page check {check.status}</strong>
        <code>{check.selector}</code>
      </div>
      {check.status === "skipped" ? (
        <p>{check.reason}</p>
      ) : (
        <dl>
          <dt>Expected</dt>
          <dd>
            <code>{JSON.stringify(check.expected)}</code>
          </dd>
          <dt>Observed</dt>
          <dd>
            <code>
              {check.observed === null ? "No visible match" : JSON.stringify(check.observed)}
            </code>
          </dd>
        </dl>
      )}
    </section>
  );
}

export function Result({ receipt }: { receipt: Receipt }) {
  return (
    <section className="box result" aria-label="Tool result">
      <div className="box-header">
        <span>Response</span>
        <div className="result-meta">
          <span className={`badge ${receipt.outcome}`} role="status">
            {labels[receipt.outcome]}
          </span>
          <span>{receipt.duration} ms</span>
          <Copy value={pretty(receipt.output)} label="Copy result" />
        </div>
      </div>
      <div className="box-body stack">
        {receipt.outcome === "navigated" ? (
          <p>The tool may have navigated.</p>
        ) : (
          <Content value={receipt.output} />
        )}
        {receipt.check && <Verification check={receipt.check} />}
      </div>
    </section>
  );
}

export function ReplayView({
  receipts,
  review,
}: {
  receipts: Receipt[];
  review: (receipt: Receipt) => void;
}) {
  const [selected, setSelected] = useState("");
  const receipt = receipts.find((entry) => entry.id === selected) ?? receipts[0];
  const redacted = receipt && {
    tool: receipt.tool.name,
    startedAt: new Date(receipt.time).toISOString(),
    durationMs: receipt.duration,
    outcome: receipt.outcome,
    ...(receipt.check && { pageCheck: receipt.check.status }),
  };

  return (
    <section className="stack">
      {!receipt ? (
        <div className="empty">
          <h3>No calls yet</h3>
        </div>
      ) : (
        <>
          <label className="field">
            Recent calls
            <SelectField value={receipt.id} onChange={(event) => setSelected(event.target.value)}>
              {receipts.map((entry) => (
                <option value={entry.id} key={entry.id}>
                  {entry.tool.name} · {labels[entry.outcome]}
                  {entry.check?.status === "failed" ? " · Check failed" : ""} ·{" "}
                  {new Date(entry.time).toLocaleTimeString()}
                </option>
              ))}
            </SelectField>
          </label>
          <section className="box">
            <div className="box-header">
              <code>{receipt.tool.name}</code>
              <div className="result-meta">
                <span className={`badge ${receipt.outcome}`}>{labels[receipt.outcome]}</span>
                <span>{receipt.duration} ms</span>
              </div>
            </div>
            <div className="box-body replay-body">
              <section className="replay-section">
                <h3>Arguments</h3>
                <pre>{pretty(receipt.input)}</pre>
              </section>
              <section className="replay-section">
                <h3>Tool response</h3>
                <Content value={receipt.output} />
              </section>
              {receipt.check && <Verification check={receipt.check} />}
            </div>
            <div className="box-footer replay-actions">
              <Copy key={receipt.id} value={pretty(redacted)} label="Copy redacted trace" text />
              <button className="primary" onClick={() => review(receipt)}>
                Edit &amp; rerun <ArrowRight size={14} />
              </button>
            </div>
          </section>
        </>
      )}
    </section>
  );
}
