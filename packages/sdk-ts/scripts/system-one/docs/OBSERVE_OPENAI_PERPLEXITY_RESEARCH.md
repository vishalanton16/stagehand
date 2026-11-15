# Observe research: OpenAI Decisions vs Perplexity Decider/Flash/Locate

Access date for all primary URLs: **2026-11-15**. Research only. Method: public web pages (docs, reference, blogs, cookbooks, GitHub PR/branch pages). No Context7/ctx7. No new experiments, implementation, or commits in this note.

Owned file only. Related local context (read, not edited): [ACT_DESIGN_AUDIT.md](./ACT_DESIGN_AUDIT.md), [ACT_PROVIDER_RESEARCH.md](./ACT_PROVIDER_RESEARCH.md), [OBSERVE_EXPERIMENTS.md](./OBSERVE_EXPERIMENTS.md), [vendor-repos/cursor_stagehand_decision_models_review.md](../../../../../vendor-repos/cursor_stagehand_decision_models_review.md), [vendor-repos/chat-transcript.md](../../../../../vendor-repos/chat-transcript.md).

**Legend**

| Tag             | Meaning                                                                                 |
| --------------- | --------------------------------------------------------------------------------------- |
| **Verified**    | Stated on a primary vendor/docs/PR page fetched or searched on this date                |
| **Inference**   | Architectural implication for Stagehand `observe()`; falsifiable, not vendor-guaranteed |
| **Unsupported** | Claim that lacks primary evidence or conflates products                                 |

---

## 0. Separation rule (do not conflate)

**Verified:** OpenAI and Perplexity each ship a distinct **Decisions** HTTP product.

|                     | OpenAI Decisions                                                                   | Perplexity Decisions                                                                                                            |
| ------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Endpoint            | `POST https://api.openai.com/v1/decisions`                                         | `POST https://api.perplexity.ai/v1/decisions`                                                                                   |
| Evidence field      | `input`                                                                            | `state`                                                                                                                         |
| Yes/no type         | `predicate` → `probability`                                                        | `noul` → `noul`                                                                                                                 |
| Closed pick         | `choice`                                                                           | `choice`                                                                                                                        |
| Ordered rubric      | `score`                                                                            | `score`                                                                                                                         |
| Span extraction     | **Not present** in guide or create schema                                          | `locate` → `spans[]`                                                                                                            |
| Model IDs           | **`gpt-6-luna` only**                                                              | `pplx-decider-v1.3` / `pplx-decider-flash-v1.3` (+ v1.2; aliases `…-latest`)                                                    |
| Max questions       | 1–400                                                                              | ≥1; ≤128 if any `locate`; ≤100 if `web_grounding`                                                                               |
| Choice option count | **2–255** unique                                                                   | **1–255**                                                                                                                       |
| Prompt caching      | First-class (`prompt_cache_key`, breakpoints, ≥1024-token reusable `input` prefix) | Blog describes a **fully cacheable attention mode not used by default**; hosted API does not expose that mode as a request flag |

