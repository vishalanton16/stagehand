import json
import math
import sys
from collections import Counter
from pathlib import Path


def percentile(values, quantile):
    return round(sorted(values)[math.ceil(len(values) * quantile) - 1], 1) if values else None


def metrics(rows):
    times = [row["ms"] for row in rows]
    return {
        "trials": len(rows),
        "correct": sum(row.get("grade", {}).get("passed", False) for row in rows),
        "wrong": sum(row["kind"] == "done" and not row["grade"]["passed"] for row in rows),
        "fallback": sum(row["kind"] == "fallback" for row in rows),
        "errors": sum(row["kind"] == "error" for row in rows),
        "p50Ms": percentile(times, 0.5),
        "p95Ms": percentile(times, 0.95),
        "requests": sum(len(row["requests"]) for row in rows),
        "requestBytes": sum(req["bytes"] for row in rows for req in row["requests"]),
        "inputTokens": sum(receipt["inputTokens"] for row in rows for receipt in row["usage"]),
        "outputTokens": sum(receipt["outputTokens"] for row in rows for receipt in row["usage"]),
    }


def summarize(directory):
    manifest = json.loads((directory / "manifest.json").read_text())
    rows = [json.loads(line) for line in (directory / "results.jsonl").read_text().splitlines()]
    arms = manifest.get("arms", [
        {"model": model, "arm": arm}
        for model in manifest["models"] for arm in ("staged", "joint")
    ])
    expected = {
        (capture["snapshotDigest"], task, round_number, route["model"], route["arm"])
        for capture in manifest["captures"]
        for task in capture["tasks"]
        for round_number in range(manifest["rounds"])
        for route in arms
    }
    measured = {
        (row["snapshotDigest"], row["task"], row["round"], row["model"], row["arm"]): row
        for row in rows
    }
    if measured.keys() != expected or len(rows) != len(measured):
        raise ValueError(f"Missing, duplicated, or mismatched trials in {directory}")

    summary = {}
    for model in manifest["models"]:
        staged = [row for row in rows if row["model"] == model and row["arm"] == "staged"]
        if not staged:
            summary[model] = {"ordinary": metrics([row for row in rows if row["model"] == model])}
            continue
        joint = [
            measured[(row["snapshotDigest"], row["task"], row["round"], model, "joint")]
            for row in staged
        ]
        cascade = []
        matched_gains = []
        for control, candidate in zip(staged, joint, strict=True):
            if candidate["kind"] == "done":
                cascade.append(candidate)
                if control["kind"] == "done" and control["grade"]["passed"] and candidate["grade"]["passed"]:
                    matched_gains.append(control["ms"] - candidate["ms"])
            else:
                cascade.append({
                    **control,
                    "ms": control["ms"] + candidate["ms"],
                    "requests": control["requests"] + candidate["requests"],
                    "usage": control["usage"] + candidate["usage"],
                })
        summary[model] = {
            "staged": metrics(staged),
            "joint": metrics(joint),
            "simulatedSequentialCascade": metrics(cascade),
            "jointWithProviderRequest": metrics([row for row in joint if row["requests"]]),
            "jointAbstentions": Counter(row["reason"] for row in joint if "reason" in row),
            "matchedCorrectTrials": len(matched_gains),
            "matchedCorrectMedianSavedMs": percentile(matched_gains, 0.5),
            "wrongJointTrials": [
                {"task": row["task"], "workload": row["workload"], "round": row["round"], "grade": row["grade"]}
                for row in joint if row["kind"] == "done" and not row["grade"]["passed"]
            ],
        }
    return {"pages": len(manifest["captures"]), "revision": manifest["revision"], "models": summary}


if __name__ == "__main__":
    if len(sys.argv) < 2:
        raise SystemExit("Usage: summarize.py <replay-output-dir> ...")
    directories = [Path(argument) for argument in sys.argv[1:]]
    print(json.dumps({directory.name: summarize(directory) for directory in directories}, indent=2))
