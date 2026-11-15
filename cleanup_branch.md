# Branch cleanup plan

Historical partial commit scope, November 15: act/extract cleanup is committed separately. Observe retirement is deferred, including its controller/SDK documentation hunks and the legacy picker, tree, argument and action-pipeline dependencies it still imports. The full-cleanup design and validation below describe the complete working-tree candidate, not the narrower committed runtime. Existing observe behavior remains in the partial commit. Its replacement requires separate frozen-snapshot and live-page evidence.

Observe cleanup, November 16: the observer replacement has its own provider research, frozen replay, live SDK confirmation and compatibility checks. The remaining commit includes this replacement and removes its retired picker, action-pipeline, page-state and tool-routing dependencies. See [OBSERVE_RESULTS.md](packages/sdk-ts/scripts/system-one/docs/OBSERVE_RESULTS.md). This measured decision observer supersedes the earlier proposal below to delegate experimental observation directly to the ordinary LLM. The act/extract partial commit remains unchanged.

Execution status: complete for act, extract and observe. Public configuration contains only provider credentials, an optional model and connection metadata. Observation is split into candidate evidence, bounded selection and browser/progress integration; research policies remain in scripts. All historical Markdown and raw evidence are retained. See [cleanup results and remaining limits](packages/sdk-ts/scripts/system-one/docs/CLEANUP_RESULTS.md) for evidence, validation and reproduction. The plan below preserves the original November 15 decisions, including the observation proposal superseded above. Cleanup completion does not certify release readiness.

Written 2026-11-15 against `vishal/experimental-decisions` at `908003861`.
Comparison base: `main` and `origin/main` at `58a6cc149`.

This document plans the next round of work. It does not implement cleanup, change defaults, or certify release readiness.

## Objective

Keep the implementation supported by the recent experiments. Remove superseded runtime paths inherited from Miguel's implementation. Give users one experimental decisions configuration, with provider credentials and an optional model, without asking them to understand `plans`, `map`, gates, compaction, or intermediate experiments.

Preserve every existing Markdown file and all experimental evidence. Simplify code by responsibility, then unify provider access around the operations the retained implementation actually needs. Continue experimentation after this cleanup.

## Two layers currently mixed together

| Layer                                 | Provenance                                            | Contents                                                                                                                                                                                                                                                                  |
| ------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Imported implementation               | Merge `ef5fbb345`, whose second parent is `66fba4546` | Editable snapshot IDs; decision client and target picker; intent-first action tree; observation; cache checks; pick-and-copy extraction and completion judge; WebMCP selection; readiness; provider adapters; SDK namespace and protocol wiring.                          |
| Recent experiments and implementation | Work after the merge, through `908003861`             | Capture/replay tooling; frozen graders and provider research; record map-and-copy extraction; exact-copy and absence fixes; table and compaction experiments; single-call LLM extraction; complete-action selection; target guards; live action and workflow comparisons. |

Age or authorship alone does not decide what to delete. Recent code still depends on useful imported code. Remove superseded algorithms and configuration, retain necessary foundations, and replace mixed modules with focused ones. Do not revert the merge wholesale.

## What the evidence supports

The recent work supports replacing specific older paths. It does not establish universal superiority or 100% action parity.

