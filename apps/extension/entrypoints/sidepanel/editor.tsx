import { SelectField } from "./select-field";
import { useEffect, useRef, useState, type SyntheticEvent } from "react";
import { Clipboard } from "lucide-react";
import {
  checkArguments,
  normalizeSchema,
  objectValue,
  pretty,
  schemaFields,
  type Field,
} from "../../lib/schema";
import { needsReview, type Arguments, type PageCheck, type Tool } from "../../lib/webmcp";

export function Copy({
  value,
  label = "Copy JSON",
  text,
}: {
  value: string;
  label?: string;
  text?: boolean;
}) {
  const [status, setStatus] = useState("");
  return (
    <button
      type="button"
      className={text ? "secondary" : "icon-button"}
      title={status || label}
      aria-label={status || label}
      onClick={() =>
        void navigator.clipboard.writeText(value).then(
          () => setStatus("Copied"),
          () => setStatus("Copy failed"),
        )
      }
      onBlur={() => setStatus("")}
    >
      <Clipboard size={15} />
      {text && (status || label)}
      <span aria-live="polite" className="sr-only">
        {status}
      </span>
    </button>
  );
}

function FieldInput({
  field,
  raw,
  update,
}: {
  field: Field;
  raw: string | undefined;
  update: (value: string) => void;
}) {
  const { name, title, description, type, required } = field;
  const options = Array.isArray(field.enum)
    ? field.enum
    : type === "boolean"
      ? [true, false]
      : undefined;
  const placeholder =
    field.default === undefined
      ? type === "string"
        ? "Enter text"
        : (type ?? "JSON value")
      : `Default: ${pretty(field.default)}`;
  return (
    <label className="field">
      <span className="field-label">
        <code>{title || name}</code>
        {required && (
          <span className="required" aria-label="required">
            {" "}
            *
          </span>
        )}
        <small>{type}</small>
      </span>
      {description && <span className="field-hint">{description}</span>}
      {options ? (
        <SelectField value={raw ?? ""} onChange={(event) => update(event.target.value)}>
          <option value="">{required ? "Select a value" : "Unset"}</option>
          {options.map((value) => (
            <option key={pretty(value)} value={pretty(value)}>
              {String(value)}
            </option>
          ))}
        </SelectField>
      ) : (
        <input
          type="text"
          value={raw ?? ""}
          inputMode={type === "integer" || type === "number" ? "decimal" : undefined}
          placeholder={placeholder}
          onChange={(event) => update(event.target.value)}
        />
      )}
      {type === "string" && !options && !required && raw === "" && (
        <span className="field-hint">Blank text is sent as an empty string. Reset to omit it.</span>
      )}
    </label>
  );
}

function formValues(fields: Field[], args: Arguments) {
  return Object.fromEntries(
    fields.flatMap((field) => {
      if (!Object.hasOwn(args, field.name)) return [];
      const value = args[field.name];
      const string = field.type === "string" && !Array.isArray(field.enum);
      return [[field.name, string && typeof value === "string" ? value : pretty(value)]];
    }),
  );
}

