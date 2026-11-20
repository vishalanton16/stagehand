# Extract group recovery, round 2

A heading-scoped retry recovered 10 complete, correctly ordered lists across 12
retry attempts. It issued one additional group decision per retry and introduced
zero wrong accepts on that path. Across all 88 decision trials per build, correct
direct results rose from 37 to 48 and routes to Luna fell from 44 to 36.

## Change

Long pages can crowd a short, relevant list out of the eight-group shortlist.
After the usual selector abstains or disagrees, a request for one required
string list can retry one group outside that shortlist. The request must name
an actual heading as its scope. The group must be unique, have 2–50 sibling
records, and have a slot present on every record. Table requests look for table
rows. Other requests look for list items or description-list terms. Headings
mentioned only in exclusions don't qualify.

The retry describes the record type and any column headers. It still requires
the choice and the independent group predicate to agree, then runs the usual
field mapping, subset checks and schema validation. The initial provider request
is byte-identical on both builds.

## Frozen replay

The baseline is `c04b4c31e43154c3e420073ca368187e64bb0008`. The candidate's
measured `listMapping.ts` Git blob is
`67271a4f72ceaefa0747023ff5b58442c5c7a3c7`. The runner gave both builds
identical saved outlines, instructions, schemas and archived graders. Each of
22 public-page tasks ran twice per model on Perplexity Decider v1.3 and Flash
v1.3. The 16-task heldout suite includes the five heldout-7 lists used to
diagnose the issue. The six-task coverage suite uses previously frozen
`liveCoverageTasks.ts` labels. It has no duplicate pages from the heldout
suite and shares four sites with it. These are repeated measurements on a
small set of pages.

| Model and build   | Trials | Correct direct | Complete lists direct | Wrong direct | Fallback | Decision p50 / p95 |
| ----------------- | -----: | -------------: | --------------------: | -----------: | -------: | -----------------: |
| Decider baseline  |     44 |             28 |                 22/34 |            3 |       13 |   1,122 / 3,072 ms |
| Decider candidate |     44 |             32 |                 26/34 |            2 |       10 |   1,232 / 2,490 ms |
| Flash baseline    |     44 |              9 |                  5/34 |            4 |       31 |     432 / 1,145 ms |
| Flash candidate   |     44 |             16 |                 12/34 |            2 |       26 |     690 / 1,593 ms |
| Both baseline     |     88 |             37 |                 27/68 |            7 |       44 |     855 / 2,180 ms |
| Both candidate    |     88 |             48 |                 38/68 |            4 |       36 |     985 / 1,956 ms |

Complete lists passed their whole-list grader, including membership, duplicates,
and order where the task requires it. The candidate recovered Kubernetes Pod
phases and MDN WebAssembly number types on both rounds with both models. Flash
also recovered the complete Kubernetes Service types on both rounds. Decider
declined that recovery both times. The other changes in pass or wrong-accept
counts came from different provider judgments on unchanged paths. Decider still
accepted truncated Docker filter names and Flash still accepted the rounded
NIST value. GitHub's captured accessibility cell inserts a space after the
slash in the repository qualifier. Exact text there requires stronger capture
evidence.

The candidate used 175 Perplexity requests and 290,315 reported input tokens,
versus 154 requests and 286,073 input tokens for the baseline. The latency
columns include decisions and local processing on frozen outlines. They
exclude browser capture and fallback. The runs used fixed build order within
each suite and rotated model order. Latency includes provider and cache
variation.

### Fallback control

A single ordinary `openai/gpt-6-luna` extraction with the production
missing-value instructions ran on each of the 18 tasks that any arm routed to
fallback. Luna passed 17/18. It preserved the inserted whitespace in the
GitHub qualifier and failed that grader. Applying the shared Luna outcomes to
both decision result sets gives 78/88 baseline and 80/88 candidate final
passes. Every recovered list also passed the Luna control. The retry accounts
for lower fallback use. The two extra joined passes came from provider
variation on unchanged paths. The joined counts reuse one Luna result per
task. End-to-end timing would require running each fallback in sequence.

### Earlier probe

The first retry used the original group question unchanged. On one round of
the 16-task suite, Decider recovered both target lists. Flash selected both
groups but its predicates scored below 0.5. Giving the retry its table/list
role and concrete column names recovered the target lists with both models in
the next probe. The table above uses the separate two-round replay of the
final build, which also requires the group's records to share one parent.

## Reproduce

Run in an isolated checkout containing the production commit and installed
workspace dependencies. The commands use the public captures and grader
sources in the local vendor archive. The nested grader directory must resolve
its installed `zod/v4` dependency. Provide `PERPLEXITY_API_KEY` and
`AI_GATEWAY_API_KEY` in the local environment file. Run the following from the
checkout root with a fresh output directory.

```sh
vendor=/Users/vishal/Developer/personal/forks/stagehand/vendor-repos
out=$(mktemp -d)
replay=packages/sdk-ts/scripts/system-one-extract/replay.ts
mapping=packages/extension/services/decisions/listMapping.ts
base=c04b4c31e43154c3e420073ca368187e64bb0008

(
  set -e
  cp "$mapping" "$out/candidate.ts"
  trap 'cp "$out/candidate.ts" "$mapping"' EXIT
  git show "$base:$mapping" > "$mapping"
  for suite in coverage heldout; do
    node --env-file="$vendor/../.env" --import tsx "$replay" "$vendor" \
      "$out/baseline-$suite" "$suite" 2
  done
)
for suite in heldout coverage; do
  node --env-file="$vendor/../.env" --import tsx "$replay" "$vendor" \
    "$out/candidate-$suite" "$suite" 2
done
node --env-file="$vendor/../.env" --import tsx \
  packages/sdk-ts/scripts/system-one-extract/replayFallback.ts "$vendor" "$out/luna" \
  "$out/baseline-heldout" "$out/baseline-coverage" "$out/candidate-heldout" "$out/candidate-coverage"
```

The private local archive is
`vendor-repos/system-one-study-2026-11-20/extract-round2/`. Each final decision
directory includes its capture and grader hashes, tracked source bundle and
patch, responses, traces, usage and request counts. The candidate source
patch SHA-256 is
`d861d21ba3ab689208fa093571cd756de07d1eda2961ca38c67eaa32679d55d3`.

| Archive directory          | Result JSONL SHA-256                                               |
| -------------------------- | ------------------------------------------------------------------ |
| `final-baseline-heldout`   | `436712d2a7762d81af593a0f173e6cf05081145cbdddff53feab73785a1148f9` |
| `final-candidate-heldout`  | `f021652b902d138a0125d4a90234e5cc757e6f8b422449a347915e2fb3a7efbc` |
| `final-baseline-coverage`  | `bafd457adf10bd311656734305d825880249f39c908e884cae4eb2fb0ee0bf58` |
| `final-candidate-coverage` | `bb9f544da36ecdbe03e2b5f453a7a109f9b0873d70a8974d7455c07f73618c04` |
| `luna-fallback`            | `26db9d6bae8ced2fb519b123e9449a616456585f38bb2ff0477ab1e2fe3e1a59` |