| Finding                                                                                   | Evidence                                                                                                                                                                     | Consequence                                                                                                                                                               |
| ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Complete-action selection improves the tested click/fill workload over the original tree. | Development live: 30/30 versus 26/30. Second fresh confirmation: 27/27 versus 24/27. New-policy positive actions completed directly.                                         | Use complete-action selection as the retained experimental action policy. Send unsupported operations to the configured LLM instead of preserving a second decision tree. |
| The new checks reject changed targets in controlled tests.                                | Same-XPath replacement and same-node repurposing: new path safely rejected 4/4; the old tree and Luna each produced the wrong effect in 4/4.                                 | Keep identity, eligibility and selected-evidence checks. Apply the necessary checks through fallback, replay and self-heal.                                               |
| The old tree still has useful operation coverage.                                         | All arms passed four short workflows. New Decider workflow p95 was 6.42 s versus 4.06 s for the old tree, with slightly higher estimated cost. Enter required fallback.      | Removing the tree trades native decision coverage for a simpler policy plus LLM fallback. Measure that tradeoff; do not describe it as complete replacement coverage.     |
| Flash is promising for actions.                                                           | Paired Flash comparison: 27/27, action median 1.01 s versus Luna 2.31 s, with 62% lower estimated uncached model cost.                                                       | Keep Flash as an explicit model choice. This nine-task workload does not establish the best model for extraction.                                                         |
| Record map-and-copy fixes measured extraction failures.                                   | Grouping, optional-evidence, exact-copy and scope fixes are documented in INDEX and the extraction experiment record. One seen replay reached 98/98 with zero wrong accepts. | Retain the current mapper and its checks. Seen-set recovery is regression evidence, not an independent held-out claim.                                                    |
| Removing the ordinary extraction completion call removes log-only work.                   | Public SDK comparison: both old and single-call Luna passed 10/12; p95 fell from 5.13 s to 2.37 s.                                                                           | Retain single-call extraction as a separate, reviewable default-path change.                                                                                              |
| Compaction saves tokens but is not yet a settled default.                                 | Frozen single-call replay: compact Luna 46/48, cascade 45/48. Compact Luna was cheaper than the cascade at the observed cache rates. Fresh live confirmation remains open.   | Preserve compaction and its evidence as a benchmark candidate. Do not enable it automatically during cleanup.                                                             |

Sources:

- [Research and findings index](packages/sdk-ts/scripts/system-one/docs/INDEX.md)
- [Action results and limitations](packages/sdk-ts/scripts/system-one/docs/ACT_RESULTS.md)
- [Extraction experiments and archived source references](packages/sdk-ts/scripts/system-one/docs/DECISION_PRIMITIVES.md)
- [Current experiment order](packages/sdk-ts/scripts/system-one/docs/NEXT_STEPS.md)
- [Evaluation rules](packages/sdk-ts/scripts/system-one/docs/EVALUATION.md)
- [Historical implementation audit](packages/sdk-ts/scripts/system-one/docs/ACT_DESIGN_AUDIT.md)
- [Action provider research](packages/sdk-ts/scripts/system-one/docs/ACT_PROVIDER_RESEARCH.md)

Some documents describe earlier checkpoints. Preserve their dated results and add current-status notes where needed. Do not turn earlier regression sets back into held-outs or describe earlier measurements as measurements of the final refactor.

## Preserve evidence before deleting runtime code

1. Keep every existing `.md` file, including research, READMEs and changesets. Update current instructions in place; preserve historical findings, failed runs, caveats and archive references.
2. Keep task definitions, frozen graders, scored summaries, manifests, snapshots, screenshots, request/response records, usage, hashes and measured source versions.
3. Preserve `vendor-repos/chat-transcript.md` and `vendor-repos/cursor_stagehand_decision_models_review.md`.
4. Preserve `packages/sdk-ts/scripts/system-one/act/results/2026-11-15.json` and its provenance.
5. Inventory the raw archives under `vendor-repos/system-one-corpus/runs/`, including `archive/`, `act/` and `plan-validation/`. They are gitignored. A Git commit or Markdown link alone does not back them up.
6. Before removing a baseline runner, confirm that its exact source, dependencies and reproduction instructions are available from an archive or recorded revision. Keep legacy comparisons outside the production import graph.
7. Do not delete or regenerate raw runs to make them match the cleaned code. New verification gets a new run ID and source hash.

The cleanup may retire scripts after preserving reproducibility and updating links. It must not remove the evidence because its production implementation was retired. No credentials belong in evidence bundles.

## Intended public behavior

### One configuration, internal policy selection

Keep the existing explicit experimental namespace for this cleanup. Supplying configuration enables that namespace. Ordinary methods continue to use their normal LLM path. A change that reroutes ordinary `stagehand.act()` automatically is a separate API decision.

Target TypeScript usage after cleanup:

```ts
const stagehand = await Stagehand.create({
  browser,
  model: fallbackModel,
  experimentalDecisions: {
    provider: "perplexity",
    apiKey: process.env.PERPLEXITY_API_KEY!,
    model: "pplx-decider-v1.3",
  },
});

await stagehand.experimentalDecisions.act("Open the tutorial");
await stagehand.experimentalDecisions.extract("Extract the products", ProductSchema);
```

