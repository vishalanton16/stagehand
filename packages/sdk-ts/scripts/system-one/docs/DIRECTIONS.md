# Possible directions

Ideas that are useful to remember, ranked by how well they fit the **product default** (one System One + one LLM fallback). Most of these are experiments, not commitments.

## A. Strengthen the single-model gate (preferred)

Stay on Decider + Luna. Improve what the gate sees:

- table / heading / nested-list boundaries in the data view
- aggregate sparse-column problems instead of one problem per row
- parallel Locate with fact choice; fewer sequential list round trips
- optional structural checks without a yes/no self-check
- metadata flag for accept vs fallback

This is the main path in ROADMAP.md Phases 0–2.

## B. Second reading variants (same model family)

Decider already supports Jev-like choice/noul **and** Locate (blog: [Perplexity Decider](https://www.perplexity.ai/hub/blog/perplexity-decider)). Use that:

| Variant                            | Idea                                            | Risk                                          |
| ---------------------------------- | ----------------------------------------------- | --------------------------------------------- |
| Locate as check only               | Current `readerChecks: true`                    | Latency; exact `sameValue` over-escalates     |
| Locate as primary for scalars      | Override choice with Locate when sheet-grounded | Loses choice context when sheet is incomplete |
| Pointwise noul per candidate group | Current group cross-check                       | False alarms escalate good answers            |
| Isolated multi-question packs      | Fold more questions into one request            | Harder debugging; must keep isolation         |

Prefer measuring A/B on **wrong accepts** and escalate rate, not pass rate alone.

## C. Two System One models + Luna (experiment only)

Arms: `agree-decider-jev`, `agree-decider-flash`, `agree-locate`.

- Helped when providers disagree for different reasons (e.g. Jev vs Decider on mountains).
- Fails when both share the same data-view bug (merged tables) → **wrong accept**.
- User priority: do **not** make this the product default.

Use only to answer: "where does a second model earn its keep after structural checks exist?"

## D. Clairic / native extract as a scalar reader

Clairic and Decider `"native"` extract good single fields from short evidence, not lists of objects.

Direction: after map-and-copy selects a **record** and a **slot**, feed only that short evidence to Clairic/Locate. Keep list assembly in code.

Do not send the raw 500k-char Wikipedia tree to Clairic/Locate as the primary path.

## E. Hybrid pick vs map

`"pick"` chooses DOM nodes; `"map"` chooses record slots. Possible merge:

- use map for repeated records / tables
- use pick for one-off buttons / observe-like targets

Keep APIs separate until one benchmark shows a clear win; mixing modes early will confuse measurement.

## F. Verifier / judge as a gate

Tried: decision-model yes/no over the JSON result (`verifyResult.agree`).

Finding: weakly discriminative; sometimes anti-correlated with correctness. Do not put it back in the production accept path without a fresh calibration set. Prefer structural + Locate disagreement.

## G. LLM-first with System One as judge

Invert the cascade: Luna extracts, Decider checks faithfulness / completeness, retry or abstain on fail.

Worth a later experiment for high-stakes extract. It does **not** deliver System One latency wins. Out of scope while map-first is the bet.

## H. Caching and attention modes

Decider v1.3 discusses attention patterns (isolated questions vs cacheable state). If Perplexity exposes a cache-friendly mode, replay should measure whether large shared trees get cheaper without hurting mapping. Requires provider support; do not invent client-side approximations.

## I. What to avoid

- Site- or task-named branches in `dataView` / `mapCopy`
- Thresholds tuned on a single held-out (confidence cutoffs that only fit Jev or only fit held4)
- Claiming cost wins from warm prompt cache
- Changing the SDK's `act` / `observe` defaults based on extraction or fixture scores alone. Action research now follows its own [live-page experiment plan](./ACT_EXPERIMENTS.md).
