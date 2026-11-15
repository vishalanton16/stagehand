# Act design audit (research)

Current cleanup status: see [CLEANUP_RESULTS.md](./CLEANUP_RESULTS.md). Prototype flags and source paths below describe the measured pre-cleanup implementations unless stated otherwise. Historical results and caveats are preserved.

Access date for all URLs: **2026-11-15**. Research only; no product edits beyond this owned note.

**Historical** = Miguel stack / chat / earlier benchmarks. **Current** = local `packages/extension/services/decisions/` on this fork (Decider/Jev/Clef; no OpenAI provider wired yet).

---

## P0 . OpenAI "decision API" is real and distinct

### Verified API (official)

OpenAI ships a **Decisions API**, generally available (blog 2026-10-22), endpoint `POST /v1/decisions`, model **`gpt-6-luna` only**.

| Question type | Returns                   | Use                                         |
| ------------- | ------------------------- | ------------------------------------------- |
| `predicate`   | `probability` ∈ [0,1]     | Yes/no conditions                           |
| `choice`      | selected `choice` + probs | Closed set (routing, category, next action) |
| `score`       | weighted level index      | Ordered rubrics                             |

Docs also: shared `input` (text / images / `input_json` / conversation+tool evidence), up to **400** questions per request, **prompt caching** (`prompt_cache_key`, breakpoints; no breakpoints in question instructions), GPT-Live integration, US/EU residency. Pricing cited: $0.10/M uncached input; $0.01/M cached; **no output tokens**.

- Guide: https://developers.openai.com/api/docs/guides/decisions
- Create: https://developers.openai.com/api/reference/resources/decisions/methods/create
- GA blog: https://openai.com/index/decisions-api
- Prompt caching (Responses + Decisions concepts): https://developers.openai.com/api/docs/guides/prompt-caching

**Not in OpenAI Decisions (verified by absence in guide + create schema):** no `locate` / span-extraction question type. Perplexity's Decisions API **does** have `locate` (and names yes/no `noul`). Do not treat Perplexity docs as OpenAI's.

- Perplexity Decisions: https://docs.perplexity.ai/docs/decisions/quickstart
- Comparison note (third-party): https://vercel.com/i/openai-vs-perplexity-decisions-api

### Official OpenAI guidance that maps to Stagehand act

Computer-use guide (verified): use **Responses** when the model must choose actions **and generate arguments**; use **Decisions only when every allowed action and its complete arguments are already known**. Application still approves/performs; **discard choices when the page changes**.

- https://developers.openai.com/api/docs/guides/tools-computer-use

Structured Outputs / logprobs / Responses tool routing remain **separate** LLM surfaces.not a substitute for Decisions, and not "decision API by analogy."

| Capability                       | Official surface                                  | Role vs Decisions                                       |
| -------------------------------- | ------------------------------------------------- | ------------------------------------------------------- |
| Bounded classify / route / score | Decisions API                                     | Verified product fit for closed choices                 |
| Schema-shaped generation         | Structured Outputs (`text.format` / functions)    | Analogy for Luna fallback args/extract                  |
| Token probs on generated text    | Responses `include: message.output_text.logprobs` | Analogy for calibration; Decisions returns native probs |
| Prefix reuse                     | Prompt caching (Responses + Decisions)            | Verified for reused snapshot/state prefixes             |
| Browser grounding / CU           | Computer / Browser toolsets on Responses          | Not Decisions; Decisions is post-enumeration            |

### Current local implementation