This is the target contract, not the current branch's default behavior. Today callers still need `act: "plans"` and `extract: "map"` to select these implementations.

- An omitted provider will mean Perplexity, changed deliberately from today's TypeSafe default. State that migration in release-facing docs.
- The proposed shared default model is pinned `pplx-decider-v1.3`, subject to the final paired validation. It has broader extraction evidence than selecting Flash solely from the action results.
- Callers may explicitly choose `pplx-decider-flash-v1.3`. That model must be checked on both operations before recommending it for both.
- One supplied model applies to the retained operations. Do not silently substitute a different paid model per operation or introduce public operation-specific model settings in this cleanup.
- The ordinary `model` configuration or existing gateway provides LLM fallback. A decision-provider API key does not supply LLM credentials. Missing fallback configuration must produce a clear failure when fallback is needed.
- Python exposes the same behavior through `experimental_decisions`, with its normal naming conventions.
- Preserve method arguments, result shapes, page/locator handling, variables, timeout behavior and cache controls from the ordinary SDK methods.
- Keep `experimentalDecisions.observe()` compatible by delegating to ordinary LLM observation after removing the older decision observer. A new decision observer needs its own evidence before promotion. Document this route honestly.

The minimal public configuration is provider, API key, optional model and provider-required connection metadata. Cloudflare still needs an account ID or an equivalent account-scoped endpoint. An opaque API key cannot reliably identify its provider. Do not promise identical native coverage across providers.

### Configuration disposition

| Existing option or control                                                                    | Target disposition                                                                                                                                                                                        |
| --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `provider`, `apiKey`, `model`                                                                 | Public connection configuration. Lead examples and defaults with pinned Perplexity Decider.                                                                                                               |
| `accountId`                                                                                   | Public only where the provider requires it. Validate at creation.                                                                                                                                         |
| `apiUrl`                                                                                      | Retain only if needed for an existing supported endpoint override. Keep HTTPS validation; do not add endpoint settings merely for experiments.                                                            |
| `act: "tree" \| "plans"`                                                                      | Remove from public configuration. Complete-action selection is internal.                                                                                                                                  |
| `extract: "judge" \| "pick" \| "native" \| "map"`                                             | Remove from public configuration. Map-and-copy is internal.                                                                                                                                               |
| `actConfidence`                                                                               | Internal versioned policy, verified per provider/model. No public tuning requirement.                                                                                                                     |
| `verify`                                                                                      | Remove public bypass. Required pre-input checks and supported deterministic postconditions remain on. Remove log-only model verification from the normal request.                                         |
| `llmFallback`                                                                                 | Fallback stays on in the product path. Decision-only execution remains a benchmark control outside public create options.                                                                                 |
| `argumentLlm`                                                                                 | Remove. Supported complete literal actions use grounded arguments; other requests use ordinary LLM fallback.                                                                                              |
| `retryNoEffect`                                                                               | Remove the old runner-up action retry. An unchanged AX outline does not prove an action had no effect.                                                                                                    |
| `focusFallback`, `pageState`                                                                  | Remove legacy action-policy branches. Retained fallback uses the supported normal inference path.                                                                                                         |
| `cacheCheck`                                                                                  | Remove the old model-based opt-in with its tree dependencies. Keep normal caching and required execution checks. Do not claim those checks prove semantic cache correctness.                              |
| `tools`, `targetReadiness`                                                                    | Remove these old decision-routing options from the focused implementation. Existing independent WebMCP/browser APIs remain available. Reintroduce decision integration only through separate experiments. |
| `speculateListMapping`, `groupExperiment`, `tableCellExperiment`, `compactEvidenceExperiment` | Benchmark controls only. Remove experimental branching from production service entry points after isolating the experiment code.                                                                          |
| Internal `enabled` and instrumentation sentinels                                              | Keep enablement at the operation boundary. Ordinary calls must not acquire experimental execution behavior through an instrumentation config.                                                             |

Do not retain renamed public switches for the same implementation details. Do not silently accept obsolete options and ignore them. Update the protocol, generated clients, docs and validation errors together.

## What stays in the focused implementation

### Actions

