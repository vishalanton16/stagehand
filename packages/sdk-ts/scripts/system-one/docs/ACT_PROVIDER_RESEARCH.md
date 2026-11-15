# Act provider research (Jev, Clef/Clairic, Decider/Locate)

Current cleanup status: see [CLEANUP_RESULTS.md](./CLEANUP_RESULTS.md). Prototype flags and source paths below describe the measured pre-cleanup implementations unless stated otherwise. Historical results and caveats are preserved.

Access date: **2026-11-15**. Research only; no new experiments were run for this document. Extraction results already live in [PROVIDER_RESEARCH.md](./PROVIDER_RESEARCH.md) and [DECISION_PRIMITIVES.md](./DECISION_PRIMITIVES.md). This note targets **browser `act()` / smart-selector** use of the same providers.

Legend: **Fact** = stated in official docs or verified local contracts. **Marketing** = vendor claim without a Stagehand-reproducible contract. **Hypothesis** = architectural guess for Stagehand; falsifiable below. **Known (prior)** = already in local transcripts / System One docs; not rediscovered here.

---

## Local baseline (do not rediscover)

### Current act stack

| File                                                                  | Role for act                                                                                                                                 |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| [providers.ts](../../../../extension/services/decisions/providers.ts) | Wire adapters: TypeSafe `POST /v1/systemone`, Cloudflare Workers AI Clef, Perplexity `POST /v1/decisions`. Exposes only `choice` and `noul`. |
| [client.ts](../../../../extension/services/decisions/client.ts)       | Timeout, 429/529 retry, circuit breaker, question-chunking by `maxQuestions`, id aliasing, answer validation.                                |
| [tree.ts](../../../../extension/services/decisions/tree.ts)           | AX outline → role-filtered candidate views (`pointer`, `input`, `select`, …).                                                                |
| [pick.ts](./CLEANUP_RESULTS.md#historical-source-and-evidence)        | Dual `best` + `strict` (with `none_match`), shard fan-out at 254 options / ~60k chars, prune-above-40.                                       |
| [pipeline.ts](./CLEANUP_RESULTS.md#historical-source-and-evidence)    | Intent fan-out (family, fill_value, mouse_button, toggle, scroll_scope, key, tools) → family view → pick → args → execute → optional checks. |

Local client knobs (code facts): TypeSafe `maxQuestions=1000`, Cloudflare `64`, Perplexity `128`; Cloudflare/Perplexity flatten structured instructions to text; TypeSafe keeps JSON. Default models: `jev-latest`, `clef`, `pplx-decider-latest`. Act default confidence `0.7`. Pick shards at `SHARD_SIZE=254` (255-option ceiling minus `none_match`).

### Known act results (prior)

From [vendor-repos/chat-transcript.md](../../../../../vendor-repos/chat-transcript.md) and [ACT_EXPERIMENTS.md](./ACT_EXPERIMENTS.md):

- On **14 controlled HTML fixtures**, compact ranked candidates + **one choice with explicit no-match** accepted **0** wrong selections on the reserved split; Miguel dual best/strict control accepted **6** (mostly disabled-control cases). Compact used ~62% fewer input tokens. **Joint** operation+target missed **6** valid actions.
- These are **development fixtures**, not live-page reliability. Candidate-order reverse held for the compact arm. Sean's `prompt-loc` branch (known operation) looked promising on checkout clicks; free-form `act()` remains the harder workload.
- Review ([cursor_stagehand_decision_models_review.md](../../../../../vendor-repos/cursor_stagehand_decision_models_review.md)): evidence/candidates beat provider swaps; treat models as classifiers/span-pickers; smart-selector + identity recheck + cache healing + page state checks are the product bets; confidence thresholds do not transfer across providers.

Extraction Locate/Clairic scalar wins are **out of scope** here except where they can serve **act arguments / postconditions**.

---

## Provider contracts (documented facts)

### TypeSafe Jev

| Topic              | Documented fact                                                                                                                                                                     | Source                                                                                                  |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Endpoint           | `POST https://api.typesafe.ai/v1/systemone`; `model` selects the weights                                                                                                            | [Models](https://docs.typesafe.ai/models)                                                               |
| Current IDs        | `jev-1.14.0` (stable since 2026-10-14), `jev-1.13.0`; aliases `jev-latest` / `jev-preview` → `1.14.0` today                                                                         | [Models](https://docs.typesafe.ai/models), [Changelog](https://docs.typesafe.ai/changelog)              |
| Price              | **$0.042 / M input tokens**; output free                                                                                                                                            | [Models](https://docs.typesafe.ai/models)                                                               |
| Context            | Default **64k per request / 32k per question**. Long context: header `TypeSafe-Danger-Zone-Long-Context: true` → **262k / 262k**; slower, less accurate, same $/token               | [Models](https://docs.typesafe.ai/models)                                                               |
| Question types     | Choice, Score, Noul; **Box** on 1.14 only                                                                                                                                           | [Models](https://docs.typesafe.ai/models)                                                               |
| Isolation          | Questions evaluated **in parallel and independently** against shared `state`; siblings do not see each other's instructions                                                         | [Introduction](https://docs.typesafe.ai/introduction), [State](https://docs.typesafe.ai/concepts/state) |
| Batching           | No separate question-count limit if both context limits fit; **speculative fan-out** is the recommended pattern                                                                     | [Fan-out](https://docs.typesafe.ai/patterns/fan-out)                                                    |
| Choice options     | 255 options per choice (Pydantic / OpenRouter guides; matches Stagehand shard size)                                                                                                 | [Pydantic TypeSafe](https://pydantic.dev/docs/ai/models/typesafe/), OpenRouter Jev guide                |
| Images / Box       | Opt-in header `TypeSafe-Danger-Zone-Images: true`. Box returns normalized edges + confidence; **no "not found"**.pair with Noul. Marked **dreamer-ready** (API/accuracy may change) | [Box](https://docs.typesafe.ai/primitives/box), [Images](https://docs.typesafe.ai/images)               |
| Hierarchy cookbook | Beam search over Choice probabilities with geometric-mean path scores                                                                                                               | [Hierarchical classification](https://docs.typesafe.ai/cookbooks/hierarchical_classification)           |
| Composite scoring  | Atomic Score questions + weights in code                                                                                                                                            | [Composite scoring](https://docs.typesafe.ai/patterns/composite-scoring)                                |

**Marketing / unverified here:** OpenRouter and vendor blogs claiming absolute leaderboard superiority; "adding questions barely changes latency" (directional; not measured for Stagehand AX packs).

**Local gap:** adapters do not encode `score`, `box`, assets, or danger-zone headers.

### Cloudflare Clef / Clairic

| Topic                      | Documented fact                                                                                                                                                               | Source                                                                                                                                                                                                                                          |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Clef endpoint              | `POST …/accounts/{id}/ai/run/@cf/cloudflare/clef` (or `clef-flash`); System One body `{model, state, questions}`                                                              | [clef](https://developers.cloudflare.com/workers-ai/models/clef/), [clef-flash](https://developers.cloudflare.com/workers-ai/models/clef-flash/)                                                                                                |
| Clef size / window / price | Clef **27B**, **65,536** context, **$0.24 / M input**; Flash **9B**, **24,576** context, **$0.038 / M input**; output free                                                    | Model pages above                                                                                                                                                                                                                               |
| Questions                  | **1-64** questions; ids `[A-Za-z0-9_.-]{1,100}`; types noul / choice / score                                                                                                  | Clef schema                                                                                                                                                                                                                                     |
| Images                     | Up to **4** embedded PNG/JPEG/WebP; **no remote URLs**; long text **truncated** to fit                                                                                        | Clef pages                                                                                                                                                                                                                                      |
| Architecture (blog)        | Prefill-only backbone; **option-specific evidence routing + joint cross-field attention** before scoring                                                                      | [Clef blog](https://blog.cloudflare.com/clef-decision-models/)                                                                                                                                                                                  |
| Clairic                    | Extraction model (`fields`, not `questions`); **$0.10 / M input**; preview; text fields often **separate passes** (rebill state); `p_null` + confidence; typed null ≠ correct | [clairic](https://developers.cloudflare.com/workers-ai/models/clairic/), [extraction concepts](https://developers.cloudflare.com/workers-ai/concepts/extraction-models/), [Clairic blog](https://blog.cloudflare.com/clairic-extraction-model/) |
| Decision vs extract        | Cloudflare: use **decision** models to pick among known options; **extraction** for open values                                                                               | Extraction concepts                                                                                                                                                                                                                             |

**Marketing:** Jev Decision Index leadership tables and median latency numbers in the Clef blog are vendor evals, not Stagehand act measurements. Fine-tuning / RL platform is future product, not a Stagehand act lever today.

**Local gap:** client uses Clef only; no Clairic in the act path; no image parts; no `score` questions.

### Perplexity Decider / Flash / Locate

| Topic                  | Documented fact                                                                                                                                                                                                | Source                                                                                                                                 |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Endpoint               | `POST https://api.perplexity.ai/v1/decisions`                                                                                                                                                                  | [Quickstart](https://docs.perplexity.ai/docs/decisions/quickstart)                                                                     |
| Models / price         | `pplx-decider-v1.3` **$0.02/M**; `pplx-decider-flash-v1.3` **$0.01/M**; aliases `…-latest` → v1.3; v1.2 still available; output free                                                                           | [Quickstart](https://docs.perplexity.ai/docs/decisions/quickstart), [Pricing](https://docs.perplexity.ai/docs/getting-started/pricing) |
| Context                | **256K** input for state + each question's share                                                                                                                                                               | Quickstart                                                                                                                             |
| Choice / score         | ≤**255** options; ≤**10** score levels                                                                                                                                                                         | Quickstart                                                                                                                             |
| Isolation (v1.3)       | Questions answered in one pass; each sees **state + own text**, not sibling questions; **state billed once** if the pack fits. Slight interaction via shared state remains.**freeze grouping** for comparisons | Quickstart "Grouping questions"                                                                                                        |
| Split billing          | Oversized packs → sequential groups; **state re-billed per group**; latency rises; may hit `504`                                                                                                               | Quickstart                                                                                                                             |
| Flash v1.2 vs v1.3     | Flash **v1.2** answers each question alone and rebills state; Flash **v1.3** groups like Decider v1.3                                                                                                          | Quickstart                                                                                                                             |
| Docs inconsistency     | Quickstart intro still says Flash "evaluates each separately and bills state once per question"; the detailed Grouping section contradicts that for **v1.3**. Prefer Grouping + changelog                      | Quickstart                                                                                                                             |
| Confidence             | Documented formulas: choice `(p_top - 1/n)/(1 - 1/n)`; score from distribution spread.not raw top mass                                                                                                         | Quickstart                                                                                                                             |
| Locate                 | v1.3 only; **string state**; returns spans `{start,end,text,score}` or `[]`; ≤128 questions when locate present; no web grounding; trained ≤8K, evaluated ≤32K; longer accepted unmeasured                     | Quickstart, [blog](https://www.perplexity.ai/hub/blog/perplexity-decider)                                                              |
| Attention modes (blog) | v1.2 full bidirectional; v1.3 isolated; **fully cacheable** (state self-attends only) exists as design but **not default**.would need fine-tune                                                                | [Decider blog](https://www.perplexity.ai/hub/blog/perplexity-decider) (2026-11-12)                                                     |
| Images                 | Base64 data URLs in state; ≤8 images/question; tile limits; no HTTP image fetch                                                                                                                                | Quickstart                                                                                                                             |
| Rate limits            | Org **10 rps**; Decider 15M TPM / Flash 4M TPM (table in docs)                                                                                                                                                 | Quickstart                                                                                                                             |
| Web grounding          | Optional `mode: "web_grounding"`; **irrelevant for in-browser act** over a Stagehand snapshot (and conflicts with locate)                                                                                      | Quickstart                                                                                                                             |

**Marketing:** Internal Perplexity classifier comparisons and domain leaderboards in the blog; not transferable to AX target selection without measurement.

**Local gap:** act client has no `locate` / `score` / images; Locate exists only under extract (`decider.ts`). Alias `pplx-decider-latest` is used without pinning in many runs.response `model` echoes the **alias**, not the resolved versioned ID (documented fact: pin versioned IDs for threshold work).

---

## Attention / packing: the act-relevant difference

| Provider         | Question↔question                | Implication for act packing                                                                                                                                                                        |
| ---------------- | -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Jev**          | Isolated (docs)                  | Speculative intent + family-side questions in one call is the intended pattern; answers stay auditable per question                                                                                |
| **Decider v1.3** | Isolated + mild state coupling   | Safe to pack intent facets; **keep packs identical** across arms; do not treat answers as fully independent when measuring thresholds                                                              |
| **Decider v1.2** | Full cross-question attention    | Grouping can help multi-facet routing or **hurt** competing candidates.docs warn against one-question-per-candidate packs                                                                          |
| **Clef**         | **Cross-field attention** (blog) | Packing related facets (family + toggle_state + mouse_button) may **improve** joint decisions; packing **competing candidates as separate questions** may leak preference.opposite of Jev guidance |

**Unsupported assumption:** Stagehand's dual `best`/`strict` in one request is "free isolation." On Clef it may be a **coupled** joint decision; on Decider v1.3 it is mostly isolated but not guaranteed identical to two separate calls.

---

## Overlooked capabilities that could change act architecture

These are **documented features the current act path barely uses**, not popularity rankings.

1. **Known-operation single Choice (smart selector)** . Prior fixture win; operation known → eligibility filter → compact role/name/heading → one Choice + `none_match` → identity recheck. Matches maintainer "smart selector" framing. Free-form intent tree stays the comparison arm ([ACT_EXPERIMENTS.md](./ACT_EXPERIMENTS.md)).

2. **Jev speculative fan-out beyond today's intent pack** . Docs recommend asking every speculative branch up front. Today intent packs family/fill/key/… but **target selection stays a second round**. Hypothesis: for known-operation locators, skip intent entirely; for free-form, speculative **per-family target Choices** over a tiny shortlist (or "none") in the same call as family may cut a round trip.or repeat the joint-arm failure mode.

3. **Hierarchical / beam Choice (Jev cookbook)** . Deep menus, nested nav, and custom listboxes are trees. Greedy family→tier→node can lock an early wrong parent. Beam over section/heading Choices then leaf Choices is a documented pattern unused by `pick.ts`.

4. **Clef vision + screenshot disambiguation** . Clef accepts images; act today is AX-text only. Dense icon toolbars and same-name buttons may need pixels. Clef Flash's **24k** window and truncation make full-page screenshots risky.crop or tile first.

5. **Jev Box (dreamer-ready)** . Bounding box over a screenshot, then map box → AX node by geometry. Requires Noul "present?" because Box never abstains. Header + assets not in adapters. High risk / high novelty for visual-only controls.

6. **Decider Locate for fill arguments and postconditions** . Locate over a **string** of visible text / option labels can ground "type X" and "did the toast say Y?" without Luna. Empty spans = abstention. Not a target picker for node IDs.

7. **Clairic for act only as typed scalar reader** . After a record/row is known, Clairic can read a value or compute a date; `p_null` for absence. Wrong accepts still possible with high confidence (extraction history). Poor fit as primary click resolver.

8. **Score as readiness / effect rubric** . Ordered levels ("loading / interactive / done", "no change / partial / full") compose better than a single noul for settle and verify. None of the act adapters send `score` today.

9. **Cache healing as the hottest narrow question** . Stale xpath → Choice among nearby candidates with old name/role/context. Cheap, repeated, verifiable. Already flagged in the review transcript; underused relative to free-form intent trees.

10. **Page-state primitive** . Login wall, modal open, empty cart: classification over compact DOM facts. Pipeline has a `pageState` flag; docs/cookbooks treat this as System One's core job. May beat shaving ms off target pick for agent loops.

11. **Provider-side pack split vs client shards** . Decider/Jev can take large packs until context breaks, then **silently split and rebill**. Stagehand already shards at 254 options. Measure **provider splits** (usage doubling) separately from client shards.

12. **Fully cacheable Decider attention** . Blog-only; **not** exposed on the hosted API. Do not plan Stagehand prompt-cache wins on Decider v1.3 isolation layout.

---

## Architecture hypotheses (falsifiable)

Each hypothesis states a **prediction**, a **minimum test**, and a **counterexample that kills it**. No claim that these tests have been run.

### H1 . Single Choice + none beats dual best/strict on live pages when operation is known

- **Predict:** Wrong-accept rate ≤ control; tokens and selection latency down; negatives still abstain.
- **Test:** Freeze ≥12 live tasks ([ACT_EXPERIMENTS.md](./ACT_EXPERIMENTS.md) batch); same candidates; arms: current `pickCandidate`, single Choice+none, deterministic unique name. Pin model IDs. Report risk-coverage, not pass%.
- **Kill:** Any wrong direct accept on positives, or recall loss from pruning that the dual pick would have recovered without Luna.

### H2 . Joint intent+target in one request regresses coverage

- **Predict:** Reproducing the fixture "joint" arm on live pages raises abstentions/mismatches vs intent-then-target or known-operation.
- **Test:** Same instructions; joint vs serial; count valid actions missed.
- **Kill:** Joint matches serial accuracy at equal or lower full-action p50 on a held-out domain set.

### H3 . Cross-field Clef packing helps **facets**, hurts **competing candidates**

- **Predict:** On Clef, family+toggle+button in one request improves agreement with labeled intent vs separate calls; N independent "is candidate i correct?" noul questions in one request increase wrong picks vs one Choice.
- **Test:** Paired Clef requests; freeze question sets; measure intent accuracy and target wrong accepts.
- **Kill:** Competing-candidate noul packs match or beat single Choice on Clef without raising wrong accepts.

### H4 . Compact representation > model upgrade

- **Predict:** Holding Decider v1.3 fixed, compact role/name/heading/state beats full `describeCandidate` on wrong accepts and tokens; swapping to Jev/Clef on full descriptions does not close that gap.
- **Test:** 2×2: representation × provider on frozen snapshots.
- **Kill:** Provider swap on full descriptions dominates representation change on wrong-accept rate.

### H5 . Screenshot+Choice (Clef or Decider vision) recovers icon/ambiguous AX misses

- **Predict:** On tasks where AX names collide or are empty, adding a cropped screenshot + Choice over ≤8 candidates cuts wrong accepts vs AX-only; identity recheck still required.
- **Test:** Hand-label a visual-hard subset; AX-only vs AX+image; pin models; exclude marketing latency claims.
- **Kill:** Image arm does not reduce wrong accepts, or truncation/timeout rate makes full-action p95 worse without accuracy gain.

### H6 . Locate (or Clairic text) for fill values reduces argument-LLM use without wrong fills

- **Predict:** For quoted/unquoted fill text present on-page or in instruction, Locate over a short string state matches gold more often than intent `fill_value` Choice alone; empty span → existing argument LLM / fallback.
- **Test:** Fill tasks with distractor quotes; compare fill_value Choice vs Locate vs Clairic; grade executed input value.
- **Kill:** Higher wrong-fill rate, or Locate returns plausible wrong spans that pass schema.

### H7 . Cache-heal Choice beats full re-act on stale xpath

- **Predict:** When xpath misses but a nearby twin exists, one narrow Choice restores the action with fewer tokens than full intent+pick, at ≤ control wrong-accept rate.
- **Test:** Controlled mutation suite (remove, replace-at-xpath, reorder); cacheCheck on/off; heal vs full pipeline.
- **Kill:** Heal selects the wrong twin more often than full re-resolve, or fails to beat LLM fallback cost when heal abstains.

### H8 . Provider confidence thresholds are not portable

- **Predict:** A threshold tuned on Decider choice `confidence` mis-ranks Clef/Jev on the same tasks (already seen in extraction probes).
- **Test:** Sweep thresholds per provider on the same frozen act set; compare risk-coverage curves.
- **Kill:** A single confidence cutoff yields overlapping curves across providers within sampling noise.

### H9 . Decider Flash v1.3 is enough for known-operation target Choice

- **Predict:** On smart-selector tasks with ≤30 compact candidates, Flash matches Decider v1.3 wrong-accept rate at lower $ and latency; free-form intent family Choice may still need full Decider/Jev.
- **Test:** Pin `pplx-decider-flash-v1.3` vs `pplx-decider-v1.3`; separate known-op vs free-form.
- **Kill:** Flash wrong-accept rate exceeds Decider by a pre-registered margin on known-op, or Flash triggers more Luna fallback so total $ rises.

---

## What Stagehand should not assume

| Assumption                           | Why unsupported                                                                            |
| ------------------------------------ | ------------------------------------------------------------------------------------------ |
| Output tokens matter                 | All three bill **input only** for these models                                             |
| Alias stability                      | `jev-latest` / `pplx-decider-latest` move; log **versioned** IDs (Perplexity echoes alias) |
| Confidence = P(correct)              | Provider-specific transforms; extraction already showed high-confidence wrongs             |
| Clairic/Locate as act target engines | Built for values/spans, not node-ID selection among AX candidates                          |
| Hosted Decider prompt cache          | Fully cacheable attention **not** the API default                                          |
| Clef Flash 65k                       | Flash window is **24,576**, not Clef's 65k                                                 |
| "Flash always rebills per question"  | True for Flash **v1.2**; **not** for Flash v1.3 per Grouping docs                          |
| Context7 / secondary indexes         | This research used official pages only; do not trust Context7 model lists over vendor docs |

---

## Suggested measurement order (act)

Aligns with [ACT_EXPERIMENTS.md](./ACT_EXPERIMENTS.md); provider research only changes **which arms are interesting**:

1. Freeze live-page act corpus with negatives and identity facts.
2. **H1/H4** on Decider v1.3 only (policy + representation).
3. Execute winners live (**Hypothesis 2** in ACT_EXPERIMENTS).
4. Then Flash / Jev / Clef on the **winning policy**, not on Miguel dual-pick.
5. Add vision (**H5**), Locate fill (**H6**), cache heal (**H7**) as separate single-variable trials.
6. Free-form `act()` last; do not promote extract Locate wins into act defaults.

---

## Source index

| URL                                                                             | Used for                                                       |
| ------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| https://docs.typesafe.ai/models                                                 | Jev IDs, price, context, long-context header                   |
| https://docs.typesafe.ai/changelog                                              | Jev 1.14 / Box date                                            |
| https://docs.typesafe.ai/patterns/fan-out                                       | Speculative multi-question packing                             |
| https://docs.typesafe.ai/patterns/composite-scoring                             | Score decomposition                                            |
| https://docs.typesafe.ai/cookbooks/hierarchical_classification                  | Beam / hierarchy                                               |
| https://docs.typesafe.ai/concepts/state                                         | Shared state, independent questions                            |
| https://docs.typesafe.ai/primitives/box                                         | Box semantics, no abstention                                   |
| https://docs.typesafe.ai/images                                                 | Image headers, limits, patterns                                |
| https://docs.perplexity.ai/docs/decisions/quickstart                            | Decider contracts, Locate, grouping, confidence, limits        |
| https://docs.perplexity.ai/docs/getting-started/pricing                         | Decisions pricing table                                        |
| https://docs.perplexity.ai/docs/resources/changelog                             | v1.3 / Locate launch notes                                     |
| https://docs.perplexity.ai/api-reference/decisions-post                         | Request schema details                                         |
| https://www.perplexity.ai/hub/blog/perplexity-decider                           | Attention modes, Locate training notes (2026-11-12)            |
| https://developers.cloudflare.com/workers-ai/models/clef/                       | Clef schema, 65k, $0.24/M                                      |
| https://developers.cloudflare.com/workers-ai/models/clef-flash/                 | Flash 24k, $0.038/M                                            |
| https://blog.cloudflare.com/clef-decision-models/                               | Cross-field attention, training story, benchmarks (marketing+) |
| https://developers.cloudflare.com/workers-ai/models/clairic/                    | Clairic price, passes, p_null                                  |
| https://developers.cloudflare.com/workers-ai/concepts/extraction-models/        | Decision vs extraction roles                                   |
| https://blog.cloudflare.com/clairic-extraction-model/                           | Clairic preview caveats                                        |
| https://developers.cloudflare.com/changelog/post/2026-10-01-clef-workers-ai/    | Clef launch                                                    |
| https://developers.cloudflare.com/changelog/post/2026-10-19-clairic-workers-ai/ | Clairic launch                                                 |

**Limitations of this research:** pages fetched 2026-11-15 may change; blog architecture claims are not API guarantees; no live API probes or latency/cost measurements were collected in this pass; fixture act results remain non-transferable to production pages until the frozen live corpus exists.

## Experiment follow-up

The later [action results](./ACT_RESULTS.md) test one choice over complete executable actions. That differs from separate conditional intent/target questions. They also record the failed disabled-input confirmation, execution guards, paired Flash comparison and limits of cross-provider thresholds.
