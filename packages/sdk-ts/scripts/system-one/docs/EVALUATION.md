# Evaluation protocol

Rules for measuring System One extraction so numbers stay honest.

## Product shape under test

Default policy to measure:

**one Decider (map-and-copy) → structural / second-reading gate → Luna (or configured LLM) on problems.**

Do not optimize for multi-model agreement as the product default. Agreement arms (`agree-*`) may still run as experiments.

## Frozen replay vs live

| Kind | What it measures | What it does not |
| --- | --- | --- |
| **Replay** (`replay.ts` on `vendor-repos/system-one-corpus/*.json`) | Mapping quality on a fixed accessibility tree | Browser latency, navigation, bot walls, layout shift |
| **Live fixtures** (`live.ts`) | Public SDK + extension path, round trips | Real-page size or ranking |
| **Live URLs** (`live.ts` with `LIVE_TASKS`) | End-to-end wall clock including snapshot | Needs its own small fixed URL list |

Report **which** kind every number came from.

## Held-out hygiene

1. **Write instructions before capture.**
2. **Capture snapshots.** Drop bot-walled pages; note them in the task file.
3. **Write graders from the snapshot only**, before any arm runs.
4. **Freeze graders.** Do not change instruction, schema or grader after the first run of any arm on that set.
5. **If the pipeline changes because of a held-out failure**, that set becomes a **regression set**, not an honest held-out. Say so in the README.
6. **Site-disjoint.** Prefer sites never used in corpus / held1–held4. Do not hardcode site names, task names or answers in `dataView` / `mapCopy`.

Status of existing sets:

| Set | Role now |
| --- | --- |
| `corpus.ts` (dev) | Tuning / regression |
| `heldout.ts` (held1) | Seen; regression |
| `heldout2.ts` (held2) | Seen; regression |
| `heldout3.ts` (held3) | Seen; informed data-view fixes; regression |
| `heldout4.ts` (held4) | Informed nested-section / absent-value work; **regression only** |
| `heldout5.ts` | Six site-disjoint tasks with frozen graders. Older held5 logs refer to a separate experiment |

## Metrics to report

For every arm × set:

- **final pass rate** — after fallback, if any
- **System One alone pass rate** — accepted mapping result that grades correctly
- **fallback / escalate rate**
- **wrong accepts** — accepted with no problems, but grader fails (headline failure mode)
- **p50 / p95 latency** — state replay vs live
- **decision requests per extraction** — from the trace (latency driver)
- **token usage** — prefer **uncached** cost when comparing Luna; prompt cache between replays makes cached `$` misleading

Wrong accepts matter more than raw pass rate. A high pass rate with silent wrong accepts is worse than a lower pass rate with clean escalations.

## Cost reporting

- Decision models: use the rate table in `replay.ts` (`RATES`).
- Luna / gateway: uncached input + output; call out cache hit rate if reporting cached `$`.
- `runtime-*` arms currently set `usd: null` because usage mixes providers. Prefer reporting tokens + latency until costs are split per provider in metadata.

## What not to claim

- Do not claim a general provider ranking from six live fixtures or one regression set.
- Do not present held4 22/22 as an independent held-out win.
- Do not generalize `live.ts` mean times (tiny HTML) to real pages.
- Do not claim semantic field correctness from provenance alone: a source ID proves the text was on the page, not that it answered the question.

## Archive every scored run

Replay writes under `vendor-repos/system-one-corpus/runs/archive/<run-id>/`:

- `manifest.json` — revision, hashes, encoding
- `results.jsonl`
- `snapshots.json.gz`
- `sources.json.gz`

Keep the whole directory when moving results. Prefer comparing new runs against archived manifests, not ad-hoc `/tmp` summaries alone.