Retain complete-action enumeration, explicit no-match, contextual and destination evidence, bounded candidate construction, grounded literal/variable arguments, editable-root recovery, variable redaction, and mandatory target checks.

The decision model selects only actions whose operation, target and complete arguments are already known. Unsupported operations, unresolved arguments and uncertainty go to the normal configured LLM. Keep its existing action execution capabilities rather than duplicating them inside a new decision tree.

Keep read-back checks for supported fills and other meaningful deterministic outcomes. Validate the action actually happened on the intended control. An executor returning success is insufficient.

The handoff must distinguish abstention before execution, safe pre-input rejection, and failure after possible input. Fallback must not repeat a potentially completed side effect. Preserve executed actions in results, including failure results. Treat this as a correctness gate for the cleanup.

### Extraction

Retain deterministic record/fact construction, group and field mapping, copying with provenance, schema validation, current list/scalar checks and a single normal LLM fallback. Preserve exact-copy fixes, nested-heading scope, table separation, URLs, optional absence, nullable absence and explicit zero handling.

Keep Perplexity Locate as a bounded scalar second reading where the current mapper uses it. Do not replace list mapping with whole-page Locate or Clairic. Do not remove the extraction dual gate because a single choice worked for action selection; the extraction single-choice experiment had wrong accepts on fresh pages.

Optional-evidence instructions currently scoped to the mapper fallback stay scoped. Making them product-wide requires its own comparison.

Remove the old standalone `judge`, `pick` and whole-page `native` routes. Preserve native-reader research and retain only reader functions needed by the selected extraction path.

### Snapshots and compaction

Keep editable metadata and the snapshot facts needed by action selection. Keep DOM facts out of the decision-policy module. Preserve frame identity, labels, URL reconstruction and locator scoping.

Whole-page AX compaction stays a benchmark candidate during cleanup. Its eventual promotion needs fresh live comparisons of raw single-call Luna, compact single-call Luna and Decider with compact fallback. Preserve URL-bearing IDs, explicit node-ID requests, screenshots, table boundaries, multiline text and ordering. Do not mutate the browser snapshot globally to optimize one consumer.

Table-cell selection, speculative mapping, bounded fallback, mixed-field splitting, signature routing and alternate rankers stay outside default routing. Keep successful experiments and failures available for the next iteration; cleanup itself is not a promotion experiment.

## Remove legacy paths through dependency checks

| Current location                                                    | Cleanup action                                                                                                                                                                                                                                      |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `decisions/pipeline.ts`                                             | Extract the retained action resolver and shared types. Remove intent-first families, best/strict orchestration, old widget workflows, readiness, no-effect retries, page-state and tool routing. Delete the superseded module after consumers move. |
| `decisions/pick.ts`                                                 | Remove best/strict tiers, held picks, shards and legacy target orchestration once no retained consumer needs them. Move genuinely shared request/trace helpers into small neutral modules first.                                                    |
| `decisions/tree.ts`                                                 | Retain parsing, parentage, editable marking and descriptions/ranking used by current actions and extraction. Remove legacy-only helpers after tracing imports. Do not delete this file wholesale.                                                   |
| `decisions/args.ts`                                                 | Retain literal candidates, variable handling, redaction and substitution. Remove old argument, key and scroll parsing only after checking retained callers.                                                                                         |
| `decisions/observe.ts`                                              | Remove the legacy decision observer after routing its namespace method to normal observation. It currently imports action families from `pipeline.ts`.                                                                                              |
| `decisions/extract.ts`, `extractCheck.ts`                           | Remove legacy pick-and-copy and completion-judge runtime routes. Preserve their measured comparisons and sources.                                                                                                                                   |
| `decisions/pageState.ts`, `cacheCheck.ts`, `tools.ts`, `toolAct.ts` | Remove their old decision integration when callers and public options are removed. Preserve independent browser/SDK capabilities.                                                                                                                   |
| `decisions/decider.ts`, `clairic.ts`, `scalarReader.ts`             | Keep the bounded Locate functionality required by current extraction. Separate it from whole-page native extraction before removing unused routes. Clairic remains research unless a retained caller needs it.                                      |
| `decisions/actionPlans.ts`, `actionFacts.ts`, `actionGuard.ts`      | Retain and organize by selection, browser facts and execution checking. Internal names need not become public options.                                                                                                                              |
| `decisions/dataView.ts`, `mapCopy.ts`                               | Retain behavior. Split deterministic parsing/copying from model questions, schema planning and acceptance checks. Separate structural refactoring from algorithm changes.                                                                           |
| `compactExtractionTree.ts`, `tableBinding.ts`, `tableScalar.ts`     | Preserve candidate implementations and tests. Move benchmark-only consumers out of production entry points; share pure code where needed without enabling a runtime branch.                                                                         |
| Controllers, RPC, SDK wrappers and schemas                          | Retain explicit experimental calls and standard SDK ergonomics. Remove policy switches consistently. Keep normal methods isolated.                                                                                                                  |

