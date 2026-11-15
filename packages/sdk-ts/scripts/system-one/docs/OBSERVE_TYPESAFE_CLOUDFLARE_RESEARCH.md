# Observe provider research (TypeSafe Jev, Cloudflare Clef / Clairic)

Access date for all fetched URLs: **2026-11-15**. Research only. Owned file for this note; no implementation, experiments, commits, or other docs edited.

Legend: **Fact** = stated on an official docs/API page or cookbook with a verifiable quote. **Marketing** = vendor benchmark or latency claim not measured for Stagehand observe. **Hypothesis** = Stagehand-facing inference; falsifiable below. **Known (local)** = already in [ACT_PROVIDER_RESEARCH.md](./ACT_PROVIDER_RESEARCH.md), [ACT_DESIGN_AUDIT.md](./ACT_DESIGN_AUDIT.md), [OBSERVE_EXPERIMENTS.md](./OBSERVE_EXPERIMENTS.md), [DECISION_PRIMITIVES.md](./DECISION_PRIMITIVES.md), or [vendor-repos/cursor_stagehand_decision_models_review.md](../../../../../vendor-repos/cursor_stagehand_decision_models_review.md). **Outdated** = contradicted by a newer primary page.

Method: web search + primary-page fetch only (no Context7 / ctx7). Secondary indexes and third-party mirrors were not used as contracts.

---

## First principles (rethink before mapping APIs)

### Observe is not “act minus input”

**Known (local):** Act’s strongest result is a **known-operation** single Choice over compact eligible candidates with an explicit none / abstain path ([ACT_DESIGN_AUDIT.md](./ACT_DESIGN_AUDIT.md), review synthesis). That answers one closed question: which node (if any) should receive a predetermined method.

**Inference for observe:** Public `observe()` returns zero or more proposed actions (selectors, methods, optional args) without executing them. Workloads that look similar on the wire are different contracts ([OBSERVE_EXPERIMENTS.md](./OBSERVE_EXPERIMENTS.md)):

| Workload              | Contract                                                     | Why “reuse act pick” fails                             |
| --------------------- | ------------------------------------------------------------ | ------------------------------------------------------ |
| One specific element  | One acceptable identity (+ method/args if supplied)          | Closest to act; still must abstain cleanly when absent |
| Several / all matches | Exact set: no silent truncation, no extras                   | A ranked shortlist is not an exact set                 |
| Absent / empty        | Correct empty ≠ abstention ≠ fallback                        | Choice always nominates someone                        |
| Ambiguous instruction | Frozen alternatives or escalate                              | Top-1 hides legitimate multi-accept                    |
| No instruction        | Comprehensive future-actions: required / allowed / forbidden | Discovery + filtering, not target pick                 |
| Arg / text grounding  | Method + grounded args; empty fill may be correct            | Span readers ≠ node pickers                            |

**Hypothesis:** Promoting act’s single-Choice+none winner as the default observe policy will look good on one-result tasks and fail completeness, absence, and no-instruction workloads for structural reasons, not model quality.

### Top-k ranking is not complete enumeration

**Fact (TypeSafe):** A Choice returns a full distribution that **sums to 1**. Some option always ranks first, even when nothing matches.

