import { useCallback, useEffect, useRef, useState } from "react";
import { checkArguments } from "../../lib/schema";
import { suggest } from "../../lib/agent";
import type { Connection } from "../../lib/agent/connections";
import type { Attachment } from "../../lib/agent/input";
import { needsReview, type Arguments, type Page, type Receipt, type Tool } from "../../lib/webmcp";

type Part =
  | { type: "text"; text: string }
  | { type: "call"; id: string; tool: Tool; input: Arguments; status: string; receipt?: Receipt };

type Turn = {
  id: string;
  prompt: string;
  image?: string;
  parts: Part[];
  status: "Responding…" | "Finished" | "Stopped" | "Interrupted";
  error?: string;
};

type Decision = "skip" | "once" | "request";
type Approval = { id: string; canRemember: boolean; resolve: (choice: Decision) => void };

export function useAgentRun(
  call: (page: Page, tool: Tool, input: Arguments, signal: AbortSignal) => Promise<Receipt>,
) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [approval, setApproval] = useState<Approval>();
  const request = useRef<AbortController | undefined>(undefined);
  const stop = useCallback(() => request.current?.abort(), []);
  const busy = turns.at(-1)?.status === "Responding…";

  useEffect(
    () => () => {
      request.current?.abort();
      request.current = undefined;
    },
    [],
  );

  async function send(
    connection: Connection,
    prompt: string,
    attachment: Attachment | null,
    page: Page | null,
  ) {
    if (request.current || !prompt.trim()) return;
    const controller = new AbortController();
    request.current = controller;
    const signal = AbortSignal.any([
      controller.signal,
      AbortSignal.timeout(page?.tools.length ? 300_000 : 60_000),
    ]);
    const id = crypto.randomUUID();
    const turn: Turn = { id, prompt, image: attachment?.name, status: "Responding…", parts: [] };
    setTurns((current) => [...current.slice(-19), turn]);
    function update(change: (turn: Turn) => Turn) {
      if (request.current === controller)
        setTurns((current) => current.map((item) => (item.id === id ? change(item) : item)));
    }
    function onText(text: string) {
      if (signal.aborted) return;
      update((turn) => {
        const last = turn.parts.at(-1);
        const parts = last?.type === "text" ? turn.parts.slice(0, -1) : turn.parts;
        return {
          ...turn,
          parts: [
            ...parts,
            { type: "text", text: (last?.type === "text" ? last.text : "") + text },
          ],
        };
      });
    }
    const history = turns.slice(-6).map((turn) => ({
      user: turn.prompt.slice(-2000),
      agent: turn.parts
        .flatMap((part) => (part.type === "text" ? [part.text] : []))
        .join("\n")
        .slice(-2000),
      status: turn.status,
    }));
    const input = history.length
      ? `Earlier conversation (context only): ${JSON.stringify(history)}\n\nCurrent request: ${prompt}`
      : prompt;
    const allowedTools = new Set<Tool>();
    let activeCall: string | undefined;
    function updateCall(id: string, status: string, receipt?: Receipt) {
      update((turn) => ({
        ...turn,
        parts: turn.parts.map((part) =>
          part.type === "call" && part.id === id ? { ...part, status, receipt } : part,
        ),
      }));
    }
    async function confirm(tool: Tool, input: Arguments, callSignal: AbortSignal) {
      callSignal.throwIfAborted();
      if (activeCall) throw new Error("Request one tool call at a time.");
      const id = crypto.randomUUID();
      activeCall = id;
      update((turn) => ({
        ...turn,
        parts: [...turn.parts, { type: "call", id, tool, input, status: "Awaiting approval" }],
      }));
      if (allowedTools.has(tool)) {
        updateCall(id, "Running…");
        return true;
      }
      const canRemember = connection.provider === "gateway" && !needsReview(tool);
      const { promise, resolve } = Promise.withResolvers<Decision>();
      const cancel = () => resolve("skip");
      callSignal.addEventListener("abort", cancel, { once: true });
      setApproval({ id, canRemember, resolve });
      try {
        const choice = await promise;
        if (choice === "request" && canRemember) allowedTools.add(tool);
        const accepted = choice !== "skip";
        updateCall(id, accepted ? "Running…" : "Skipped");
        if (!accepted) activeCall = undefined;
        return accepted;
      } finally {
        callSignal.removeEventListener("abort", cancel);
        setApproval(undefined);
      }
    }
    async function execute(tool: Tool, input: Arguments, callSignal: AbortSignal) {
      const id = activeCall;
      if (!id || !page) throw new Error("Review the call on the current page.");
      try {
        const receipt = await call(page, tool, input, callSignal);
        updateCall(id, "Completed", receipt);
        return receipt;
      } catch (error) {
        updateCall(id, "Failed");
        throw error;
      } finally {
        activeCall = undefined;
      }
    }
    let status: Turn["status"] = "Finished";
    try {
      if (connection.provider === "gateway" && page?.tools.length) {
        const { runGoal } = await import("../../lib/goal");
        await runGoal({
          connection,
          goal: input,
          attachment,
          tools: page.tools,
          signal,
          onText,
          confirm,
          call: execute,
        });
      } else {
        const answer = await suggest(
          connection,
          input,
          attachment,
          page?.tools ?? [],
          signal,
          onText,
        );
        update((turn) => ({
          ...turn,
          parts: [{ type: "text", text: answer.text }],
        }));
        if (answer.draft && page) {
          const { tool, input } = answer.draft;
          const issue = checkArguments(tool.schema, input);
          if (issue) throw new Error(issue);
          if (await confirm(tool, input, signal)) {
            signal.throwIfAborted();
            await execute(tool, input, signal);
          }
        }
      }
    } catch (error) {
      status = "Interrupted";
      if (!signal.aborted)
        update((turn) => ({
          ...turn,
          error: error instanceof Error ? error.message : "Request failed.",
        }));
    } finally {
      if (signal.aborted) status = "Stopped";
      update((turn) => ({
        ...turn,
        status,
        error: signal.reason?.name === "TimeoutError" ? "Request timed out." : turn.error,
      }));
      if (request.current === controller) request.current = undefined;
    }
  }
  return {
    turns,
    approval,
    busy,
    send,
    stop,
    reset: () => setTurns([]),
  };
}