Tests should describe retained behavior. Port useful regressions before removing legacy-only unit tests. Do not keep dead production code solely to satisfy historical tests; reproduce historical implementations from the preserved baseline instead.

One known isolation issue needs correction: the controller supplies `enabled: false` to ordinary `act()` for instrumentation, but the plan guards in `actService.ts` check only `act === "plans"`. Ordinary calls must not inherit experimental guards from that configuration. Verify this explicitly rather than repeating the current documentation's stronger isolation claim.

## Module boundaries

Refactor around these responsibilities. Directory names may follow repository conventions.

| Responsibility                      | Owns                                                                           | Must not own                                             |
| ----------------------------------- | ------------------------------------------------------------------------------ | -------------------------------------------------------- |
| Configuration and operation routing | Public connection config, validated internal config, experimental entry points | Model questions, browser execution                       |
| Snapshot evidence                   | Outline parsing, record/fact construction, editable metadata, browser facts    | Provider HTTP calls or experimental policy switches      |
| Action resolution                   | Eligible complete candidates, one selection, abstention, selected evidence     | A second general-purpose action engine                   |
| Action execution checks             | Identity, eligibility, evidence revalidation, supported postconditions         | Provider ranking or user-facing tuning flags             |
| Extraction                          | Schema planning, group/field questions, deterministic copying, acceptance      | Whole-page alternate extractors selected by public mode  |
| Fallback and results                | Existing LLM invocation, deadline, usage, cache and side-effect accounting     | Research-specific build patches and experiment arms      |
| Provider access                     | Typed requests, capabilities, transport, validation, limits and usage          | DOM roles, task interpretation or executor decisions     |
| Experiment tooling                  | Capture, frozen grading, replay, historical baselines, candidate comparisons   | Alternate production implementations copied into scripts |

Move shared types out of `pipeline.ts`. Extraction and observation should not depend on an action orchestrator for configuration. Avoid circular runtime imports. Share pure production helpers with experiments without making production services aware of every experiment.

Keep the ordinary extraction completion-call removal as its own review unit. It affects the default path even when decisions are absent.

## Unified provider work comes last

After the retained behavior and required operations are fixed, simplify the existing adapters instead of creating a speculative abstraction first.

1. Standardize the operations actually needed: choice, predicate where the extraction gate needs it, and optional exact-span reading. Translate provider wire names such as `noul` internally.
2. Declare capabilities and limits per provider/model. Locate is optional. Question packing is provider-specific; Clef's cross-field attention must not be treated as independent Jev questions by assumption.
3. Give retained requests consistent deadlines, cancellation, answer validation, endpoint handling and usage reporting. Resolve the current separate native-reader transport path without forcing its response into a choice response.
4. Preserve token attribution by model and distinguish decision work from LLM fallback. Report completed and failed billable work when the provider supplies it.
5. Pin defaults and log the resolved provider/model. Confidence thresholds belong to a tested policy for that provider/model, not a universal calibration claim.
6. Keep TypeSafe and Cloudflare adapters only through the same contract. Unsupported capabilities abstain or use the configured LLM. Do not lower acceptance checks to manufacture equivalent coverage.
7. Keep OpenAI Decisions and new vision/score/box integrations out of this cleanup. Their research remains available for later experiments.

The user-facing choice is connection and model, not an algorithm. This does not mean that all model choices are equally accurate or that fallback is unnecessary.

## Execution order and exit conditions