> "Choice probabilities always add up to 1, so some line ranks first even when the document doesn't answer the question." — [Line-by-line search](https://docs.typesafe.ai/cookbooks/semantic_find)

> "A Choice question always picks an option, even when none of them applies." — [Companion Noul](https://docs.typesafe.ai/patterns/companion-noul)

**Fact (TypeSafe):** For multi-match, docs recommend **independent Nouls per candidate**, not reading Choice mass as membership:

> "One Noul question per option. When a message can be about more than one product, a Choice has to split its probability between them. Ask one Noul question per product instead, and read each one on its own." — [Companion Noul](https://docs.typesafe.ai/patterns/companion-noul)

**Inference:** Taking the top-k Choice options as “all relevant observe targets” conflates **relative ranking under a simplex** with **independent relevance**. Top-k can drop a true match that shares probability with siblings, and can include distractors that only win by being least-wrong. Exact-set observe needs pointwise predicates (or an explicit set-construction protocol), plus a completeness / empty check.

**Known (local):** Extraction already showed incomplete lists and schema-valid wrongs; the review framed models as classifiers/span-pickers over Stagehand-built evidence, not as page readers ([cursor_stagehand_decision_models_review.md](../../../../../vendor-repos/cursor_stagehand_decision_models_review.md)). Observe inherits that split: **code discovers candidates; the model answers narrow verifiable questions.**

---

## Local baseline (do not rediscover)

| Source                            | Observe-relevant carry-forward                                                                                                                                                                                                                                                                                   |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Historical Miguel observe (#2954) | Overlapping intent/cardinality; best/strict for one result; **per-candidate predicates** for several; deterministic interactive enum with no instruction; fallback past 400 / 600; batch relevance at 60; thresholds 0.7/0.6; **empty relevant → fallback** ([OBSERVE_EXPERIMENTS.md](./OBSERVE_EXPERIMENTS.md)) |
| Act fixture win                   | Compact Choice+none beat dual best/strict on wrong accepts; joint op+target missed coverage ([ACT_PROVIDER_RESEARCH.md](./ACT_PROVIDER_RESEARCH.md))                                                                                                                                                             |
| Review                            | Evidence > provider; confidence thresholds non-portable; cache heal / smart selector as narrow primitives                                                                                                                                                                                                        |
| DECISION_PRIMITIVES               | Group probes: rich Choice helps covering-group pick; **abstention after removal** varies by provider; Clairic can return values for absent fields with high confidence; Locate empty ≠ Clairic null semantics                                                                                                    |
| Provider attention                | Jev: independent questions. Clef blog: **joint cross-field attention**. Packing competing candidate Nouls on Clef is an experimental variable, not a free copy of Jev fan-out                                                                                                                                    |

---

## Provider contracts (documented facts)

### TypeSafe Jev

| Topic                    | Fact                                                                                                                                                         | Quote / detail                                                                                                                 | Source                                                                                                                                                    |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Endpoint / models        | `POST https://api.typesafe.ai/v1/systemone`; `jev-1.14.0` / `jev-1.13.0`; aliases `jev-latest` / `jev-preview` → 1.14.0 today                                | “Jev 1.14 is the newest Jev release, available from October 14, 2026.”                                                         | [Models](https://docs.typesafe.ai/models)                                                                                                                 |
| Price / context          | **$0.042 / M input**; output free; default **64k / request**, **32k / question**; long-context header → **262k / 262k**, slower, less accurate, same $/token | Header `TypeSafe-Danger-Zone-Long-Context: true`                                                                               | [Models](https://docs.typesafe.ai/models)                                                                                                                 |
| Independence             | Questions share `state`, evaluated **independently** and in parallel                                                                                         | “All questions see the same state and are evaluated independently.”                                                            | [State](https://docs.typesafe.ai/concepts/state), [Primitives](https://docs.typesafe.ai/primitives)                                                       |
| Batching                 | No separate question-count limit if both context limits fit; speculative fan-out recommended                                                                 | “Adding questions barely changes the response time”                                                                            | [Fan-out](https://docs.typesafe.ai/patterns/fan-out), [Primitives](https://docs.typesafe.ai/primitives)                                                   |
| Choice options           | **≤255** options; 256 rejected                                                                                                                               | “A Choice question accepts up to 255 options”; infinite-cardinality: `CHOICE_LIMIT = 255 # … 256 options is rejected outright` | [semantic_find](https://docs.typesafe.ai/cookbooks/semantic_find), [infinite cardinality](https://docs.typesafe.ai/cookbooks/infinite_cardinality_choice) |
| Score                    | Ordered levels, ≤10; probability-weighted `score` + `confidence`                                                                                             | Levels judged separately; no neighbor awareness                                                                                | [Score](https://docs.typesafe.ai/primitives/score)                                                                                                        |
| Noul                     | Yes-probability only; **no** separate `confidence`                                                                                                           | Start thresholds 0.7 / 0.3 with middle band                                                                                    | [Noul](https://docs.typesafe.ai/primitives/noul)                                                                                                          |
| Companion abstain        | Prefer companion Noul over `other` / `none` for many cases                                                                                                   | Desk-lamp example: Choice 0.96 + Noul 0.02                                                                                     | [Companion Noul](https://docs.typesafe.ai/patterns/companion-noul)                                                                                        |
| Confidence formula       | Choice: `(p_max - 1/n)/(1 - 1/n)`; Score uses distance-from-peak; prefer **act on `probabilities[choice]`** for Choice risk                                  | Confidence ≠ P(correct) as a separate signal when n is fixed                                                                   | [Confidence](https://docs.typesafe.ai/confidence)                                                                                                         |
| Images / Box             | Opt-in `TypeSafe-Danger-Zone-Images: true`; Box on **1.14 only**; **dreamer-ready**; Box **never returns not-found**                                         | Pair Box with presence Noul                                                                                                    | [Images](https://docs.typesafe.ai/images), [Box](https://docs.typesafe.ai/primitives/box)                                                                 |
| Image limits             | PNG/JPEG; 280–1568 px/side; 16 MiB/file; 32 MiB body / expanded; no auto-resize                                                                              | Rejected images fail whole request                                                                                             | [Images](https://docs.typesafe.ai/images)                                                                                                                 |
| Hierarchy                | Beam search: geometric mean of edge probs; keep K paths                                                                                                      | `path_score = product(edge_probabilities) ** (1 / decisions)`                                                                  | [Hierarchical classification](https://docs.typesafe.ai/cookbooks/hierarchical_classification)                                                             |
| Ranking vs membership    | Choice ranks; Noul checks existence / per-item fit                                                                                                           | semantic_find + infinite-cardinality cascade                                                                                   | Cookbooks above                                                                                                                                           |
| Client caching           | Cookbooks use `JsonCache` for **replay of API answers**, not provider KV/prompt cache                                                                        | “a CACHE already on disk is never overwritten”                                                                                 | [semantic_find](https://docs.typesafe.ai/cookbooks/semantic_find)                                                                                         |
| Fine-tune / prompt cache | Jev not customer-fine-tuned; shape via state + criteria                                                                                                      | No hosted prompt-cache knobs in Models page                                                                                    | [Models](https://docs.typesafe.ai/models)                                                                                                                 |

**Marketing / unverified here:** Parallel-questions cookbook latency multipliers (12×); vendor “adding questions barely changes latency” as a Stagehand AX-pack measurement.

### Cloudflare Clef / Clef-flash / Clef-omni

| Topic                 | Fact                                                                                                                                       | Quote / detail                                                          | Source                                                                                                                                                                                                                        |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Endpoints             | `@cf/cloudflare/clef`, `clef-flash`, `clef-omni` via Workers AI `AI.run` / REST                                                            | System One-shaped `{model, state, questions}`                           | [clef](https://developers.cloudflare.com/workers-ai/models/clef/), [clef-flash](https://developers.cloudflare.com/workers-ai/models/clef-flash/), [clef-omni](https://developers.cloudflare.com/workers-ai/models/clef-omni/) |
| Size / window / price | Clef **27B**, **65,536**, **$0.24/M**; Flash **9B**, **24,576**, **$0.038/M**; Omni **~$64k**, **$0.15/M**                                 | Output free; media → input tokens                                       | Model pages; [faster/cheaper blog](https://blog.cloudflare.com/clef-faster-cheaper-multimodal/)                                                                                                                               |
| Questions             | **1–64** questions; ids `[A-Za-z0-9_.-]{1,100}`; types noul / choice / score                                                               | No Box type on Clef docs                                                | Clef schema                                                                                                                                                                                                                   |
| Choice option ceiling | **Not stated** on Workers AI model pages (unlike TypeSafe’s 255)                                                                           | Treat as **unknown**; measure reject/truncate behavior                  | Inference: gap in docs                                                                                                                                                                                                        |
| Images                | Up to **4** PNG/JPEG/WebP embedded; **no remote URLs**; image tokens capped (**1024**/image on Clef); else **text state truncated** to fit | Resize rules differ slightly vs Clairic (Clef scales large images down) | [clef](https://developers.cloudflare.com/workers-ai/models/clef/)                                                                                                                                                             |
| Attention (blog)      | Prefill-only; **option-specific evidence routing + joint cross-field attention** before scoring                                            | Architecture claim, not an API switch                                   | [Clef blog](https://blog.cloudflare.com/clef-decision-models/) (2026-10-01)                                                                                                                                                   |
| Flash window change   | Hosted Flash cut **64k → 24k** to lower price; HF weights still large-context                                                              | “only 0.24% of requests exceed 24k” (vendor usage claim)                | [faster/cheaper blog](https://blog.cloudflare.com/clef-faster-cheaper-multimodal/) (2026-10-09)                                                                                                                               |
| Omni                  | Audio + video + image + text; still decision schema                                                                                        | Extra media params; observe may later use screenshots only              | Omni model page / blog                                                                                                                                                                                                        |
| Compatibility         | Marketed as Jev-API compatible                                                                                                             | Still: 64-question cap, truncation, joint attention differ              | Changelog 2026-10-01                                                                                                                                                                                                          |

**Outdated:** Launch blog claimed Jev “only does text classification today” while contrasting Clef vision ([Clef blog](https://blog.cloudflare.com/clef-decision-models/)). **Current TypeSafe docs** ship images + Box (dreamer-ready) on Jev 1.13/1.14 ([Images](https://docs.typesafe.ai/images), [Models](https://docs.typesafe.ai/models)). Prefer Models/Images over the Oct 1 blog for Jev modality.

**Outdated:** Early Clef changelog table listed Flash at **64K**; hosted Flash is now **24,576** per model page + Oct 9 blog.

**Marketing:** Jev Decision Index tables, median latency ms, PhishNChips, etc. — not Stagehand observe measurements.

### Cloudflare Clairic (extraction; observe-adjacent only)

| Topic          | Fact                                                                     | Quote / detail                                                                    | Source                                                                                          |
| -------------- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Role           | Extraction / compute / estimate / forecast — **not** closed-set decision | “use a decision model to select from known options”                               | [Extraction concepts](https://developers.cloudflare.com/workers-ai/concepts/extraction-models/) |
| Price / window | **$0.10 / M input**; 65,536; preview                                     | Output free                                                                       | [clairic](https://developers.cloudflare.com/workers-ai/models/clairic/)                         |
| Text fields    | Often **separate passes**; state+images rebilled per pass                | `usage.passes`                                                                    | Clairic model page                                                                              |
| Absence        | `value: null` with `p_null`; **`guess` may still point at a span**       | Invoice `po_number`: `p_null: 1`, `value: null`, guess still set                  | Clairic example JSON; [Clairic blog](https://blog.cloudflare.com/clairic-extraction-model/)     |
| Correctness    | Typed ≠ correct                                                          | “Typed results provide a predictable structure but do not guarantee correctness.” | Extraction concepts                                                                             |
| Images         | Up to 4; **does not scale down** large images (unlike Clef)              | Patch tokenization                                                                | Clairic page                                                                                    |

**Known (local):** Clairic/Locate are argument / scalar readers; poor primary click resolvers. Observe may use them later for **fill text / heading spans**, never as the sole target engine ([OBSERVE_EXPERIMENTS.md](./OBSERVE_EXPERIMENTS.md), [DECISION_PRIMITIVES.md](./DECISION_PRIMITIVES.md)).

---

## Topic map for browser `observe()`

### 1. Single-target resolution

**Facts to use**

- One Choice over labeled candidates + **companion Noul** (“does any candidate answer the instruction?”) — official pattern ([Companion Noul](https://docs.typesafe.ai/patterns/companion-noul), [semantic_find](https://docs.typesafe.ai/cookbooks/semantic_find)).
- TypeSafe: `none`/`other` “may not work well”; companion Noul preferred in the pattern page. Infinite-cardinality / value-extraction cookbooks still use `none` in some flows — **treat as empirical**, not settled.
- Act local win used explicit `none_match` inside Choice; that is a **different** abstain mechanism than companion Noul. Both need head-to-head on observe one-result tasks.

**Hypothesis:** For observe one-result, Choice+companion-Noul ≤ wrong accepts of Choice+`none_match` at equal coverage, because Noul is not forced onto the simplex. **Kill if** companion Noul false-negatives gold targets more often than `none_match` on the same candidates.

### 2. Complete relevant sets

**Facts to use**

- Independent per-candidate Nouls (or Score relevance levels) for multi-label; Choice splits probability across mutually exclusive options ([Companion Noul](https://docs.typesafe.ai/patterns/companion-noul)).
- Cascades for large N: Noul filter chunks → shorter Noul re-read → Choice shortlist ([infinite cardinality](https://docs.typesafe.ai/cookbooks/infinite_cardinality_choice)). That cascade **optimizes ranking**, not exact-set recall; Stagehand must still **account for every eligible candidate** under budget or escalate ([OBSERVE_EXPERIMENTS.md](./OBSERVE_EXPERIMENTS.md) H3).
- Clef: ≤64 questions/request → pointwise Noul packs shard at 64; Jev shards by context (255 Choice options; many Nouls until 64k/32k).

**Hypothesis:** On a frozen eligible set with ≥2 gold matches, thresholded independent Nouls achieve higher exact-set accuracy than “top-k by Choice probability,” at the cost of more question tokens. **Kill if** top-k Choice exact-set matches or beats pointwise Nouls after a fair completeness rule (e.g. require cumulative mass ≥ τ and still miss a gold).

**Inference (challenge):** Miguel’s “per-candidate predicates for several results” already pointed at the right primitive family; regressing to act-style top-k for multi-observe would be a step backward even if one-result improves.

### 3. Absent / ambiguous / empty answers

| Mechanism               | Behavior                      | Observe implication                                |
| ----------------------- | ----------------------------- | -------------------------------------------------- |
| Choice alone            | Always picks                  | Fabricates a target on absent tasks                |
| Companion Noul          | Can go near 0                 | Gate: ignore Choice when Noul low                  |
| `none` / `other` option | Competes for mass             | Can blur partial matches                           |
| Pointwise Nouls all low | Natural empty set             | Prefer for multi-result absence                    |
| Clairic null + guess    | Null value ≠ no guess span    | Do not treat null as “no evidence of a wrong span” |
| Historical observer     | Empty relevant → **fallback** | Control conflates empty with failure; measure both |

**Fact:** semantic_find uses three-way exists thresholds (e.g. 0.7 / 0.35) for answered / partial / absent — **cookbook-tuned**, not a universal default.

**Hypothesis:** Explicit empty (all Nouls below NO, or companion Noul below NO) with **no Luna fallback** reduces false positives vs historical empty→fallback, without raising false empties on positives beyond a frozen budget. **Kill if** false-empty rate on positives exceeds control’s missed-target rate after fallback is counted as success only when fallback is correct.

### 4. Hierarchical classification

**Fact:** Beam over Choice children with geometric-mean path scores; greedy locks early errors ([hierarchical cookbook](https://docs.typesafe.ai/cookbooks/hierarchical_classification)). Structured criteria can embed subtrees so the model sees what lives under a branch ([Advanced structure](https://docs.typesafe.ai/primitives/advanced)).

**Hypothesis for observe:** For “all links in section X” / nested nav, section→leaf beam (or section Choice then pointwise Nouls under the winning sections) beats flat Choice over all leaves when gold targets sit under near-tied parents. **Kill if** flat pointwise Nouls over leaves match beam exact-set at ≤ tokens on the nested held-out set.

### 5. Independent vs jointly attentive questions

| Provider    | Documented question↔question                                                         | Observe packing consequence                                                                                        |
| ----------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| **Jev**     | Independent; parallel-questions cookbook: batch vs single answers match within noise | Safe to pack intent facets + many candidate Nouls; answers auditable                                               |
| **Clef**    | Blog: joint cross-field attention                                                    | Related facets (method + target readiness) may help; **competing candidate Nouls in one pack may leak preference** |
| **Clairic** | Field passes; text fields often isolated passes                                      | Not a substitute for candidate packs                                                                               |

**Unsupported assumption:** “Batching is free isolation on every provider.” On Clef it may be a **coupled** joint decision ([ACT_PROVIDER_RESEARCH.md](./ACT_PROVIDER_RESEARCH.md) H3 carries to observe).

### 6. Confidence calibration

**Facts**

- TypeSafe: confidence summarizes **distribution concentration**; for fixed-n Choice it is a transform of `p_max`; prefer thresholding **option probability** for risk ([Confidence](https://docs.typesafe.ai/confidence), [probability routing](https://docs.typesafe.ai/patterns/probability-routing)).
- Calibration marketing: RLCD aims for groupwise calibration ([AI primer](https://docs.typesafe.ai/introduction/machine-learning-primer)) — **not** a guarantee for AX observe.
- **Known (local):** Clef confidences run lower than Jev; thresholds do not transfer; extraction removed cutoffs in favor of explicit none.

**Hypothesis:** A single confidence cutoff tuned on Jev mis-ranks Clef/Flash on the same observe tasks (risk-coverage curves diverge). **Kill if** curves overlap within sampling noise on a frozen set.

### 7. Images / boxes

| Surface             | Fit for observe                                                    | Limits                                                         |
| ------------------- | ------------------------------------------------------------------ | -------------------------------------------------------------- |
| Clef / Flash vision | Disambiguate icon toolbars / empty AX names among ≤ few candidates | Flash **24k** + truncation; crop/tile first; ≤4 images         |
| Jev images          | Same, dreamer-ready API                                            | Danger-zone header; strict size bounds; reject ≠ resize        |
| Jev Box             | Geometry → nearest AX node                                         | Always returns a box; needs presence Noul; production-unstable |
| Clairic image       | OCR-ish values from screenshots                                    | Extraction class; not node IDs                                 |

**Hypothesis:** On a visual-hard subset with empty/colliding AX names, AX+cropped screenshot Choice (Clef or Jev) cuts wrong one-result accepts vs AX-only. **Kill if** no wrong-accept reduction, or truncation/timeout worsens p95 without accuracy gain.

### 8. Score

**Fact:** Ordered rubrics; composite scoring in code ([Score](https://docs.typesafe.ai/primitives/score), [composite scoring](https://docs.typesafe.ai/patterns/composite-scoring)).

**Hypothesis for observe:** Score levels such as `irrelevant / weakly related / required match` or `incomplete / complete candidate accounting` beat a single Noul threshold for set inclusion when near-ties matter. **Kill if** Score exact-set accuracy ≤ Noul binary on the same candidates after equal escalation rules.

### 9. Span readers (Clairic; Locate noted only as contrast)

**Facts:** Clairic returns spans + `p_null` + optional `guess` when null; typed null ≠ correct; separate text passes rebill state. Cloudflare: decision vs extraction roles are distinct.

**Hypothesis:** For observe **arguments** (quoted fill, option label), Clairic/Locate over a **bounded** instruction+evidence sheet improves arg exactness vs inventing fills — only after target identity is fixed. **Kill if** wrong-arg rate rises, or spans authorize wrong methods.

**Do not** promote span presence as observe completeness.

### 10. Limits, batching, caching

| Limit               | Jev                               | Clef / Flash                 | Observe impact                                                  |
| ------------------- | --------------------------------- | ---------------------------- | --------------------------------------------------------------- |
| Questions / request | Context-bound (no hard count)     | **≤64**                      | Pointwise multi-observe shards                                  |
| Choice options      | **≤255**                          | Undocumented                 | Shard large Choice packs; measure Clef                          |
| Context             | 64k / 32k (262k danger)           | 65k / **24k Flash**          | Full-page AX+screenshot fragile on Flash                        |
| State overflow      | Error / max_tokens                | **Truncate text state**      | Silent evidence loss on Clef — detect via usage vs input length |
| Batching            | Speculative fan-out; independence | Same schema; joint attention | Separate policy vs provider experiments                         |
| Provider cache      | None documented                   | None documented              | Client JsonCache ≠ production prompt cache                      |
| Stagehand cache     | Historical cacheCheck noul        | —                            | Observe→act staleness is identity, not model cache              |

**Hypothesis:** On Clef Flash with large outlines, truncated state causes systematic misses of gold nodes beyond position N; detecting truncation (or pre-truncating with section hierarchy) recovers exact-set. **Kill if** Flash matches Clef exact-set on the same oversized packs without hierarchy.

---

## Challenged assumptions

| Assumption                                     | Status                                                                                                    |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Observe = act pipeline with `returnCandidates` | **Challenged.** Completeness, absence, and no-instruction are different contracts.                        |
| Top-k Choice ≈ “all relevant”                  | **Falsified by TypeSafe docs’ own simplex + companion-Noul guidance**; still needs Stagehand measurement. |
| Empty → Luna fallback is safe                  | **Challenged.** Can hide false empties and inflate “success after fallback.”                              |
| Jev isolation = Clef packing rules             | **Challenged** by Clef joint-attention blog.                                                              |
| Confidence 0.7 portable                        | **Challenged** by local probes + TypeSafe’s own “threshold on probability / risk.”                        |
| Clairic/Locate as observe engines              | **Challenged**; extraction class + local wrong accepts.                                                   |
| Clef Flash 64k                                 | **Outdated** for hosted Flash (24k).                                                                      |
| Jev text-only                                  | **Outdated** vs current Images/Box docs.                                                                  |
| Provider prompt caching for Jev/Clef           | **Unsupported** in primary docs (unlike OpenAI Decisions).                                                |

---

## Falsifiable observe experiments (same candidates + negatives)

Align with [OBSERVE_EXPERIMENTS.md](./OBSERVE_EXPERIMENTS.md). Freeze candidates, evidence, and gold sets **before** any model call. One variable per arm. Pin versioned model IDs (`jev-1.14.0`, `@cf/cloudflare/clef`, `clef-flash`). Report wrong direct accepts, false empties, exact-set accuracy, omissions/additions, and risk-coverage — not pass%.

### O1 — One-result: Choice+`none_match` vs Choice+companion Noul vs historical best/strict

- **Predict:** Companion-Noul or `none_match` ≤ wrong accepts of best/strict; companion-Noul fewer false positives on absent tasks than `none_match` alone.
- **Same:** Candidate list, evidence pack, action construction.
- **Negatives:** Absent instruction; near-miss distractors; disabled twins.
- **Kill:** Higher wrong accepts, or positive coverage drop vs control on held-out frozen set.

### O2 — Complete set: pointwise Noul vs top-k Choice mass

- **Predict:** Thresholded independent Nouls (account for every eligible id) beat top-k Choice on exact-set; top-k shows omissions under multi-gold.
- **Same:** Eligible universe; gold set size ≥2 and =0 arms.
- **Negatives:** Gold beyond rank 5; two equally good matches; zero matches.
- **Kill:** Top-k exact-set ≥ pointwise after a pre-registered k and mass rule, without silent truncation.

### O3 — Empty policy: explicit empty vs empty→fallback

- **Predict:** Explicit empty (no fallback) reduces false positives on absent; false-empty rate on positives stays within budget when middle band escalates.
- **Same:** Candidates; provider; wording of relevance question.
- **Kill:** False empties on positives exceed budget, or absent tasks still emit fabricated selectors.

### O4 — Packing: Jev isolated Noul pack vs Clef joint pack (competing candidates)

- **Predict:** On Clef, N independent “is candidate i relevant?” in one request increases wrong includes vs one-at-a-time or vs single Choice; on Jev, batch ≈ split ([parallel questions](https://docs.typesafe.ai/cookbooks/parallel_questions) claim).
- **Same:** Candidate ids and criteria text; only provider + packing.
- **Kill:** Clef joint pack matches split calls on exact-set and wrong includes.

### O5 — Hierarchy: section beam then leaf Nouls vs flat leaf Nouls

- **Predict:** Nested “links in section” tasks: beam/section-first improves recall of gold under near-tied parents.
- **Same:** Leaf candidate universe available to both arms (oracle leaves) so discovery is not confounded.
- **Kill:** Flat equals beam on exact-set at ≤ total tokens.

### O6 — Vision crop: AX-only vs AX+screenshot Choice (Clef or Jev danger-zone)

- **Predict:** Visual-hard one-result subset: image arm cuts wrong accepts; identity map box/crop → node still required.
- **Negatives:** Two same-name icons; empty name controls.
- **Kill:** No wrong-accept reduction, or Flash truncation causes new misses.

### O7 — Confidence portability

- **Predict:** Risk-coverage curves for the O1/O2 winners diverge across Jev vs Clef when a single cutoff is reused.
- **Kill:** Overlapping curves within noise.

### O8 — Arg span after fixed targets (secondary)

- **Predict:** Clairic/Locate over bounded sheet improves fill/select args vs instruction-only inference **given fixed gold targets**.
- **Kill:** Higher wrong args, or high-confidence wrong spans that pass schema (known Locate failure mode).

Do **not** bundle O1–O4 into one run. Provider swaps only after a winning **policy** on one pinned model.

---

## Source index

| URL                                                                          | Used for                                                         | Accessed   |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------------- | ---------- |
| https://docs.typesafe.ai/models                                              | IDs, price, context, aliases, Box on 1.14                        | 2026-11-15 |
| https://docs.typesafe.ai/concepts/state                                      | Shared state, independent questions                              | 2026-11-15 |
| https://docs.typesafe.ai/primitives                                          | Parallel / independent evaluation, no question-count limit       | 2026-11-15 |
| https://docs.typesafe.ai/primitives/choice                                   | Choice distribution, confidence, 255 guidance                    | 2026-11-15 |
| https://docs.typesafe.ai/primitives/noul                                     | Noul semantics, thresholds, multi-Noul                           | 2026-11-15 |
| https://docs.typesafe.ai/primitives/score                                    | Score / composite                                                | 2026-11-15 |
| https://docs.typesafe.ai/primitives/box                                      | Box no abstention, dreamer-ready                                 | 2026-11-15 |
| https://docs.typesafe.ai/images                                              | Danger-zone images, limits                                       | 2026-11-15 |
| https://docs.typesafe.ai/confidence                                          | Formulas; prefer option probability                              | 2026-11-15 |
| https://docs.typesafe.ai/patterns/fan-out                                    | Speculative multi-question                                       | 2026-11-15 |
| https://docs.typesafe.ai/patterns/companion-noul                             | Abstain pattern; multi-Noul note                                 | 2026-11-15 |
| https://docs.typesafe.ai/patterns/probability-routing                        | Risk-scaled thresholds                                           | 2026-11-15 |
| https://docs.typesafe.ai/patterns/composite-scoring                          | Score composition                                                | 2026-11-15 |
| https://docs.typesafe.ai/cookbooks/hierarchical_classification               | Beam / geometric mean                                            | 2026-11-15 |
| https://docs.typesafe.ai/cookbooks/semantic_find                             | Ranking ≠ existence; 255; companion exists                       | 2026-11-15 |
| https://docs.typesafe.ai/cookbooks/infinite_cardinality_choice               | Noul cascade → Choice shortlist                                  | 2026-11-15 |
| https://docs.typesafe.ai/cookbooks/parallel_questions                        | Isolation under batching                                         | 2026-11-15 |
| https://docs.typesafe.ai/introduction/machine-learning-primer                | Calibration intent (marketing+)                                  | 2026-11-15 |
| https://developers.cloudflare.com/workers-ai/models/clef/                    | Schema, 65k, $0.24, images, truncation                           | 2026-11-15 |
| https://developers.cloudflare.com/workers-ai/models/clef-flash/              | 24k, $0.038                                                      | 2026-11-15 |
| https://developers.cloudflare.com/workers-ai/models/clef-omni/               | Omni modalities                                                  | 2026-11-15 |
| https://developers.cloudflare.com/workers-ai/models/clairic/                 | Fields, passes, p_null, guess                                    | 2026-11-15 |
| https://developers.cloudflare.com/workers-ai/concepts/extraction-models/     | Decision vs extraction                                           | 2026-11-15 |
| https://blog.cloudflare.com/clef-decision-models/                            | Joint attention; benchmarks (marketing); outdated Jev-text claim | 2026-11-15 |
| https://blog.cloudflare.com/clef-faster-cheaper-multimodal/                  | Flash 24k cut; price; Omni                                       | 2026-11-15 |
| https://blog.cloudflare.com/clairic-extraction-model/                        | Extraction class; null+guess                                     | 2026-11-15 |
| https://developers.cloudflare.com/changelog/post/2026-10-01-clef-workers-ai/ | Launch; 64 questions; early Flash 64k table                      | 2026-11-15 |

Local: [ACT_PROVIDER_RESEARCH.md](./ACT_PROVIDER_RESEARCH.md), [ACT_DESIGN_AUDIT.md](./ACT_DESIGN_AUDIT.md), [OBSERVE_EXPERIMENTS.md](./OBSERVE_EXPERIMENTS.md), [DECISION_PRIMITIVES.md](./DECISION_PRIMITIVES.md), [vendor-repos/cursor_stagehand_decision_models_review.md](../../../../../vendor-repos/cursor_stagehand_decision_models_review.md).

---

## Limitations of this research

- Pages can change after 2026-11-15; pin versioned model IDs in any later measurement.
- Blog architecture (joint attention) is not an API guarantee; treat as packing hypothesis.
- Clef per-choice option maximum is **undocumented** on Workers AI pages — do not assume 255.
- No live API probes, latency, or observe accuracy numbers were collected in this pass.
- Perplexity Locate / OpenAI Decisions appear only as contrast from local notes; this owned file focuses on TypeSafe + Cloudflare as requested.
- Cookbook thresholds (0.7 / 0.35, etc.) are examples, not Stagehand defaults.
