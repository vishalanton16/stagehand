# System One Observe replay study

This study uses decisions-beta at `93b9d9132`. It covers 16 instructions on eight freshly captured pages, including public documentation, a government page, a map licensing page, and public test fixtures. [The manifest](manifest.json) pins each snapshot by SHA-256 and records which nodes, methods, and arguments count for each instruction.

I audited the merged outline, XPath ancestry, and DOM facts before running any replay arm. The labels cover a duplicate with either match allowed, a duplicate where both matches are required, scope-specific matches, two absent targets, and controls behind two or three iframe hops. A maintenance page and an error page from the first capture pass were replaced before labeling. The Books to Scrape and nested-form fixture URLs also appear in the prior research. I found no exact URL matches for the other six pages in the prior scripts and manifests.

## Run the study

From the repository root, with dependencies installed:

```sh
pnpm --filter @browserbasehq/stagehand-extension build
study=packages/sdk-ts/scripts/system-one-study
capture=/path/to/vendor-repos/system-one-corpus/decisions-beta-93b9d9132-capture-v2

node --import tsx "$study/replay.ts" "$capture" literal runtime hybrid
```

The pinned archive lives in the original checkout's ignored `vendor-repos/system-one-corpus/` directory. It contains raw public page data. This repository contains the digest manifest and sanitized replay evidence.

To capture today's page states, run the following with a new directory under `vendor-repos/`. Audit the new snapshots and update the manifest before replaying them. Backend node IDs can change between captures.

```sh
node --import tsx "$study/capture.ts" vendor-repos/new-system-one-capture
```

Capture uses a fresh headless browser and the branch's `page.snapshot({ includeIframes: true })`. It runs the branch's `readFacts` against the main document and same-origin frames. The SDK snapshot does not expose the internal AX editable IDs, so capture recovers DOM contenteditable roots. Cross-origin child-frame facts are unavailable through this capture path. The weather page hit that limitation. The two nested fixtures resolved their same-origin targets.

Replay verifies every digest before it runs an arm and parses a fresh copy of the same file for each invocation. The grader checks selectors, methods, and arguments as an unordered exact set, or requires a single acceptable result for `one-of`. An absent target passes only with an empty result. Fallbacks and errors are recorded separately from incorrect accepted results. Replay has no browser or page handle and does not execute returned actions. This measures frozen selection through `selectObservation`. The live observation service's recapture and ordinary LLM fallback are outside the experiment.

## Add an arm

A trusted local TypeScript module can export a default `ReplayArm` from [arms.ts](arms.ts). It receives `{ snapshot, instruction, config }` and returns the branch's `ObservationOutcome`. The labels stay inside the grader. The supplied configuration carries the request deadline and usage callback.

```sh
STUDY_CASES=books-heading,tryit-deep-heading node --import tsx \
  "$study/replay.ts" "$capture" runtime ./candidate-variant.ts
```

`runtime` calls the branch's selector. `literal` resolves a narrowly phrased quoted link, heading, or button request when exactly one visible candidate has that name and the snapshot has no unresolved candidates. It also runs provider-free discovery. `hybrid` tries `literal` and uses `runtime` when it abstains.

Replay blocks HTTP by default. To use the Perplexity endpoint, load an existing environment file and set `STUDY_LIVE=1`. The runner allows only that endpoint and caps attempts, including retries, at 8 per case and arm, and 80 per invocation, with a 24-second provider deadline per case and arm. It logs HTTP statuses and token counts without request or response bodies. `STUDY_ROUNDS=2` runs each case twice and reverses which arm goes first for each case in round two.

```sh
STUDY_LIVE=1 node --env-file=/path/to/existing.env --import tsx \
  "$study/replay.ts" "$capture" literal runtime hybrid
STUDY_LIVE=1 node --env-file=/path/to/existing.env --import tsx \
  "$study/replay.ts" "$capture" hybrid runtime literal
```

## Observed results

[Recorded evidence](evidence.jsonl) contains the two runs above on November 20, 2026, using `pplx-decider-v1.3`. Latency covers replay selection. Each live request returned HTTP 200.

| Arm     | Correct / 32 | Incorrect accepts | Fallbacks | HTTP attempts | Input tokens | Median ms |
| ------- | -----------: | ----------------: | --------: | ------------: | -----------: | --------: |
| Runtime |           26 |                 2 |         4 |            60 |      198,494 |     1,068 |
| Hybrid  |           27 |                 2 |         3 |            46 |      201,020 |     1,140 |
| Literal |           10 |                 0 |        22 |             0 |            0 |         3 |

- The IANA Further Reading task accounted for every incorrect accept. Both provider-backed arms returned all three expected links plus 27 extra results on both runs.
- The hybrid resolved the quoted Travel heading on both runs. The runtime classified it as unsupported both times. The hybrid abstained once on the request that allowed either Books link.
- The hybrid used 14 fewer HTTP attempts and 2,526 more input tokens. The breadcrumb task alone used 4,037 more input tokens per run in the hybrid despite taking two requests in both arms. The arms share the same runtime route on that task.
- The runtime and hybrid returned empty results for both absent targets and passed both nested targets and discovery on both runs. Both fell back on the weather page because 14 candidates in a cross-origin frame lacked captured facts.
- Two offline rounds produced 10 correct results for both the literal and hybrid arms, and two for the runtime arm. All 96 offline evaluations made zero HTTP requests. The provider-backed cases that attempted HTTP reported a blocked fetch.

These counts describe the audited snapshots and two replays. They leave open how often the same behavior occurs on other sites or with ordinary LLM fallback enabled.