export function Editor({
  tool,
  seed,
  busy,
  initialCheck,
  run,
}: {
  tool: Tool;
  seed?: Arguments;
  busy: boolean;
  initialCheck?: PageCheck;
  run: (input: Arguments, check?: PageCheck) => void;
}) {
  const fields = schemaFields(tool.schema) ?? [];
  const form = fields.length > 0;
  const [mode, setMode] = useState<"form" | "json">(form && !seed ? "form" : "json");
  const [raw, setRaw] = useState<Record<string, string>>({});
  const [extra, setExtra] = useState<Arguments>({});
  const [json, setJson] = useState(pretty(seed ?? {}));
  const [error, setError] = useState("");
  const [selector, setSelector] = useState(initialCheck?.selector ?? "");
  const [expected, setExpected] = useState(initialCheck?.expected ?? "");
  const [checkOpen, setCheckOpen] = useState(Boolean(initialCheck));
  const [confirm, setConfirm] = useState(false);
  const requiresConfirmation = needsReview(tool);
  const jsonInput = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (seed) jsonInput.current?.focus();
  }, [seed]);

  function clearReview() {
    setConfirm(false);
    setError("");
  }

  function input(): Arguments {
    if (mode === "json") {
      let parsed: unknown;
      try {
        parsed = JSON.parse(json);
      } catch {
        throw new Error("Enter valid input JSON.");
      }
      if (!objectValue(parsed)) throw new Error("Tool arguments must be a JSON object.");
      return parsed;
    }

    const args = { ...extra };
    for (const field of fields) {
      const value = Object.hasOwn(raw, field.name) ? raw[field.name] : undefined;
      const plainString = field.type === "string" && !Array.isArray(field.enum);
      if (value === undefined || (value === "" && !plainString)) continue;
      try {
        Object.defineProperty(args, field.name, {
          value: plainString ? value : (JSON.parse(value) as unknown),
          enumerable: true,
        });
      } catch {
        throw new Error(`${field.name} needs a valid JSON value.`);
      }
    }
    return args;
  }

  function switchMode(next: "form" | "json") {
    try {
      const args = input();
      if (next === "json") setJson(pretty(args));
      else {
        const fieldNames = new Set(fields.map((field) => field.name));
        const values = formValues(fields, args);
        const unknown = Object.fromEntries(
          Object.entries(args).filter(([key]) => !fieldNames.has(key)),
        );
        if (
          fields.some(
            (field) =>
              field.type === "string" &&
              !Array.isArray(field.enum) &&
              Object.hasOwn(args, field.name) &&
              typeof args[field.name] !== "string",
          )
        ) {
          throw new Error("Fix the field types in JSON before switching to Form.");
        }
        setRaw(values);
        setExtra(unknown);
      }
      clearReview();
      setMode(next);
    } catch (error) {
      setError((error as Error).message);
    }
  }

  function submit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const args = input();
      const issue = checkArguments(tool.schema, args);
      if (issue) throw new Error(issue);
      const check = selector.trim()
        ? { selector: selector.trim(), expected: expected.trim() }
        : undefined;
      if (!check && expected.trim()) throw new Error("Enter a CSS selector for the page check.");
      if (check) {
        try {
          document.createDocumentFragment().querySelector(check.selector);
        } catch {
          throw new Error("Enter a valid CSS selector for the page check.");
        }
      }
      if (requiresConfirmation && !confirm) {
        setError("");
        setConfirm(true);
        return;
      }
      clearReview();
      run(args, check);
    } catch (error) {
      setError((error as Error).message);
    }
  }

  const schema = pretty(normalizeSchema(tool.schema));
  return (
    <form className="box editor" onSubmit={submit}>
      <div className="box-header">
        <span>Arguments</span>
        {form ? (
          <div className="segment" aria-label="Argument editor">
            <button
              type="button"
              aria-pressed={mode === "form"}
              onClick={() => switchMode("form")}
              disabled={mode === "form"}
            >
              Form
            </button>
            <button
              type="button"
              aria-pressed={mode === "json"}
              onClick={() => switchMode("json")}
              disabled={mode === "json"}
            >
              JSON
            </button>
          </div>
        ) : (
          <small className="tool-kind">JSON</small>
        )}
      </div>
      <div className="box-body stack">
        {mode === "form" ? (
          fields.map((field) => (
            <FieldInput
              key={field.name}
              field={field}
              raw={Object.hasOwn(raw, field.name) ? raw[field.name] : undefined}
              update={(value) => {
                setRaw((old) => ({ ...old, [field.name]: value }));
                clearReview();
              }}
            />
          ))
        ) : (
          <textarea
            ref={jsonInput}
            value={json}
            aria-label="Input JSON"
            rows={form || seed ? 6 : 3}
            spellCheck={false}
            onChange={(event) => {
              setJson(event.target.value);
              clearReview();
            }}
          />
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <details className="schema">
          <summary>Input schema</summary>
          <pre>{schema}</pre>
        </details>
        <details
          className="schema"
          open={checkOpen}
          onToggle={(event) => setCheckOpen(event.currentTarget.open)}
        >
          <summary>
            Page check <span className="hint">Optional</span>
          </summary>
          <div className="stack">
            <p className="hint">Matches text in the top frame after the call.</p>
            <label className="field">
              CSS selector
              <input
                value={selector}
                placeholder="#order-total"
                onChange={(event) => {
                  setSelector(event.target.value);
                  clearReview();
                }}
              />
            </label>
            <label className="field">
              Expected text
              <input
                value={expected}
                placeholder="$90.00"
                onChange={(event) => {
                  setExpected(event.target.value);
                  clearReview();
                }}
              />
            </label>
          </div>
        </details>
        {confirm && (
          <div className="subframe stack" role="status">
            <p>This call may change the page or account.</p>
            <button type="button" className="secondary" onClick={clearReview}>
              Cancel review
            </button>
          </div>
        )}
      </div>
      <div className="box-footer">
        <button
          className="subtle"
          type="button"
          disabled={busy}
          onClick={() => {
            setRaw({});
            setExtra({});
            setJson("{}");
            setSelector("");
            setExpected("");
            clearReview();
          }}
        >
          Reset
        </button>
        <button className="primary" type="submit" disabled={busy}>
          {busy
            ? "Running…"
            : confirm
              ? "Confirm & run"
              : requiresConfirmation
                ? "Review & run"
                : "Run tool"}
        </button>
      </div>
    </form>
  );
}
