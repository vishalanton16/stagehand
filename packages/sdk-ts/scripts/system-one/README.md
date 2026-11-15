# Experimental record extraction

The public configuration now needs only provider credentials and an optional model. Historical `map`, `plans`, and tree comparisons below belong to the recorded baseline. See [cleanup status and current reproduction](./docs/CLEANUP_RESULTS.md).

Agent handoff docs: [docs/INDEX.md](./docs/INDEX.md) (review, next steps, evaluation, architecture, roadmap, directions).

Configure the existing experimental namespace with provider credentials and an optional model. Stagehand builds record groups, asks the configured decision model to select groups and fields, and copies values from the snapshot. Perplexity also reads scalar evidence with Locate using the same model. Detected disagreements, unsupported schemas, and invalid output use the configured LLM fallback.

Add this configuration to `Stagehand.create()`, alongside your browser and fallback model.

```ts
experimentalDecisions: {
  provider: "perplexity",
  apiKey: process.env.PERPLEXITY_API_KEY!,
  model: "pplx-decider-v1.3",
}
```

Call `stagehand.experimentalDecisions.extract(instruction, schema, { page })`. TypeSafe and Cloudflare can map fields through their choice APIs. Their scalar results receive structural checks. Perplexity also uses Locate to check selected scalar values. Clairic and whole-page Locate remain research readers outside the runtime.

The implementation lives in `packages/extension/services/decisions/dataView.ts` and `mapCopy.ts`. Replay imports those modules. The runtime validates output against the caller's schema and propagates the operation deadline. It omits absent optional values, returns null for absent required nullable scalar fields, and preserves explicit zero. Unresolved required non-nullable values trigger fallback. Unsupported nested objects use fallback. Set `llmFallback: false` to receive an abstention error.

The mapping trace records candidate choices, detected problems, source node IDs, and record IDs. Scalar-reader traces can name several matching source nodes. Info logs report the route, problem reasons, and completed decision request count. Debug logs carry the full trace. The result's usage includes both paths.

Missing-value instructions also apply to fallback. This improves the observed absent-value cases, but does not prove semantic correctness. A source occurrence establishes where a value came from. It does not establish that the value answers the requested field or that every requested record was selected.

## Reproduce validation

Run from the repository root with the Perplexity and Vercel AI Gateway keys in `.env`.

```sh
pnpm --filter @browserbasehq/stagehand-extension build
node --env-file=.env --import tsx packages/sdk-ts/scripts/system-one/live.ts
```

The live runner uses the locally built extension and the public SDK. Its six synthetic fixtures cover nested sections, separate tables, absent fields, explicit zero, unsupported nested schemas, and URLs. The fixture instructions, schemas, expected answers, and HTML are checked into `live.ts`. They are integration coverage, and results should not be presented as a representative independent web benchmark.

Use `LIVE_ARMS=flash` or `LIVE_ARMS=decider,luna`, and `LIVE_ROUNDS=2`, to select comparisons.

Replay the production service on saved real-page snapshots.

```sh
REPLAY_TASKS=craigslist_canada,webscraper_tables,highest_mountains,gomod_stars_absent REPLAY_ARMS=runtime-decider REPLAY_ROUNDS=2 node --env-file=.env --import tsx packages/sdk-ts/scripts/system-one/replay.ts
```

Replay rejects unknown task names and missing snapshots. Each run writes a manifest, compressed source files, compressed snapshots, and JSONL results under `vendor-repos/system-one-corpus/runs/archive/<run-id>/`. This directory is Git-ignored. Keep the complete directory when moving results elsewhere. The source bundle excludes environment files and contains the tracked and unignored source files selected by the runner. New manifests declare base64 encoding so binary assets also survive archival. Older manifests without an encoding field contain UTF-8 text.

Every result records the run ID, revision, source hash, snapshot hash, timing, observed token usage, output, grading result, and diagnostics. Production-service arms report `usd: null` because their combined usage spans decision and fallback models. Historical runs without manifests retain their original provenance limitations.

## Results on November 14, 2026

The production Decider pipeline passed all 22 heldout-4 regression runs, with 18 accepted directly and four sent to Luna. Cursor's earlier version passed 18/22 on these tasks. These pages informed the fixes, so the comparison measures regression recovery.