`providers.ts` exposes only `typesafe` | `cloudflare` | `perplexity`. **No OpenAI adapter yet** (PR notes mention later #3102). Historical Miguel stack also started Jev-only.

---

## P0 . Split workloads: target selection ≠ action-plan selection

OpenAI's own CU→Decisions advice and local evidence agree:

1. **Known operation (smart selector / prompt-loc)** . caller supplies click/fill/select (+ literal args). Model only picks among Stagehand-built candidates (+ none). Matches Decisions "complete arguments already known."
2. **Free-form `act(instruction)`** . must infer family, args, target, tools, fallback. That is an **action plan**, not a single classification. Serial intent→pick (Miguel) or joint op+target both reintroduce failure modes Decisions docs warn about when args/actions aren't pre-enumerated.

**Do not** treat a win on (1) as evidence for (2).

---

## P1 . Historical stack (Miguel #2951-#2993) vs what still matters

All listed PRs are **OPEN**, not merged (`browserbase/stagehand`). Stack renamed Jev → `experimentalDecisions`.

| PR                                                          | Role                        | Durable learning                                                                                             | Stale / caveat                                    |
| ----------------------------------------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------- |
| [#2951](https://github.com/browserbase/stagehand/pull/2951) | `editableIds` side channel  | Contenteditable ≠ role; fill views need AX editable                                                          | Side channel; outline/cache keys unchanged        |
| [#2952](https://github.com/browserbase/stagehand/pull/2952) | `tree`/`pick`/`args`        | Role views, twin context, prune>40→30, best+strict, shards                                                   | Dual-question picker; thresholds tuned on Jev     |
| [#2953](https://github.com/browserbase/stagehand/pull/2953) | act pipeline                | Intent (no snapshot) → view → pick → execute → checks → LLM fallback; reported act p50 ~2s→0.46s (in-sample) | Free-form tree; in-sample thresholds              |
| [#2954](https://github.com/browserbase/stagehand/pull/2954) | observe + **cacheCheck**    | Stale xpath that still resolves is a real failure mode; one noul before replay                               | `STALE_BELOW=0.35` from probes; no E2E cache eval |
| [#2955](https://github.com/browserbase/stagehand/pull/2955) | extract judge/pick-and-copy | Pick+copy pattern; schema gate alone insufficient later                                                      | Largely superseded by map-and-copy experiments    |
| [#2988](https://github.com/browserbase/stagehand/pull/2988) | WebMCP tools                | Tool vs UI is another closed choice; once invoked, never also click                                          | Synthetic catalogs; unsure→element path           |
| [#2993](https://github.com/browserbase/stagehand/pull/2993) | Overlap intent∥settle       | Intent free with settle; settle still >½ of DM-only act                                                      | Tried early snapshot-before-intent; dropped       |

**prompt-loc** (`origin/prompt-loc`, tip `118d74c4a`, 2026-11-11): APC candidates scoped by locator op; SDK `decisionChoose` callback; operation known → one choose → existing locator execute. Historical live: **12/12** checkout clicks, one decision call, ~1.26-1.54s median vs free-form act ~1.83-2.02s on same fixture ([tree](https://github.com/browserbase/stagehand/tree/prompt-loc)).

### Current pipeline (local)

Still: modifier → intent fan-out → family view (`tree`) → `pick` best/strict → act → checks; options `cacheCheck`, `focusFallback`, `retryNoEffect`, `targetReadiness`, tools. Intent overlaps settle when `settled` provided. README warns **thresholds tuned on Jev; other providers' probs are not calibrated the same**.

---

## P1 . Mistakes and learnings (chat + review)

Concrete failures / confounds (historical experiments; treat as directional):

| Lesson                                       | Evidence shape                                                                  | Confound if ignored                                                                    |
| -------------------------------------------- | ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Evidence > provider                          | Oracle regions: all models OK; auto rank/cards failed including Luna            | Swapping OpenAI Luna Decisions won't fix bad candidates                                |
| One compact choice+none ≫ best/strict        | 0 wrong accepts vs 6; −62% tokens (14 fixtures)                                 | Dual questions share one request but add input and scoring work; "none" is the abstain |
| Joint op+target hurts coverage               | 22/28 vs 28/28                                                                  | Batching ≠ free accuracy                                                               |
| Schema-valid ≠ correct                       | Clairic `192` / Geniusee                                                        | Gate must check provenance/postcondition                                               |
| Disabled candidates inflate wrong picks      | 4/6 control wrongs were disabled                                                | Pruning/eligibility is deterministic work                                              |
| Shared page view confounds multi-model agree | Same wrong merge of two tables                                                  | Agreement ≠ independence                                                               |
| Replay bugs / cache inflate baselines        | Luna held3 "miss" = URL inject bug; cached vs uncached cost                     | Separate historical claims from current harness                                        |
| Multi-step unproven                          | Apple workflow: both arms failed extract; Buy unreliable → hardcoded nav        | Don't claim E2E act wins from fixture pick rates                                       |
| Settle dominates latency                     | #2993: ~560ms settle+snap of ~1001ms DM act                                     | Optimizing only model RTT misses the critical path                                     |
| Fallback after side effects                  | `pipeline` tracks `priorActions`; `retryNoEffect` can double-click              | Count first wrong action; never re-do side effects on LLM handoff                      |
| Stale identity                               | cacheCheck; ThinkFlowLab stale-target notes; OpenAI "discard when page changes" | XPath resolve ≠ same control                                                           |
| No-op semantics                              | Already-satisfied ≠ missing target                                              | Label `already_satisfied` vs `no_match` separately                                     |
| Provider thresholds non-transferable         | Clef low conf / Clef Flash fill→Luna                                            | Freeze per-provider gates on held-out                                                  |

Review synthesis ([`cursor_stagehand_decision_models_review.md`](../../../../../vendor-repos/cursor_stagehand_decision_models_review.md)): Stagehand builds evidence; model answers one narrow verifiable question. Extraction map-and-copy >> pick-and-copy; approach > model; held-out collapses flattering dev scores.

---

## P1 . First-principles challenge (act)

**Enumerate/verify in code (deterministic):** operation-eligible roles; editableIds; enabled/visible/checked; exact quoted-name shortcuts; arg parse/ground to instruction spans; fill read-back; native select selected; xpath↔id; identity/geometry recheck before input; postconditions; redaction of `%variables%`.

**Narrow model jobs (minimize sequential critical path, keep ambiguity):**

1. Target choice among compact candidates + explicit none (known op) . **primary**.
2. Optional pointwise noul on top-k or uneasy picks . only if single choice insufficient.
3. Intent/family **only** for free-form; keep off critical path via settle overlap; do not jointly bind op+target without measuring coverage loss.
4. cacheCheck noul before replay.
5. Tool-vs-UI / page-state as separate closed choices when those features are on.
6. Luna/Responses for unquoted args and full plan when Decisions abstains . not for every target pick.

OpenAI Decisions fits (1)(4)(5) and batched predicates; **not** locate-style span reads (use Perplexity Locate or LLM). Prompt caching helps reused APC/AX prefixes across many questions.especially OpenAI's 400-q and explicit breakpoints.

---

## P1 . Falsifiable experiments (3-5)

Grounded in sources + existing evidence. One variable each; wrong accepts + coverage as headlines. Prefer frozen snapshots then live execution (see [`ACT_EXPERIMENTS.md`](./ACT_EXPERIMENTS.md)).

### E1 . Single choice+none vs best/strict on fixed candidates (known op)

**Hypothesis:** On identical eligible candidates, one choice including `none_match` achieves ≤ wrong accepts of Miguel `pickCandidate` best/strict and ≥ recall of positives.

**Falsify if:** single-choice wrong-accept rate rises, or positive coverage drops vs control on a frozen held-out never used for wording.

**Sources:** chat 336-trial table; OpenAI "bounded answers"; `pick.ts` dual-question design.

### E2 . Representation confound: AX compact vs APC (prompt-loc) vs full outline

**Hypothesis:** Holding policy=E1 winner and op known, APC (prompt-loc) reduces wrong accepts or tokens vs AX compact without losing candidate recall of gold targets.

**Falsify if:** APC recall of gold IDs lower, or wrong accepts not improved after matching eligibility filters.

**Sources:** prompt-loc 12/12 vs AX fixture compact; ACT_EXPERIMENTS notes APC unmeasured vs AX prototype.

### E3 . Identity recheck before side effect (stale / replace-at-xpath)

**Hypothesis:** Forced DOM replace at same xpath: cacheCheck or pre-act identity noul/predicate abstains or re-resolves; without it, wrong control is actuated.

**Falsify if:** check doesn't reduce wrong actuations vs blind replay on labeled mutations, or false-stale rate blocks true matches beyond a frozen budget.

**Sources:** #2954; OpenAI discard-on-change; ThinkFlowLab stale notes in transcript.

### E4 . Free-form: serial intent→pick vs joint vs Luna-only (coverage × wrong × totalMs)

**Hypothesis:** Serial intent (overlapped with settle) + E1 target resolver matches Luna task success with fewer wrong first actions and lower selection tokens; joint op+target does not beat serial on coverage.

**Falsify if:** joint ≥ serial coverage at ≤ wrong accepts, or Decisions path increases wrong first actions vs Luna on confirmation domains.

**Sources:** #2953/#2993; joint 22/28 miss; OpenAI CU vs Decisions split.

### E5 . OpenAI Decisions (`gpt-6-luna`) vs Decider on same E1 inputs (adapter experiment)

**Hypothesis:** With identical candidate JSON/`input_json` and choice+none, OpenAI Decisions matches Decider wrong-accept/coverage within margin; caching cuts input cost on repeated tree prefixes.

**Falsify if:** OpenAI wrong accepts higher at same none policy, or cache reads stay ~0 under stable prefix discipline.

**Sources:** OpenAI Decisions + caching docs; current code lacks OpenAI provider.measure before productizing. **Not** an evaluation of Perplexity Locate.

---

## Citations (primary)

| Topic                           | URL                                                                            | Accessed   |
| ------------------------------- | ------------------------------------------------------------------------------ | ---------- |
| OpenAI Decisions guide          | https://developers.openai.com/api/docs/guides/decisions                        | 2026-11-15 |
| OpenAI Decisions create         | https://developers.openai.com/api/reference/resources/decisions/methods/create | 2026-11-15 |
| OpenAI Decisions GA             | https://openai.com/index/decisions-api                                         | 2026-11-15 |
| Prompt caching                  | https://developers.openai.com/api/docs/guides/prompt-caching                   | 2026-11-15 |
| Structured outputs              | https://developers.openai.com/api/docs/guides/structured-outputs               | 2026-11-15 |
| Computer use ↔ Decisions        | https://developers.openai.com/api/docs/guides/tools-computer-use               | 2026-11-15 |
| Perplexity Decisions (separate) | https://docs.perplexity.ai/docs/decisions/quickstart                           | 2026-11-15 |
| Miguel PRs                      | https://github.com/browserbase/stagehand/pull/2951 … /2993                     | 2026-11-15 |
| prompt-loc                      | https://github.com/browserbase/stagehand/tree/prompt-loc                       | 2026-11-15 |

Local: [`pipeline.ts`](./CLEANUP_RESULTS.md#historical-source-and-evidence), [`pick.ts`](./CLEANUP_RESULTS.md#historical-source-and-evidence), [`tree.ts`](../../../../extension/services/decisions/tree.ts), [`cacheCheck.ts`](./CLEANUP_RESULTS.md#historical-source-and-evidence), [`providers.ts`](../../../../extension/services/decisions/providers.ts), [`ACT_EXPERIMENTS.md`](./ACT_EXPERIMENTS.md), [`vendor-repos/cursor_stagehand_decision_models_review.md`](../../../../../vendor-repos/cursor_stagehand_decision_models_review.md), [`vendor-repos/chat-transcript.md`](../../../../../vendor-repos/chat-transcript.md).

## Experiment follow-up

The later [action results](./ACT_RESULTS.md) test one choice over complete executable actions. That differs from separate conditional intent/target questions. They also record the failed disabled-input confirmation, execution guards, paired Flash comparison and limits of cross-provider thresholds.
