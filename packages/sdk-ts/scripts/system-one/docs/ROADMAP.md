# Roadmap

Phased path from the current experiment to something Stagehand can ship. Each phase has an exit criterion. Engineering detail lives in [NEXT_STEPS.md](./NEXT_STEPS.md); measurement rules in [EVALUATION.md](./EVALUATION.md).

## Current decisions

The experimental SDK keeps the dual group gate and one Luna fallback. The wider initial shortlist and choice-only variants are archived. The next candidate for the SDK is retrieval after abstention, gated on missing-evidence tests, a fresh live comparison, and acceptable fallback p95. Exact DOM text and bounded scalar readers have separate experiments and promotion criteria. See the [ordered experiments](./NEXT_STEPS.md#current-experiment-order).

The first missing-evidence replay found wrong group picks before and after retry. The source-coverage follow-up caught the incomplete Python documentation list and preserved the positive retry controls. The live comparison measured five successful retries on known controls and a shared list-coverage error on a fresh page. The heading fix passed the row-coverage regression and two fresh live tasks. The five-page promotion check saw no retries. The SDK stays on current Decider plus Luna fallback. Exact span copying is the next accuracy experiment.

## Phase 0 — Stabilize the production path (now)

**Goal:** `extract: "map"` is correct, measurable and reviewable.

Exit when:

- uncommitted production wiring is split into stacked PRs (see NEXT_STEPS §9)
- seen-set regression run (`runtime-decider` on dev/held1–3) is archived and explained
- unused verifier call removed from the hot path (REVIEW H2)
- system prompt no longer pollutes mapper ranking / counts (REVIEW H3)
- info logs no longer dump full page-derived traces (REVIEW M1)
- README matches what the code actually guarantees (optional/absent fields, Perplexity-only Locate)

## Phase 1 — Honest accuracy bar

**Goal:** one fresh held-out (held5) measures the production pipeline without prior peeking.

Exit when:

- held5 exists under the EVALUATION.md protocol
- arms: `luna`, `runtime-decider`, optionally `runtime-flash`
- report: final pass, alone pass, escalate rate, **wrong accepts**, p50/p95 replay latency, decision calls / extract
- wrong-accept rate is low enough that silent corruption is rarer than useful accepts (set an explicit bar after held5, e.g. ≤5% of runs)

## Phase 2 — Latency competitive with Luna on real pages

**Goal:** when System One accepts, users are faster; when it falls back, total time is acceptable.

Exit when:

- live runner over a fixed real-URL subset (not only `live.ts` toys)
- accepted path p95 ≤ Luna p95 on that set **or** documented why not and what remaining round trips buy
- fallback path does not routinely exceed ~2× Luna (avoid "slow then Luna")
- sequential request count cut per NEXT_STEPS §3

## Phase 3 — Schema and absence semantics

**Goal:** optional / nullable / required absence behave the same in docs, mapper and Luna fallback.

Exit when:

- optional absent → omit field
- nullable absent → `null`
- required absent → escalate (or documented abstention), never invent `""` / `0`
- absence instruction is either product-wide for all LLM extract, or clearly scoped and tested
- Go / other generated clients know about `"map"` if those SDKs are in scope

## Phase 4 — Product surface

**Goal:** a supported experimental API, not a script pile.

Exit when:

- public docs for `experimentalDecisions.extract: "map"`
- metadata exposes accept vs fallback (so `runtimeMap` need not count LLM calls)
- usage splits decision vs LLM tokens
- default recommendation: Perplexity Decider + LLM fallback; other providers documented as weaker gates without Locate
- observe / act remain out of scope unless separately designed

## Phase 5 — Widen or default (later)

Only after Phase 1–2 exit criteria hold on a **second** fresh held-out:

- consider `map` as default for text snapshot extract (no screenshot)
- keep screenshot / visual extract on Luna
- consider Clairic or Locate as **field readers inside selected records**, not as whole-page extractors

## Explicit non-goals for the next few weeks

- Shipping two System One models per request as the default
- Replacing Luna entirely
- Site-specific extractors or grader-tuned regex
- Treating Clairic / Locate as a full list-of-objects extractor
- Gaming public decision-model leaderboards with this corpus
