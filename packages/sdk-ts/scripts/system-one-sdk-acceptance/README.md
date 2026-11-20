# System One SDK acceptance benchmark

The nine cases exercise the built TypeScript SDK and its bundled Chrome extension. Both arms use the same build, viewport, deadline, disabled Stagehand cache and disabled Act self-healing. The runner rotates which arm goes first by case and round. Each trial starts with a clean browser profile.

- `luna` calls ordinary `observe`, `extract` and `act`. The SDK's operation-specific prompt and schema go to Luna through Responses.
- `standard` calls the experimental SDK methods with `pplx-decider-v1.3` and that same Luna callback for fallback.
- Optional `flash` substitutes `pplx-decider-flash-v1.3` in the same experimental path.

## Capture and run

From the repository root, with Node 22.18+ and Chrome or Chromium installed.

```sh
pnpm install --frozen-lockfile --filter '@browserbasehq/stagehand...' \
  --filter '@browserbasehq/stagehand-extension...' --filter stagehand-workspace
pnpm --filter @browserbasehq/stagehand-extension build
pnpm --filter @browserbasehq/stagehand build

bench=packages/sdk-ts/scripts/system-one-sdk-acceptance
archive=/Users/vishal/Developer/personal/forks/stagehand/vendor-repos/system-one-study-2026-11-20
env_file=/Users/vishal/Developer/personal/forks/stagehand/.env
capture="$archive/sdk-acceptance-capture-v2"

# Only run this line to make a fresh capture in a new directory.
node "$bench/run.ts" capture "$archive/sdk-acceptance-new-capture"

node --env-file="$env_file" "$bench/run.ts" replay "$archive/sdk-acceptance-new-replay" "$capture"
SDK_ACCEPTANCE_ROUNDS=1 node --env-file="$env_file" "$bench/run.ts" live "$archive/sdk-acceptance-new-live"
```

On a patched branch, rebuild both packages and pass the same capture directory for the controlled comparison. Keep `STAGEHAND_EXTENSION_DIRECTORY_PATH` unset so the measured extension is the bundled one. The run manifest records the SDK bundle SHA-256, extension fingerprint, lockfile and runner source digests. Each trial records the actual Chrome version. `SDK_ACCEPTANCE_CHROME` can point to a specific browser executable.

The model runs read `AI_GATEWAY_API_KEY`, optional `AI_GATEWAY_BASE_URL`, and `PERPLEXITY_API_KEY` from the existing environment. The capture command needs neither key. The runner defaults to two rounds and the Luna and Standard arms. Set `SDK_ACCEPTANCE_ARMS=luna,standard,flash` to include Flash, or `SDK_ACCEPTANCE_CASES=iana-further-reading,badge-fill` to run individual cases.

## Inputs and scoring

Capture loads Books to Scrape and IANA with the SDK, checks the labels against the live DOM, and writes two HTML files and a digest manifest. The [prior Observe study](../system-one-study/manifest.json) supplied the pages and target descriptions. The operation pilot in `vendor-repos/system-one-study-2026-11-20/operation-pilot.ts` supplied the provider setup and independent DOM grading approach. The Responses callback follows the archived `observe-improvement/bench.ts` and the SDK custom-model example. This runner resolves labels without the decision code or either model.

Replay verifies the archive digests and rehosts the captured documents on loopback. It removes scripts and frames and blocks external assets. A base URL preserves resolved link destinations. This keeps the HTML fixed across arms while exercising normal browser capture, SDK inference, decision guards and fallback. Layout and accessibility trees can differ from the original pages. The live run checks both public pages again as they are served. Both modes run the two Act cases only on a loopback fixture, where form submission is blocked and click handlers only increment local counters. Public Observe actions are graded without execution.

Observe checks an exact set of DOM elements and checks the returned methods and arguments. It allows `click` and `scrollTo` for the heading lookup. Extract checks exact typed values and array order. Act checks both fields and both click counters, including after a thrown operation if the fixture is readable. A successful SDK result with the wrong effect counts as a wrong accept. A changed but wrong fixture state counts separately even if the SDK reported a failure.

Each run writes `run.json`, `trials.jsonl` and `summary.json`. The trial log records navigation, an untimed input audit and outline sample, SDK wall time, grading, provider usage and fallback offsets. Decision receipts record responses that the SDK counted, so retries and other failed provider requests can be absent. Luna call time includes the Responses request and result parsing. SDK inference timing follows the implementation for each route and can overlap with browser work. The measured SDK operation time excludes the separately sampled outline and grading.

The summary compares complete case-round pairs. Navigation failure, label drift or an unavailable grader excludes the pair and appears in the trial log. SDK operation failures and incorrect outputs count in the denominator. Percentiles use nearest rank. Inspect case results and paired counts before comparing latency across builds.

## November 20 baseline

Both runs built `c04b4c31e` with Chrome 158. The captured HTML is in the archive directory above. The [capture metadata](baseline-capture.json) and [baseline summary](baseline-summary.json) pin the inputs and the complete local run logs by digest.

| Mode       | Arm      | Passed | Wrong direct accepts | Fallbacks |  SDK p50 |  SDK p95 |
| ---------- | -------- | -----: | -------------------: | --------: | -------: | -------: |
| Controlled | Luna     |  18/18 |                    0 |         0 | 1,807 ms | 2,636 ms |
| Controlled | Standard |  16/18 |                    2 |         4 | 1,625 ms | 3,467 ms |
| Live       | Luna     |    9/9 |                    0 |         0 | 1,796 ms | 2,374 ms |
| Live       | Standard |    8/9 |                    1 |         2 | 2,081 ms | 3,686 ms |

Every wrong accept was Standard returning the three Further Reading links plus 27 links outside that section. The same error appeared in both controlled rounds and the live round. Standard invoked Luna for the Travel heading and Further Reading URL list in all three rounds. Both arms passed every Extract and Act case. The controlled Act median was 1,282 ms for Standard and 2,081 ms for Luna.

The pilot returned `scrollTo` for the exact Travel heading. The final scorer accepts that method because the prompt only asks to find the heading. All 54 scored trials ran with the final rubric, and there were no exclusions. Each case's sampled outline had one digest within each run. The two modes and repeated rounds share page identities, so the results describe these cases.
