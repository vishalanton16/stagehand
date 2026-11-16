"""Summarize paired existing-bench runs without changing task grading."""

import collections
import hashlib
import json
import math
import sys
from pathlib import Path
from typing import Any


def percentile(values: list[float], fraction: float) -> float | None:
    values = sorted(values)
    return values[math.ceil(len(values) * fraction) - 1] if values else None


def usage_cost(
    llm: list[dict[str, Any]], decisions: list[dict[str, Any]], cached: bool = False
) -> float:
    # Benchmark assumptions from replay.ts, not a quote of current provider pricing.
    cost = 0
    for usage in llm:
        tokens = usage.get("inputTokens", 0)
        reads = min(tokens, usage.get("cachedInputTokens", 0)) if cached else 0
        cost += (tokens - reads) * 0.1 + reads * 0.01 + usage.get("outputTokens", 0) * 0.5
    cost += sum(u.get("inputTokens", 0) * 0.02 for u in decisions)
    return cost / 1_000_000


def normalize_replay(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    normalized = []
    for row in rows:
        extraction = "notes" in row
        if extraction:
            cascade = next((n for n in row["notes"] if n.get("step") == "cascade"), {})
            cost = next((n for n in row["notes"] if n.get("step") == "cost"), {})

            def expand(usage: dict[str, Any]) -> list[dict[str, Any]]:
                count = usage.get("calls", 0)
                return [usage] + [{} for _ in range(count - 1)] if count else []

            llm = expand(cost.get("llmUsage", {}))
            decisions = expand(cost.get("decisionUsage", {}))
            arm = {
                "runtime-luna": "baseline",
                "runtime-decider": "decision",
                "before-decider": "before",
                "before-luna": "before-baseline",
            }[row["arm"]]
            decision_arm = arm in {"decision", "before"}
            fallback = decision_arm and cascade.get("decision") == "escalate"
            error = row.get("failure") if row.get("errored") else None
            accepted = decision_arm and cascade.get("decision") == "accept"
            wrong_accept = accepted and not row["passed"]
            reasons = [
                n["data"]
                for n in row["notes"]
                if isinstance(n.get("message"), str) and "fell back" in n["message"]
            ]
        else:
            llm, decisions = row["llm"], row["decisions"]
            arm = {"luna": "baseline", "runtime": "decision", "before": "before"}[row["arm"]]
            fallback, error = row["fallback"], row.get("error")
            accepted, wrong_accept = row["accepted"], row["wrongAccept"]
            reasons = [{"reason": row["reason"]}] if row.get("reason") else []
        operation = "extract" if extraction else "observe"
        normalized.append({
            "task": row["task"],
            "arm": arm,
            "round": row["round"],
            "operation": operation,
            "passed": row["passed"],
            "ms": row["ms"],
            "result": {"error": row.get("failure") or row.get("error")},
            "error": error,
            "calls": llm,
            "measured": [
                {
                    "operation": operation,
                    "ms": row["ms"],
                    "llm": llm,
                    "decisions": decisions,
                    "fallback": fallback,
                    "error": error,
                    "reasons": reasons,
                    "accepted": accepted,
                    "wrongAccept": wrong_accept,
                }
            ],
        })
    return normalized


def summarize(directory: str | Path) -> dict[str, Any]:
    directory = Path(directory)
    raw = (directory / "results.jsonl").read_bytes()
    rows = [json.loads(line) for line in raw.splitlines()]
    manifest = json.loads((directory / "manifest.json").read_text())
    replay = bool(rows) and "measured" not in rows[0]
    if replay:
        rows = normalize_replay(rows)
    keys = [(r["task"], r["arm"], r["round"]) for r in rows]
    if len(keys) != len(set(keys)):
        raise ValueError("Duplicate task/arm/round results")
    expected = (
        len(manifest.get("tasks", manifest.get("jobs", [])))
        * manifest["rounds"]
        * len(manifest.get("arms", ["baseline", "decision"]))
    )
    if len(rows) != expected:
        raise ValueError(f"Incomplete run: {len(rows)}/{expected}")
    if not replay and any(
        hashlib.sha256(
            (directory / "tasks" / t["operation"] / (t["name"] + ".ts")).read_bytes()
        ).hexdigest()
        != t["sha256"]
        for t in manifest["tasks"]
    ):
        raise ValueError("Archived task hash mismatch")
    groups = []
    paired = []
    for operation in ("act", "extract", "observe"):
        selected = [r for r in rows if r["operation"] == operation]
        if not selected:
            continue
        for arm in sorted({r["arm"] for r in selected}):
            arm_rows = [r for r in selected if r["arm"] == arm]
            checkpoint_tasks = []
            if not replay:
                for row in arm_rows:
                    snapshot = directory / f"{row['task']}-{arm}-{row['round']}.snapshot.json"
                    if (
                        snapshot.exists()
                        and "Vercel Security Checkpoint"
                        in json.loads(snapshot.read_text()).get("formattedTree", "")[:300]
                    ):
                        checkpoint_tasks.append(row["task"])
            primary = [m for r in arm_rows for m in r["measured"] if m["operation"] == operation]
            llm = [u for m in primary for u in m["llm"]]
            decisions = [u for m in primary for u in m["decisions"]]
            all_llm = [u for r in arm_rows for u in r["calls"]]
            times = [m["ms"] / 1000 for m in primary]
            reasons = collections.Counter(
                str(reason.get("reason")) for m in primary for reason in m["reasons"]
            )
            groups.append({
                "operation": operation,
                "arm": arm,
                "tasks": len({r["task"] for r in arm_rows}),
                "runs": len(arm_rows),
                "passed": sum(r["passed"] for r in arm_rows),
                "finalSnapshotCheckpoints": len(checkpoint_tasks) if not replay else None,
                "checkpointTasks": sorted(set(checkpoint_tasks)) if not replay else None,
                "passRate": sum(r["passed"] for r in arm_rows) / len(arm_rows),
                "setupOrTaskErrors": sum(bool(r.get("error")) for r in arm_rows),
                "noPrimaryCalls": sum(
                    not any(m["operation"] == operation for m in r["measured"]) for r in arm_rows
                ),
                "primaryCalls": len(primary),
                "operationErrors": sum(bool(m.get("error")) for m in primary),
                "wrongDirectAccepts": sum(m.get("wrongAccept", False) for m in primary)
                if replay
                else None,
                "fallbackCalls": sum(m["fallback"] for m in primary),
                "fallbackReasons": dict(reasons),
                "decisionRequests": len(decisions),
                "llmRequests": len(llm),
                "callsWithoutFallbackOrError": sum(
                    not m["fallback"] and not m.get("error") for m in primary
                )
                if arm in {"decision", "before"}
                else None,
                "operationP50Seconds": percentile(times, 0.5),
                "operationP95Seconds": percentile(times, 0.95),
                "operationTotalSeconds": sum(times),
                "taskP50Seconds": percentile([r["ms"] / 1000 for r in arm_rows], 0.5),
                "taskP95Seconds": percentile([r["ms"] / 1000 for r in arm_rows], 0.95),
                "primaryInputTokens": sum(u.get("inputTokens", 0) for u in llm + decisions),
                "primaryOutputTokens": sum(u.get("outputTokens", 0) for u in llm + decisions),
                "llmCachedInputTokens": sum(u.get("cachedInputTokens", 0) for u in llm),
                "primaryUncachedUsd": usage_cost(llm, decisions),
                "primaryCachedUsd": usage_cost(llm, decisions, True),
                "wholeTaskUncachedUsd": usage_cost(all_llm, decisions),
                "wholeTaskCachedUsd": usage_cost(all_llm, decisions, True),
                "failedTasks": sorted({r["task"] for r in arm_rows if not r["passed"]}),
            })
        pairs = collections.defaultdict(dict)
        for row in selected:
            if row["arm"] in {"baseline", "decision"}:
                pairs[(row["task"], row["round"])][row["arm"]] = row
        outcomes = collections.Counter()
        details = []
        for (task, round_number), pair in pairs.items():
            baseline, decision = pair["baseline"], pair["decision"]
            outcome = (
                "bothPass"
                if baseline["passed"] and decision["passed"]
                else "decisionOnly"
                if decision["passed"]
                else "baselineOnly"
                if baseline["passed"]
                else "bothFail"
            )
            outcomes[outcome] += 1
            if outcome != "bothPass":
                details.append({
                    "task": task,
                    "round": round_number,
                    "outcome": outcome,
                    "baselineError": baseline.get("error")
                    or (baseline.get("result") or {}).get("error"),
                    "decisionError": decision.get("error")
                    or (decision.get("result") or {}).get("error"),
                    "decisionFallbacks": sum(
                        m["fallback"] for m in decision["measured"] if m["operation"] == operation
                    ),
                })
        paired.append({"operation": operation, **outcomes, "details": details})
    summary = {
        "source": str(directory.resolve()),
        "resultsSha256": hashlib.sha256(raw).hexdigest(),
        "manifestSha256": hashlib.sha256((directory / "manifest.json").read_bytes()).hexdigest(),
        "expectedRows": expected,
        "actualRows": len(rows),
        "rounds": manifest["rounds"],
        "revision": manifest["revision"],
        "extensionSha256": manifest.get("extensionSha256", manifest.get("bundleHash")),
        "systemPrompt": manifest.get("systemPrompt"),
        "measurement": "frozen replay"
        if replay and "live" not in manifest.get("kind", "")
        else "public SDK live",
        "costAssumptionsUsdPerMillion": {
            "lunaInput": 0.1,
            "lunaCachedInput": 0.01,
            "lunaOutput": 0.5,
            "deciderInput": 0.02,
        },
        "costCaveat": (
            "Repo benchmark rate assumptions, not verified current invoice prices. "
            "Usage-bearing responses only; unreported or interrupted requests cannot be priced."
        ),
        "latencyCaveat": (
            "Operation wall time includes SDK snapshots, validation and fallback; task wall time "
            "also includes browser setup, navigation, helpers, final snapshot and cleanup. "
            "Nearest-rank percentiles, failed calls included."
        ),
        "gradingCaveat": (
            "Existing task graders, regression workload. A task failure without fallback "
            "does not by itself establish a wrong decision acceptance."
        ),
        "groups": groups,
        "paired": paired,
    }
    (directory / "summary.json").write_text(json.dumps(summary, indent=2) + "\n")
    print(
        json.dumps(
            {
                "groups": groups,
                "paired": [{k: v for k, v in p.items() if k != "details"} for p in paired],
            },
            indent=2,
        )
    )
    return summary


if __name__ == "__main__":
    summarize(sys.argv[1])
