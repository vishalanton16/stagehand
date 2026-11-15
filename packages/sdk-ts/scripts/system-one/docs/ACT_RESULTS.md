# Action experiment results

Current cleanup status: see [CLEANUP_RESULTS.md](./CLEANUP_RESULTS.md). Prototype flags and source paths below describe the measured pre-cleanup implementations unless stated otherwise. Historical results and caveats are preserved.

Measured 2026-11-15. The new opt-in `act: "plans"` selects one complete action, including its operation, target and literal arguments. It checks the selected node's identity and evidence before input. Execution checks also cover Luna fallback, including disabled and readonly controls. Ordinary `act()` and the default experimental action tree keep their existing behavior.

On the final paired live comparison, Flash with this policy matched Luna on all 27 runs, with 56% lower SDK action median and 62% lower estimated uncached model cost. These are nine tasks on three domains, repeated three times. The result supports this bounded experimental policy, not a general browser-agent accuracy claim.

## Research changed the design

Read [provider research](./ACT_PROVIDER_RESEARCH.md) and [the older implementation audit](./ACT_DESIGN_AUDIT.md) for primary-source links. Research used web sources, with no Context7 calls in this work.

- OpenAI has a distinct [Decisions API](https://developers.openai.com/api/docs/guides/decisions). Its [computer-use guidance](https://developers.openai.com/api/docs/guides/tools-computer-use) describes decisions over already enumerated actions and complete arguments. This does not require the caller to supply the operation if code can enumerate complete alternatives itself.
- The old joint experiment asked separate conditional intent and target questions. The new policy asks one choice over complete click and literal-fill actions. It does not generate arguments or combine independently predicted facets.
- Question isolation, billing and confidence differ by provider and version. Keep model IDs pinned and evaluate the same logical question before changing providers.
- A successful executor call is insufficient evidence of a correct action. Link destinations, element identity, eligibility and observed effects all mattered in these experiments.

OpenAI Decisions was researched but not benchmarked or added as a provider. This environment had a gateway key for Luna Responses, but no direct OpenAI API key. Clairic and Locate remain readers rather than action-target selectors in this implementation.

## Frozen development comparison

Captured Wikipedia, Python documentation, MDN, Hugging Face models and TodoMVC once. Fifteen tasks covered ten positive requests and five absent targets. Instructions preceded capture; target labels and graders were frozen before inference. Wikipedia's Commons label was narrowed during the pre-inference review to exclude an unrelated banner link.

| Known-operation policy, same eligible shortlist | Correct selections or abstentions | Wrong accepted selections |
| ----------------------------------------------- | --------------------------------: | ------------------------: |
| Original best/strict picker                     |                             24/30 |                         6 |
| Single target choice with no-match              |                             26/30 |                         2 |

Both questions in the original picker share one HTTP request. This comparison does not establish a two-request saving. The complete-action policy initially also accepted two wrong Commons selections. Destination evidence was missing, and it selected the logo file link instead of the sister-project link.

Adding the link destination fixed all three targeted rounds. The otherwise identical no-destination arm failed all three. This set then became regression evidence. Archive: `runs/act/dev-replay-destination-control/`.

The initial replay's free-form grading is diagnostic only. It marked one valid Luna `type` as wrong against an expected `fill`, and could not faithfully execute the old tree's intermediate Hugging Face step. The later live graders check page outcomes and do not inherit those method-only penalties.

The first five-page live comparison passed 30/30 for Luna and the new Decider policy, versus 26/30 for the old tree. The old tree twice selected Python's download link for a missing publish request and twice selected the Commons logo file. New-policy action p50/p95 was 1.77/5.42 s versus Luna's 2.83/5.50 s. This is development evidence.

## First confirmation exposed an unsafe handoff

The next batch used Books to Scrape, GOV.UK and Selenium's public form. GOV.UK search was unavailable in the captured initial state and remained excluded before scoring. Native-select label eligibility was corrected before any inference. Nine scored tasks ran three times per arm.

Luna and the new policy each passed 24/27; the old tree passed 23/27. Every arm reported a fill attempt on Selenium's disabled field in all three rounds. The new selector excluded it, then Luna fallback selected it anyway. This is a failed confirmation, retained under `runs/act/confirmation-live-1/`.

The fix checks operation eligibility at execution under `act: "plans"`, including LLM fallback, cached replay and self-heal. Disabled, hidden and readonly targets are rejected before input. Inferred targets also receive a backend-node identity check. The targeted disabled-input and native-select follow-up passed 4/4. This batch is now regression evidence.

The disabled-case failure counts an accepted/reported fill on an ineligible control. It is not a claim that every attempted fill changed the disabled field's value.

## Second fresh confirmation

Nine tasks on Rust's site, Django's site and The Internet ran three times per arm. These domains were unused in action development. Books to Scrape and several earlier development domains had already appeared in extraction research; none of those results are presented as unseen across the whole project.

The second batch included navigation, a number input, a delayed enable-button effect, absent controls and an explicitly disabled input that must remain unchanged. Django's download selector was corrected for absolute links before inference. The disabled instruction was clarified before inference, then the entire batch was recaptured and frozen. No policy tuning followed these results.

| SDK arm                        | Positive actions | Negative cases | Action p50 / p95 | With outcome check p50 / p95 | Uncached estimate per 1,000 |
| ------------------------------ | ---------------: | -------------: | ---------------: | ---------------------------: | --------------------------: |
| Luna                           |            18/18 |            9/9 |    2.46 / 4.13 s |                3.06 / 5.42 s |                      $0.323 |
| Old Decider tree + Luna        |            18/18 |            6/9 |    2.36 / 5.05 s |                3.23 / 5.41 s |                      $0.315 |
| Complete-action Decider + Luna |            18/18 |            9/9 |    1.28 / 3.13 s |                1.68 / 4.06 s |                      $0.140 |

All 18 positive runs in the new policy completed directly. Its nine fallbacks came from negative tasks. The old tree's three failures were disabled-input attempts. Archive: `runs/act/confirmation2-live/`.

## Flash follow-up with a new paired Luna control

Kept the policy, threshold and tasks fixed; switched only the decision model to `pplx-decider-flash-v1.3`. This is a model follow-up on the same workload, not another independent held-out set.

| SDK arm                      | Passed | Direct positive actions | Fallbacks | Action p50 / p95 | With outcome check p50 / p95 | Uncached estimate per 1,000 |
| ---------------------------- | -----: | ----------------------: | --------: | ---------------: | ---------------------------: | --------------------------: |
| Luna, paired control         |  27/27 |                   18/18 |         — |    2.31 / 3.21 s |                2.71 / 5.15 s |                      $0.320 |
| Complete-action Flash + Luna |  27/27 |                   18/18 |      9/27 |    1.01 / 2.74 s |                1.61 / 3.90 s |                      $0.121 |

Relative to its paired Luna control, Flash reduced SDK action median by 56%, action p95 by 15%, and uncached model-cost estimate by 62%. With outcome checks included, median fell 40% and p95 fell 24%. With reported cache reads, estimated cost was $0.083 versus $0.240 per 1,000, excluding unreported cache-write charges. Archive: `runs/act/flash-live-comparison/`.

SDK action timing includes settle, snapshot, selection, guards, input and any fallback. Separate outcome timing also includes the grader wait, including delayed enablement. Initial navigation, setup and screenshots are outside action timing. Percentiles use nearest rank; repeated rounds measure consistency, not 27 independent pages.

## Live stale-target regression

Two controlled cases changed the page while inference was pending: replace a button at the same XPath, and reuse the same node with a different label and effect. The intended action was Open reports; the changed control was Delete records. Each case ran twice per arm.

| Arm                     | Rejected changed target without the wrong effect |
| ----------------------- | -----------------------------------------------: |
| Luna                    |                                              0/4 |
| Old Decider tree        |                                              0/4 |
| Complete-action Decider |                                              4/4 |

Both baseline arms produced the deliberately wrong effect in every trial. The new path rejected the old selection and let Luna inspect the changed page. These are injected mutations on controlled HTML, separate from untouched public-page accuracy. Archive: `runs/act/stale-target-live/`.

## Workflows and other providers

Two live workflows ran twice per arm: create, complete and filter a todo; navigate from Django's homepage to its first tutorial. Every scored step used the same natural-language instruction across arms. No manual navigation or selector substituted for a failed step. All three arms passed 4/4 workflows.

| Arm                     | Workflow p50 / p95 | Uncached estimate per 1,000 workflows |
| ----------------------- | -----------------: | ------------------------------------: |
| Luna                    |     5.53 / 10.40 s |                                $1.174 |
| Old Decider tree        |      3.34 / 4.06 s |                                $0.141 |
| Complete-action Decider |      2.82 / 6.42 s |                                $0.152 |

The new policy did not beat the old tree's workflow tail or cost here. Its Enter step required Luna fallback. These four runs per arm are a smoke check, not a general workflow benchmark. Archive: `runs/act/live-workflows/`.

On the same development snapshots with destinations and the shared `0.7` gate, Flash accepted 18/20 positive runs correctly, Jev accepted 16/20, and Clef Flash accepted 1/20. All three accepted no wrong selections and correctly abstained on all ten negative runs. These are standalone decisions without fallback. Missing positive selections are coverage losses. Do not infer a provider ranking without calibrating gates independently. Archives: `provider-decider-flash`, `provider-jev-pinned`, `provider-clef-flash` under `runs/act/`.

## Editable-control compatibility

A final controlled smoke check found that both plaintext and nested contenteditable roots were omitted from the useful AX outline. The first implementation failed both editor tasks, while correctly refusing a readonly input. DOM facts now recover top-level editable roots with their real labels, backend IDs and document position. The fixed public-SDK run passed all three controls. This is a separate compatibility regression, not another fresh-page accuracy result. Archives: `control-compatibility` and `control-compatibility-fixed` under `runs/act/`.

## What ships and what remains bounded

Use the existing namespace:

```ts
experimentalDecisions: {
  provider: "perplexity",
  model: "pplx-decider-flash-v1.3",
  apiKey: process.env.PERPLEXITY_API_KEY!,
  act: "plans",
}
```

Call `stagehand.experimentalDecisions.act(instruction, { page })`. The candidate enumerates clicks and fills whose literal arguments or declared variable placeholders are available. It includes link destinations and row/heading context, excludes ineligible controls and offers explicit no-match. Other operations, missing arguments and uncertainty use the configured LLM fallback. `llmFallback: false` keeps abstentions local.

The current shortlist keeps up to 30 candidates per operation. An oversized argument/action product escalates rather than silently dropping arguments. Unsupported frame/shadow evidence also escalates. Python's duplicate search inputs still require fallback in the tested policy. Tools and early target readiness retain the existing tree when enabled. New pre-input checks remain mandatory for the plan policy; `verify` still controls its existing post-input checks.

The old tree is the default. Keep this mode opt-in while broadening layouts, ambiguous instructions, rich editors, frames and multi-step actions. No model was fine-tuned. Production code contains no domain, task-name or answer-specific branches.

## Reproduction and archives

See [the action runner README](../act/README.md). Raw runs are local under `vendor-repos/system-one-corpus/runs/act/`, including snapshots, screenshots, labels, usage and manifests. That existing vendor directory is gitignored. The [committed summary](../act/results/2026-11-15.json) preserves scored aggregates and provenance without committing the whole browser corpus.

Cost estimates use the 2026-11-15 [OpenAI](https://developers.openai.com/api/docs/pricing), [Perplexity](https://docs.perplexity.ai/docs/getting-started/pricing), [TypeSafe](https://docs.typesafe.ai/models) and [Cloudflare](https://developers.cloudflare.com/workers-ai/models/clef-flash/) rate cards. They include reported model calls and retries, not browser charges, gateway fees or unreported cache writes. They are estimates, not invoices.

Two misconfigured runs remain archived and are excluded from provider/ablation claims: `dev-replay-destination` accidentally enabled destinations in both arms; `provider-jev` actually used Decider. The corrected runs are named above. The abandoned pre-inference `confirmation2-capture-20261115` was superseded by `confirmation2-final-capture-20261115`.

Measurements used parent revision `ca69f2fc2` plus the archived implementation sources. Later cleanup replaced positional helper switches with an options object, bounded oversized action sets and handled inherited/plaintext contenteditable. Focused tests and a rebuilt public-SDK smoke check cover the final source. Archived source hashes distinguish measured implementations from those cleanup changes.

## Verification

The final extension suite passed 945 tests, with 3 skipped and 9 existing todos. TypeScript checks passed for the extension and SDK. Python generated/client model tests passed 261/261, and generated-file consistency, formatting, lint and the extension build passed. The final controlled editor/readonly smoke passed 3/3.
