import { SelectField } from "./select-field";
import { useState, type SyntheticEvent } from "react";
import { ArrowUpRight } from "lucide-react";
import {
  disconnect,
  providerPermission,
  providers,
  saveConnection,
  type Connection,
  type Connections,
  type Provider,
} from "../../lib/agent/connections";

export function ModelSettings({
  initialProvider,
  saved,
  onSaved,
  onRemoved,
  onCancel,
}: {
  initialProvider: Provider;
  saved: Connections;
  onSaved: (connection: Connection) => void;
  onRemoved: (provider: Provider) => void;
  onCancel?: () => void;
}) {
  const [provider, setProvider] = useState(initialProvider);
  const [model, setModel] = useState<string>(saved[provider]?.model ?? providers[provider].model);
  const [key, setKey] = useState("");
  const [confirmRemoval, setConfirmRemoval] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const storedKey = saved[provider]?.key;

  async function connect(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const credential = key.trim() || storedKey;
    if (!credential || saving || confirmRemoval) return;
    setError("");
    setSaving(true);
    try {
      if (!(await chrome.permissions.request(providerPermission(provider)))) {
        throw new Error("Allow the extension to connect to this provider.");
      }
      const connection = {
        provider,
        model: model.trim() || providers[provider].model,
        key: credential,
      };
      await saveConnection(connection);
      onSaved(connection);
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function forgetConnection() {
    setSaving(true);
    setError("");
    try {
      await disconnect(provider);
      onRemoved(provider);
      setKey("");
      setConfirmRemoval(false);
    } catch {
      setError("Reopen Settings and try removing the key again.");
    } finally {
      setSaving(false);
    }
  }
  return (
    <form className="agent-form stack" onSubmit={(event) => void connect(event)}>
      <h2>{onCancel ? "Model settings" : "Connect a provider"}</h2>
      <div className="stack">
        <label className="field">
          Provider
          <SelectField
            value={provider}
            disabled={saving}
            onChange={(event) => {
              const next = event.target.value as Provider;
              setConfirmRemoval(false);
              setProvider(next);
              setModel(saved[next]?.model ?? providers[next].model);
              setKey("");
              setError("");
            }}
          >
            {Object.entries(providers).map(([value, item]) => (
              <option key={value} value={value}>
                {item.name}
              </option>
            ))}
          </SelectField>
        </label>
        <div className="stack credential-field">
          <label className="field">
            API key
            <input
              type="password"
              autoComplete="new-password"
              value={key}
              required={!storedKey}
              disabled={saving}
              placeholder={storedKey ? "Key saved" : "Paste your API key"}
              onChange={(event) => setKey(event.target.value)}
            />
          </label>
          <p className="field-hint">
            Saved in this browser profile.{" "}
            <a href={providers[provider].keysUrl} target="_blank" rel="noreferrer">
              Get an API key <ArrowUpRight size={12} aria-hidden="true" />
            </a>
          </p>
        </div>
        <details className="model-options">
          <summary>
            Model <code>{model.trim() || providers[provider].model}</code>
          </summary>
          <label className="field">
            Model ID
            <input
              value={model}
              disabled={saving}
              onChange={(event) => setModel(event.target.value)}
              placeholder={providers[provider].model}
            />
          </label>
        </details>
      </div>
      {confirmRemoval ? (
        <div className="remove-key stack">
          <p>Remove the saved {providers[provider].name} key from this browser?</p>
          <div className="form-actions">
            <button
              type="button"
              className="secondary"
              autoFocus
              disabled={saving}
              onClick={() => setConfirmRemoval(false)}
            >
              Keep key
            </button>
            <button
              type="button"
              className="secondary"
              disabled={saving}
              onClick={() => void forgetConnection()}
            >
              Remove key
            </button>
          </div>
        </div>
      ) : (
        <div className="form-actions">
          {storedKey && (
            <button
              type="button"
              className="subtle remove-key-action"
              disabled={saving}
              onClick={() => setConfirmRemoval(true)}
            >
              Remove key
            </button>
          )}
          {onCancel && (
            <button type="button" className="subtle" disabled={saving} onClick={onCancel}>
              Cancel
            </button>
          )}
          <button
            className="primary"
            type="submit"
            disabled={saving || (!key.trim() && !storedKey)}
          >
            {saving ? "Saving…" : "Connect"}
          </button>
        </div>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