The final paired public-SDK check passed 6/6 for Decider plus fallback and 6/6 for Luna. Mean times were 9.3 and 4.1 seconds respectively. Four Decider cases used fallback. An earlier two-round integration run passed 12/12 for each arm. Flash's six-case check passed 6/6 with one fallback and a mean of 1.6 seconds. Flash then passed 20/22 on the full heldout-4 regression, with six fallbacks. It wrongly accepted the inverse exchange-rate column in both rounds. Decider is the example configuration because it passed all 22 of those regression runs. These small, separately scheduled runs do not establish a general provider ranking.

## Plan validation

The 49 seen pages ran twice per arm. Two unavailable snapshots, `apartments` and `npm_zod`, were excluded. Decision request counts cover completed provider requests that reported usage.

| Seen replay                                    | Passed | Correct accepts | Fallbacks | Wrong accepts | p50 / p95      | Mean / p95 decision requests |
| ---------------------------------------------- | -----: | --------------: | --------: | ------------: | -------------- | ---------------------------- |
| Runtime before changes                         |  96/98 |              78 |        18 |             2 | 6.61 / 14.52 s | 3.18 / 4                     |
| Runtime after changes                          |  96/98 |              77 |        19 |             2 | 4.15 / 11.32 s | 2.19 / 3                     |
| Luna with absence instructions, before changes |  95/98 |                 |           |               | 5.66 / 24.75 s |                              |
| Historical prototype                           |  96/98 |              84 |        12 |             2 | 2.91 / 14.53 s |                              |

Both runtime versions accepted 38 of the 63 requested MDN status codes. The historical prototype instead missed the last Zimbabwe record on both runs. The final version escalated cases previously accepted by the prototype for these reasons:

- CSA and country populations returned schema-invalid fields. Schema validation caught both.
- Professional info returned phone and fax readings that differed from Locate. The Eiffel Tower dates differed too. In particular, Locate returned day fragments for the dates, so substring equality could accept materially incomplete values.
- GitHub stars escalated once after a Perplexity HTTP 429, and the LLM fallback recovered.

The two list latency experiments were evaluated together and rolled back after six wrong accepts on the seen pages. The extra failures included the World total in the country population list and the full group of Everest aliases. Production retains normalized exact scalar comparisons and rejects missing required list values. The caller schema requires those values, so permitting a missing fraction would still fail schema validation.

On the final six browser fixtures, both arms passed 6/6. End-to-end p50/p95 was 4.42/7.97 s for Decider and 3.39/4.89 s for Luna.

### Site-disjoint replay

Heldout 5 uses six sites new to the active corpus. The graders were frozen before either runtime version ran. Each arm ran twice on the same snapshots.

| Arm                            | Passed | Correct accepts | Fallbacks | Wrong accepts | p50 / p95      | Mean / p95 decision requests |
| ------------------------------ | -----: | --------------: | --------: | ------------: | -------------- | ---------------------------- |
| Decider + Luna                 |  10/12 |               6 |         4 |             2 | 8.01 / 36.40 s | 2.33 / 4                     |
| Flash + Luna                   |  10/12 |               4 |         6 |             2 | 2.75 / 37.93 s | 2.17 / 4                     |
| Luna with absence instructions |  10/12 |                 |           |               | 4.10 / 45.69 s |                              |

The two frozen-score wrong accepts per decision model were the same NIST case. Its table gives 273 K while its prose gives 273.15 K, which the grader requires. This is an ambiguity in the task. The frozen scores above preserve it. The long IANA list drove the upper latency tail. The two Luna runs were scheduled separately, so their score difference does not isolate the prompt effect. The guarded run used the earlier replay prompt placement. Future comparisons can use `luna,luna-guarded` to measure both with a shared instruction and the production fallback guard in the system prompt.

The public SDK real-page subset used SQLite, the RFC Editor, and W3Schools. On two rounds, Decider passed 6/6 with no fallbacks. Luna passed 4/6 and returned an empty string for the absent DOI in both RFC runs. End-to-end p50/p95 was 6.02/10.86 s for Decider and 3.95/4.48 s for Luna, including navigation and snapshot capture.

Use `LIVE_TASKS=hold5_sqlite_limits,hold5_rfc_absence,hold5_html_tables LIVE_ROUNDS=2` with the live runner to repeat that subset. Replay archives include the baseline (`279ef8f9-56fb-4c4c-8aa0-a9d266f6c9fb`), final seen run (`c4b70a87-dfae-4d30-95dd-b3b3db9460fc`), and final heldout 5 run (`16961376-6ca2-40e3-96dd-c147ffce0c8f`).