### 1. Freeze the starting state and evidence inventory

Record the baseline merge, current source revision, scored archives and reproduction commands. Verify local raw artifacts exist. List every public option and production consumer. Preserve exact legacy baseline sources outside the runtime dependency graph.

Exit when every deletion has a replacement, an explicit fallback route, or a documented scope removal, and every cited result still has its evidence.

### 2. Select the supported behavior

Adopt the decisions in this document: internal complete-action selection, internal map-and-copy extraction, normal LLM fallback, ordinary observation behind the compatibility namespace, single-call LLM extraction, and benchmark-only compaction/table candidates.

Inventory operation coverage before removal. Include clicks, fills, variables, disabled/readonly/hidden controls, duplicate targets, contenteditable, key presses, hover, double-click, scroll, native/custom select, drag, frames/shadow DOM, multi-step work, cache replay and self-heal. Mark each direct, fallback, or unsupported. A fallback success counts as final behavior coverage, not native decision coverage.

Exit when unsupported direct operations have an exercised fallback and the intended product behavior no longer requires the old tree.

### 3. Remove superseded runtime paths

Extract shared dependencies, route retained methods, remove old algorithms and switches, and update behavioral tests together. Do not combine a broad file move with new model prompts or candidate-ranking changes. Preserve side-effect accounting and ordinary-method isolation.

Exit when production imports cannot reach the retired algorithms and regression results have no unexplained correctness loss. Investigate latency/cost changes caused by increased fallback; do not hide them in aggregate pass rates.

### 4. Separate experiments and modularize

Split the retained action and extraction responsibilities. Remove experiment parameters from production service entry points. Keep active reproduction commands, archived baseline commands and future hypotheses distinct. Preserve every Markdown file and archive reference.

Exit when experiments can compare shared retained code with archived baselines without shipping historical policies in the product bundle.

### 5. Unify providers and finish the public contract

Apply the provider contract above. Remove `plans`/`map` and other policy switches from TypeScript, Python, protocol schemas and generated files. Update docs, examples, changesets, RPC and parity tests together. Correct obsolete environment-bridge and observation-switch descriptions without deleting their Markdown files.

Exit when a user can configure Perplexity credentials and a supported model, call the namespace, and receive direct results or ordinary LLM fallback without policy configuration. Check TypeSafe and Cloudflare explicitly; do not infer conformance from Perplexity success. Go is an external SDK dependency and must not be advertised as updated without coordinated verification.

### 6. Validate the cleaned branch

- Run extension tests, TypeScript SDK checks, Python generated/client tests and generation consistency, docs/protocol parity, formatting, lint and builds appropriate to the changed packages.
- Exercise the existing action eval suite. Cover fallback operations, scoping, variables, frames/shadow DOM, ambiguity, editors, target replacement, replay/self-heal and possible partial effects.
- Rerun the current extraction regressions for lists, exact spans, multiple tables, URLs, missing/nullable/optional values, zero, nested schemas and fallback. Confirm screenshot handling and ordinary single-call extraction.
- Compare the cleaned implementation with archived pre-cleanup sources on identical frozen inputs. Use live runs for browser effects and caller latency. Track direct accepts, wrong accepts, fallback, final outcomes, p50/p95 and model-attributed cost.
- Confirm the proposed default Decider model on both operations and validate explicit Flash selection. Record changed coverage and fallback expense rather than forcing a favorable result.
- Archive final source hashes and scored results. If cleanup changes selection behavior, freeze new graders and confirm on fresh live pages before claiming improvement.

Exit when the branch has a small documented product contract, no reachable retired pipelines, preserved evidence, and measured behavior for the final source. This is cleanup completion. A production release still requires its own readiness decision.

## Work after cleanup

Resume one hypothesis at a time. Write instructions, capture a few live pages, freeze snapshot-based graders, compare identical inputs, inspect errors, and check actual effects through the SDK. A set used to fix a failure becomes regression coverage. Confirm on fresh pages before promoting a candidate.

The next independent candidates are fresh compaction confirmation, table-cell coverage, broader action/fallback workflows, and provider-specific calibration. Do not restore public algorithm switches to run those experiments.

No release, push, history rewrite, or PR creation is part of writing this plan.