Sources: [OpenAI Decisions guide](https://developers.openai.com/api/docs/guides/decisions), [OpenAI create reference](https://developers.openai.com/api/reference/resources/decisions/methods/create.md), [Perplexity quickstart](https://docs.perplexity.ai/docs/decisions/quickstart), [Perplexity API reference](https://docs.perplexity.ai/api-reference/decisions-post).

**Unsupported:** Treating “Luna” Responses/Chat Completions as the Decisions API; treating Perplexity `noul`/`locate` docs as OpenAI contracts; treating OpenRouter/gateway wrappers as proof of OpenAI’s native schema.

---

## 1. OpenAI Decisions API (independently verified)

### 1.1 Product status and model

**Verified (GA blog, 2026-10-22):** “Today, we’re making the Decisions API generally available. Built with GPT‑6 Luna…” — [openai.com/index/decisions-api](https://openai.com/index/decisions-api).

**Verified (guide):** “Send requests to `POST /v1/decisions` using `gpt-6-luna`, the only currently supported model.” — [developers.openai.com/api/docs/guides/decisions](https://developers.openai.com/api/docs/guides/decisions).

**Verified (GA since-beta):** prompt caching; images in question instructions; JSON `input_json`; up to **400** questions (was 200 in beta); hosted image URLs; conversation history; GPT-Live integration; US/EU residency. Same guide + blog.

### 1.2 Question types, confidence, refusals

**Verified:**

| Type        | Main result                                  | Confidence                                    |
| ----------- | -------------------------------------------- | --------------------------------------------- |
| `predicate` | `probability` ∈ [0,1]                        | No separate confidence field in create schema |
| `choice`    | selected `choice` + `probabilities[]`        | Separate `confidence`                         |
| `score`     | weighted `score` + per-level `probabilities` | Separate `confidence`                         |

Guide: “Predicates return the estimated probability that a condition is true. Choice and score answers return a probability distribution and a separate `confidence` field.” “Use labeled examples from your application to set thresholds… Choose thresholds based on the cost of false positives and false negatives.”

Create reference: “Any question can return a refusal instead of an answer; other questions can still receive answers. A refusal has `type: \"refusal\"`…”

**Verified (choice cardinality):** “Provide between **2 and 255** choices. Each choice must be unique.” Values may be string or boolean (typed distinctly).

**Verified (score):** levels **2–10**.

**Verified (cookbook intent, via search snippet of [customer_request_routing](https://developers.openai.com/cookbook/examples/decisions/customer_request_routing)):** “Confidence does not guarantee correctness; use labeled data from your application to choose any review threshold.” “A refusal can arrive with a successful HTTP response.” Direct `.md` fetch returned 404 on this date; HTML cookbook URL is the intended primary page.

**Unsupported:** A published OpenAI formula equating `confidence` to Perplexity’s `(p_top - 1/n)/(1 - 1/n)`. OpenAI docs do not state that formula for Decisions.

### 1.3 Batching, context, caching, pricing

**Verified:**

- 1–400 questions share one `input`; “For decisions that depend on an earlier answer, send separate requests.”
- Prompt caching: reusable prefix is shared **`input` only**; “Content in `questions`… is outside the reusable prefix.” Implicit breakpoint at end of `input`; reusable prefix ≥ **1,024 tokens**; `prompt_cache_key` (≤64 chars); explicit breakpoints on input parts; “Breakpoints aren't supported in question instructions.”
- Usage: `usage.input_tokens_details.cached_tokens` / `cache_write_tokens` included in `input_tokens` (do not double-count).
- Pricing (blog + guide): **$0.10 / M** uncached input; cached input discounted (blog: **$0.01 / M** cache hits); **no output-token charges**.

**Inference for observe:** A stable AX/APC candidate pack in `input` (or `input_json`) with many per-candidate `predicate`s in `questions` is the natural OpenAI packing pattern; changing only questions can hit cache if the candidate prefix stays byte-identical and ≥1,024 tokens.

### 1.4 Computer-use ↔ Decisions (act/observe boundary)

**Verified** ([tools-computer-use](https://developers.openai.com/api/docs/guides/tools-computer-use)):

> “Use Responses when the model must choose actions and generate their arguments. Use Decisions only when your application already knows every allowed action and its complete arguments. … Discard choices when the page changes.”

**Inference for observe:** Returning `{selector, method, arguments}` when method/args are **not** pre-enumerated is outside OpenAI’s Decisions contract. Decisions can pick among **complete** observe candidates Stagehand already built; inventing fill strings or unsupported methods is a Responses/LLM job.

### 1.5 What OpenAI Decisions does **not** give observe

**Verified by absence in guide + create schema:** no `locate`/span type; no multi-label “select all that apply” answer type; no empty-set answer type (empty is an **application** policy over probabilities / `other` / refusal); no guarantee of set completeness; no DOM identity.

---

## 2. Perplexity Decisions (Decider / Flash / Locate)

### 2.1 Models, prices, limits

**Verified** ([quickstart](https://docs.perplexity.ai/docs/decisions/quickstart), accessed 2026-11-15):

| Model                     | Alias                       | Size | $/M input | `locate` | Grouping                                           |
| ------------------------- | --------------------------- | ---- | --------- | -------- | -------------------------------------------------- |
| `pplx-decider-v1.3`       | `pplx-decider-latest`       | 27B  | $0.02     | Yes      | Isolated questions; state billed once if pack fits |
| `pplx-decider-flash-v1.3` | `pplx-decider-flash-latest` | 4B   | $0.01     | Yes      | Same as v1.3 Decider                               |
| `pplx-decider-v1.2`       | —                           | 27B  | $0.02     | No       | Full cross-question attention                      |
| `pplx-decider-flash-v1.2` | —                           | 4B   | $0.01     | No       | Each question alone; state re-billed               |

Context: **256K** for state + each question’s share. Body ≤ **32 MiB**. Choice **1–255** options; score **1–10** levels (docs: use ≥2 meaningfully). Org **10 rps**; Decider 15M TPM / Flash 4M TPM. Auth: `Authorization: Bearer` only (`x-api-key` → 401).

**Verified docs inconsistency:** quickstart intro still says Flash “evaluates each separately and bills the state once per question”; the **Grouping** section states Flash **v1.3** groups like Decider v1.3. Prefer Grouping + changelog over the intro sentence ([ACT_PROVIDER_RESEARCH.md](./ACT_PROVIDER_RESEARCH.md) already flags this).

**Verified:** response `model` echoes the **requested** name (alias stays alias). Pin versioned IDs for threshold work.

### 2.2 `noul` / `choice` / `score` / confidence

**Verified:**

- `noul`: probability of yes/true; “Values near 0.5 mean the model is unsure.” Needs instructions and/or criteria; neither → 400.
- `choice` confidence: `(p_top - 1/n) / (1 - 1/n)`.
- `score` confidence: `1 - spread / baseline` (spread = Σ p_i·|i−top|).
- “A `choice` with one option or a `score` with one level has a `confidence` of 1.”

Cookbook ([ticket triage](https://docs.perplexity.ai/docs/cookbook/examples/decisions-api-ticket-triage/README)): “`confidence` is the API's own certainty estimate for the pick. It is not `max(probabilities)`…”

### 2.3 `locate` (critical for observe _arguments_, not element IDs)

**Verified** (quickstart + [blog 2026-11-12](https://www.perplexity.ai/hub/blog/perplexity-decider)):

- Returns verbatim `spans[{start,end,text,score}]` or **`[]` when nothing matches**.
- Only v1.3 / flash-v1.3; string `state` only; no images; ≤128 questions in a request that includes locate; no `web_grounding`.
- Trained ≤8K tokens; evaluated ≤32K; longer accepted **unmeasured**.

**Inference:** Empty `spans` is a first-class **absence** signal for text grounding. It does **not** select Stagehand element IDs or authorize a click. Local extract history (transcript / OBSERVE_EXPERIMENTS): Locate can return high-score wrong spans; offsets ≠ semantic fitness.

### 2.4 Caching / attention (blog vs API)

**Verified (blog):** three attention patterns; v1.3 = isolated questions; “Fully cacheable: The state only attends to itself… We don't use it by default… a small fine-tuning can switch a model to it.”

**Unsupported for product planning:** assuming hosted Perplexity Decisions gives OpenAI-style prompt-cache discounts on Stagehand snapshots without that fine-tune / API knob.

### 2.5 Web grounding

**Verified:** optional `mode: "web_grounding"`; irrelevant for in-browser observe over a Stagehand snapshot; conflicts with `locate`. Do not use for observe candidate scoring.

---

## 3. Observe contract vs what each API can answer

From [OBSERVE_EXPERIMENTS.md](./OBSERVE_EXPERIMENTS.md) workload split:

| Observe workload                                   | OpenAI Decisions fit                                                                        | Perplexity fit                                                                                    |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| One specific element among **complete** candidates | `choice` + explicit none/`other`, or pointwise `predicate`                                  | `choice` + none, or `noul` per candidate                                                          |
| Several / all matching elements                    | Batched `predicate` (or many choices) over **accounted** candidates; app unions accepts     | Same; v1.3 isolation helps independence; v1.2 grouping **hurts** competing candidates (docs warn) |
| Absent target                                      | App policy: none option, low `probability`/`noul`, or refusal → empty                       | Same; Locate `[]` only for **text** absence                                                       |
| Ambiguous                                          | Dual high probs / low confidence / refusal → escalate                                       | Same; cookbook notes confidence drops when runner-up is close                                     |
| No instruction (future actions)                    | Poor primary fit unless Stagehand **enumerates** interactives and asks relevance predicates | Same                                                                                              |
| Method + arguments                                 | Only if method/args already grounded in code                                                | Locate may ground **literal** args from instruction/page text; not method invention               |
| Scoped / framed                                    | Representation problem in Stagehand, not in Decisions                                       | Same                                                                                              |

**Verified OpenAI CU rule** reinforces: Decisions after enumeration of complete actions/args; Responses when generation is required.

---

## 4. Historical observer and stack: what not to copy

Public PR pages (all **open** as of fetch 2026-11-15), Browserbase/stagehand:

| PR                                                          | URL                      | Observe-relevant fact                                        | Do **not** copy blindly                                     |
| ----------------------------------------------------------- | ------------------------ | ------------------------------------------------------------ | ----------------------------------------------------------- |
| [#2951](https://github.com/browserbase/stagehand/pull/2951) | editableIds side channel | Contenteditable ≠ role; outline/cache keys unchanged         | Treating editableIds as LLM-visible evidence                |
| [#2952](https://github.com/browserbase/stagehand/pull/2952) | tree + pick              | Dual `best`+`strict`; prune >40→30; twins share vote; shards | Dual-question picker as default; thresholds tuned on Jev    |
| [#2953](https://github.com/browserbase/stagehand/pull/2953) | act tree                 | Intent without snapshot; LLM fallback                        | Free-form intent tree as proof of observe set quality       |
| [#2954](https://github.com/browserbase/stagehand/pull/2954) | **observe + cacheCheck** | See below                                                    | Empty→fallback; batch 60; caps 400/600; dual pick for “one” |
| [#2955](https://github.com/browserbase/stagehand/pull/2955) | extract pick-and-copy    | Pick+copy pattern                                            | Using extract completeness as observe set completeness      |
| [#2988](https://github.com/browserbase/stagehand/pull/2988) | WebMCP tools             | Closed tool choice                                           | Tool catalog heuristics as observe element discovery        |
| [#2993](https://github.com/browserbase/stagehand/pull/2993) | settle/snapshot overlap  | Observe intent overlaps snapshot capture                     | Claiming latency wins without settle in the clock           |

### 4.1 #2954 observer design (primary “old observer”)

**Verified from PR body:**

- No instruction → every interactive (LLM above **400**).
- Else intent + cardinality: **“one”** uses act picker; **“several”** per-candidate yes/no in batches of **60** (LLM above **600**).
- “‘Find all’ is answered exhaustively or handed to the LLM, **never truncated**.”
- Method from explicit intent first, else role. Abstention → LLM observe.
- cacheCheck: one yes/no before replay; stale throws to re-inference; errors/timeouts never block replay; threshold **0.35** from probes; **no E2E cache eval**.
- Reported observe suite: baseline **9/12** → **10/12**; **11/16** decisions observes at **0.18 s** vs baseline **1.99 s**; **5/16** LLM; **7/12** with LLM disabled.

**Preserved historical control knobs** ([OBSERVE_EXPERIMENTS.md](./OBSERVE_EXPERIMENTS.md)): thresholds **0.7/0.6**; empty relevant sets **fall back**; do not quietly “fix” the control mid-comparison.

### 4.2 Act wins ≠ observe set completeness

**Verified local synthesis** (review + OBSERVE_EXPERIMENTS + ACT_DESIGN_AUDIT):

- Compact **choice+none** cut wrong accepts on **single-target** fixtures; that measures **one** selection, not exact-set recall.
- Extraction repeatedly accepted incomplete lists; schema/span validity ≠ completeness.
- “Narrow target choices helped act, but did not prove multi-result discovery.”
- Joint op+target **hurt** coverage (22/28 vs 28/28 in prior fixtures)—extra inference steps add failure modes.

**Inference:** Reusing #2952/#2953 pick policies for observe “several/all” without **full candidate accounting** and exact-set graders is an unsupported leap.

### 4.3 Method / argument semantics (what not to invent)

**Verified #2954:** method from intent or role—not free generation of unsupported Playwright methods.

**Verified OpenAI CU:** Decisions only when **complete arguments** already known.

**Inference:** Observing `fill` with a fabricated value to make `observe→act` “work” violates both vendor guidance and OBSERVE_EXPERIMENTS (“Do not invent a fill value just to make an observation executable”).

**Unsupported method arguments:** any Decisions answer that invents xpath args, drag targets, or file paths without Stagehand-grounded spans/IDs.

### 4.4 prompt-loc branch (public)

**Verified:**

- Branch page: [github.com/browserbase/stagehand/tree/prompt-loc](https://github.com/browserbase/stagehand/tree/prompt-loc).
- Tip (GitHub API, 2026-11-15): `118d74c4ac` (2026-11-12, “add tests”).
- Raw [`promptLocator.ts`](https://raw.githubusercontent.com/browserbase/stagehand/prompt-loc/packages/extension/understudy/promptLocator.ts): known locator **operation** → APC candidates scoped by op → `DecisionChooseParams { prompt, action, candidates }` → statuses `no_match` | `refused` | selected `id`; identity snapshotted **before** choose; invalid id → error.

**Local prior (ACT_DESIGN_AUDIT, not re-measured here):** 12/12 checkout clicks, one decision call, ~1.26–1.54 s median vs free-form act ~1.83–2.02 s on same fixture.

**Inference for observe:** prompt-loc is a **known-operation single-target resolver**, not a multi-result observer. Copy the “operation known → complete candidates → one choose + none/refuse” shape for one-element observe; do **not** treat its click success as complete-set observe proof.

---

## 5. First-principles challenges

1. **Act accuracy ≠ observe set completeness.** A correct single click does not establish that “find all X” returned every match and only those matches.
2. **Full candidate accounting is Stagehand’s job.** Predicates/choices over a pruned top-30 cannot recover gold past the prune; missing gold is a **discovery** failure even if the model is confident.
3. **No instruction semantics are enumeration + filter, not free discovery.** #2954’s interactive dump is a baseline; relevance filtering still needs an exact required/allowed/forbidden contract ([OBSERVE_EXPERIMENTS.md](./OBSERVE_EXPERIMENTS.md)).
4. **Unsupported method/arguments must not be Decisions outputs.** OpenAI: complete args known; Perplexity Locate: verbatim substrings only; role→method maps belong in code.
5. **Absence must be first-class.** Empty relevant set falling back to Luna (#2954) conflates “correctly nothing” with “model unsure.” Prefer explicit none / low noul / Locate `[]` / refusal → graded empty vs escalate.
6. **Provider confidence is not portable.** Perplexity publishes a formula; OpenAI does not; Clef/Jev differ (review). Freeze per-provider gates.
7. **Batching semantics differ.** OpenAI: up to 400 predicates on shared cached `input`. Perplexity v1.3: isolated questions, mild state coupling—freeze packs. Perplexity v1.2: do not pack competing candidates. OpenAI does not document cross-question attention for Decisions.
8. **Evidence > provider.** Review: oracle regions pass for all models including Luna; auto cards fail for all. Swapping in OpenAI Decisions will not fix missing destinations / bad twins.

---

## 6. Prioritized falsifiable comparisons (observe)

Same frozen evidence; **one variable**; include negatives (absent, ambiguous, empty scope). Controls: ordinary Luna observe + historical #2954 observer at pinned revision (see OBSERVE_EXPERIMENTS). Prefer Decider v1.3 and/or OpenAI `gpt-6-luna` Decisions as the System One arm—**separate provider rows**, never blended.

### P1 — One-result selection policy

|                |                                                                                                                         |
| -------------- | ----------------------------------------------------------------------------------------------------------------------- |
| **Arms**       | Historical best/strict vs single `choice`+`none_match` (OpenAI or Perplexity) vs pointwise `predicate`/`noul` threshold |
| **Fixed**      | Same candidates, same method construction, same provider within an arm pair                                             |
| **Hypothesis** | Single choice+none ≤ wrong accepts of best/strict at ≥ positive coverage                                                |
| **Falsify if** | Wrong accepts rise, or recall of gold one-target falls on held-out never used for wording                               |

### P2 — Complete-set recall with full accounting

|                |                                                                                                                         |
| -------------- | ----------------------------------------------------------------------------------------------------------------------- |
| **Arms**       | Per-candidate predicates over **entire** eligible set vs group-then-filter vs #2954 batch-60 several-path               |
| **Fixed**      | Same eligibility function; no silent top-N “all”                                                                        |
| **Hypothesis** | Exhaustive predicates achieve exact-set accuracy ≥ group routing without omitting gold                                  |
| **Falsify if** | Any silent omission, extra match, or group discard of a matching group; or budget forces truncation labeled as complete |

### P3 — Absence / empty / ambiguous

|                |                                                                                                   |
| -------------- | ------------------------------------------------------------------------------------------------- |
| **Arms**       | Explicit none + calibrated abstain vs #2954 empty→LLM fallback                                    |
| **Fixed**      | Same candidates (including empty eligible sets)                                                   |
| **Hypothesis** | Explicit empty reduces false positives on absent tasks without raising false empties on positives |
| **Falsify if** | False empty on positive, or false positive on absent, beyond pre-registered rates                 |

### P4 — OpenAI Decisions vs Perplexity Decider on identical packs

|                |                                                                                                                             |
| -------------- | --------------------------------------------------------------------------------------------------------------------------- |
| **Arms**       | `gpt-6-luna` Decisions (`predicate`/`choice`) vs `pplx-decider-v1.3` (`noul`/`choice`)                                      |
| **Fixed**      | Same candidate JSON/`input_json`↔`state`, same none policy, same thresholds **recalibrated per provider on a freeze split** |
| **Hypothesis** | Wrong-accept and exact-set curves match within margin; OpenAI shows nonzero `cached_tokens` when prefix ≥1024 and stable    |
| **Falsify if** | OpenAI wrong accepts higher at matched none policy; or cache reads stay ~0 under stable prefix discipline                   |

### P5 — Representation (not model): AX compact vs APC (prompt-loc style) vs full outline

|                |                                                                                                       |
| -------------- | ----------------------------------------------------------------------------------------------------- |
| **Arms**       | Three evidence packs; **winning** selection policy from P1 fixed                                      |
| **Hypothesis** | Contextual compact/APC improves one-target and set precision without losing gold in the candidate set |
| **Falsify if** | Gold missing from APC more often, or wrong accepts not improved after matching eligibility            |

### P6 — Method/args construction

|                |                                                                                                                          |
| -------------- | ------------------------------------------------------------------------------------------------------------------------ |
| **Arms**       | Code-built method from role/intent + Locate/quoted span for fill args vs instruction-only intent inference (#2954-style) |
| **Fixed**      | Selected element IDs                                                                                                     |
| **Hypothesis** | Code+Locate reduces invented args and wrong methods vs intent-only                                                       |
| **Falsify if** | Higher wrong-method/wrong-arg rate, or Locate high-score wrong spans pass the gate                                       |

### P7 — No-instruction discovery

|                |                                                                                                                 |
| -------------- | --------------------------------------------------------------------------------------------------------------- |
| **Arms**       | Deterministic interactive enumeration vs model relevance filter vs Luna observe                                 |
| **Hypothesis** | Deterministic enum ≥ required-set recall; model filter improves allowed-set precision without dropping required |
| **Falsify if** | Required future actions missing, or unusable/duplicates added beyond budget                                     |

### P8 — Historical observer latency claim under honest clocks

|                |                                                                                                       |
| -------------- | ----------------------------------------------------------------------------------------------------- |
| **Arms**       | #2954 path vs Luna vs P1 winner; measure selection-only **and** full SDK observe including snapshot   |
| **Hypothesis** | Decisions cut selection latency; full observe p50 improvement survives settle/snapshot (#2993 lesson) |
| **Falsify if** | Selection-only win disappears in full SDK p50/p95 including fallback                                  |

**Do not** score P4 and P5 in the same change. **Do not** transfer Jev 0.7/0.6 or cacheCheck 0.35 to OpenAI/Perplexity without a calibration sweep.

---

## 7. Brief quotes (primary)

| Source                                                                                                                                             | Date on page / access          | Quote                                                                                                                                                         |
| -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [OpenAI Decisions guide](https://developers.openai.com/api/docs/guides/decisions)                                                                  | accessed 2026-11-15            | “using `gpt-6-luna`, the only currently supported model.”                                                                                                     |
| Same                                                                                                                                               |                                | “Ask multiple questions… Include between 1 and 400 questions in a request.”                                                                                   |
| Same                                                                                                                                               |                                | “Content in `questions`… is outside the reusable prefix.” / “reusable prefix must contain at least 1,024 tokens”                                              |
| [OpenAI create](https://developers.openai.com/api/reference/resources/decisions/methods/create.md)                                                 | accessed 2026-11-15            | “Provide between 2 and 255 choices.” / “Any question can return a refusal…”                                                                                   |
| [OpenAI GA blog](https://openai.com/index/decisions-api)                                                                                           | 2026-10-22                     | “making the Decisions API generally available” / “$0.10 per million input tokens” / “Cached input costs $0.01 per million tokens” / “no output-token charges” |
| [Computer use](https://developers.openai.com/api/docs/guides/tools-computer-use)                                                                   | accessed 2026-11-15            | “Use Decisions only when your application already knows every allowed action and its complete arguments.” / “Discard choices when the page changes.”          |
| [Cookbook routing](https://developers.openai.com/cookbook/examples/decisions/customer_request_routing)                                             | accessed via search 2026-11-15 | “Confidence does not guarantee correctness…”                                                                                                                  |
| [Perplexity quickstart](https://docs.perplexity.ai/docs/decisions/quickstart)                                                                      | accessed 2026-11-15            | “When nothing matches, `spans` is `[]`.” / choice confidence formula `(p_top - 1/n)/(1 - 1/n)`                                                                |
| Same                                                                                                                                               |                                | “Each question sees the `state` and its own text, not the other questions.” (v1.3)                                                                            |
| [Perplexity blog](https://www.perplexity.ai/hub/blog/perplexity-decider)                                                                           | 2026-11-12                     | “Fully cacheable… We don't use it by default…”                                                                                                                |
| [Perplexity triage cookbook](https://docs.perplexity.ai/docs/cookbook/examples/decisions-api-ticket-triage/README)                                 | accessed 2026-11-15            | “It is not `max(probabilities)`…”                                                                                                                             |
| [#2954](https://github.com/browserbase/stagehand/pull/2954)                                                                                        | PR text; updated 2026-10-04    | “‘Find all’ is answered exhaustively or handed to the LLM, never truncated.”                                                                                  |
| [promptLocator.ts @ prompt-loc](https://raw.githubusercontent.com/browserbase/stagehand/prompt-loc/packages/extension/understudy/promptLocator.ts) | tip `118d74c4ac` 2026-11-12    | Resolve terminal prompt via `choose(params)` with pre-snapshotted candidate identity                                                                          |

---

## 8. Citation index

| Topic                               | URL                                                                                                               | Accessed                            |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| OpenAI Decisions guide              | https://developers.openai.com/api/docs/guides/decisions                                                           | 2026-11-15                          |
| OpenAI Decisions create             | https://developers.openai.com/api/reference/resources/decisions/methods/create.md                                 | 2026-11-15                          |
| OpenAI Decisions GA                 | https://openai.com/index/decisions-api                                                                            | 2026-11-15                          |
| OpenAI computer use ↔ Decisions     | https://developers.openai.com/api/docs/guides/tools-computer-use                                                  | 2026-11-15                          |
| OpenAI Decisions cookbook (routing) | https://developers.openai.com/cookbook/examples/decisions/customer_request_routing                                | 2026-11-15 (search; `.md` twin 404) |
| OpenAI prompt caching guide         | https://developers.openai.com/api/docs/guides/prompt-caching                                                      | cited from Decisions guide          |
| Perplexity Decisions quickstart     | https://docs.perplexity.ai/docs/decisions/quickstart                                                              | 2026-11-15                          |
| Perplexity Decisions API ref        | https://docs.perplexity.ai/api-reference/decisions-post                                                           | 2026-11-15                          |
| Perplexity Decider blog             | https://www.perplexity.ai/hub/blog/perplexity-decider                                                             | 2026-11-15 (page date 2026-11-12)   |
| Perplexity triage cookbook          | https://docs.perplexity.ai/docs/cookbook/examples/decisions-api-ticket-triage/README                              | 2026-11-15                          |
| Perplexity changelog                | https://docs.perplexity.ai/docs/resources/changelog                                                               | 2026-11-15                          |
| PR #2951 … #2993                    | https://github.com/browserbase/stagehand/pull/2951 … /2993                                                        | 2026-11-15                          |
| prompt-loc tree                     | https://github.com/browserbase/stagehand/tree/prompt-loc                                                          | 2026-11-15                          |
| promptLocator.ts raw                | https://raw.githubusercontent.com/browserbase/stagehand/prompt-loc/packages/extension/understudy/promptLocator.ts | 2026-11-15                          |

Local (context only): [ACT_DESIGN_AUDIT.md](./ACT_DESIGN_AUDIT.md), [ACT_PROVIDER_RESEARCH.md](./ACT_PROVIDER_RESEARCH.md), [OBSERVE_EXPERIMENTS.md](./OBSERVE_EXPERIMENTS.md), [vendor-repos/cursor_stagehand_decision_models_review.md](../../../../../vendor-repos/cursor_stagehand_decision_models_review.md), [vendor-repos/chat-transcript.md](../../../../../vendor-repos/chat-transcript.md).

---

## 9. Bottom line for observe design

**Verified:** OpenAI Decisions is a real, separate `POST /v1/decisions` product on `gpt-6-luna` with predicate/choice/score, refusals, 400-question packs, and prompt caching—**no locate**. Perplexity Decisions is a separate `POST /v1/decisions` with noul/choice/score/**locate**, published confidence formulas, and empty spans for text absence.

**Inference:** Stagehand should own candidate discovery, eligibility, method maps, and exact-set accounting; either Decisions API answers **narrow, complete, verifiable** questions. Use OpenAI when cacheable large predicate packs matter; use Perplexity when Locate empty-span absence or Flash cost matters; never score them as one arm.

**Unsupported:** Claiming observe parity from act fixture wins, from #2954’s 10/12 suite alone, or from conflating Luna-the-LLM with Luna-on-Decisions.
