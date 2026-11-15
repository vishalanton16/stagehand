# Action experiments

The public configuration now needs only provider credentials and an optional model. Historical `map`, `plans`, and tree comparisons below belong to the recorded baseline. See [cleanup status and current reproduction](../docs/CLEANUP_RESULTS.md).

These scripts capture real page states, freeze action labels, compare policies on identical snapshots and validate outcomes through the public SDK. [Results](../docs/ACT_RESULTS.md) and [design](../docs/ACT_EXPERIMENTS.md) explain the workload and its limits.

Requires a built extension, `PERPLEXITY_API_KEY` and the existing Luna gateway configuration in the repository `.env`. Provider replays also use the existing TypeSafe or Cloudflare credentials. Keys are never written into manifests or request archives.

Run from the repository root. Each command requires a new output directory so it cannot overwrite a scored run.

```sh
pnpm --filter @browserbasehq/stagehand-extension build
mkdir -p vendor-repos/system-one-corpus/runs/act
node --env-file=.env --import tsx packages/sdk-ts/scripts/system-one/act/capture.ts vendor-repos/system-one-corpus/runs/act/new-capture
```

Inspect snapshots, screenshots and `.labels.json` files before inference. Freeze graders and record unavailable tasks. `ACT_SET=confirmation` or `ACT_SET=confirmation2` selects the later task definitions. Reusing these definitions now produces regression evidence.

```sh
node --env-file=.env --import tsx packages/sdk-ts/scripts/system-one/act/replay.ts vendor-repos/system-one-corpus/runs/act/new-capture vendor-repos/system-one-corpus/runs/act/new-replay
ACT_MODEL=pplx-decider-flash-v1.3 ACT_ROUNDS=3 node --env-file=.env --import tsx packages/sdk-ts/scripts/system-one/act/live.ts vendor-repos/system-one-corpus/runs/act/new-capture vendor-repos/system-one-corpus/runs/act/new-live
node packages/sdk-ts/scripts/system-one/act/summarize.mjs vendor-repos/system-one-corpus/runs/act/new-live
```

`ACT_ARMS` selects comma-separated arms. Replay defaults to `known-dual,known-single,plans,legacy,luna`; live defaults to `luna,plans`. The legacy replay controls require the prepared baseline archive. Known-operation arms receive the operation and argument, so their timings are a separate comparison. `plans-nodest` and `plans-full` isolate representation changes. `ACT_TASKS` limits task names; `ACT_SITE` limits capture sites. Replay uses three concurrent tasks; live execution is sequential with rotated arm order.

For provider-only replay, set `ACT_ARMS=plans`, `ACT_PROVIDER=typesafe` or `cloudflare`, and optionally `ACT_MODEL`. Defaults are pinned Jev `jev-1.14.0`, `clef-flash` and Decider `pplx-decider-v1.3`. Do not interpret a shared confidence gate as calibrated across providers.

```sh
node --env-file=.env --import tsx packages/sdk-ts/scripts/system-one/act/mutations.ts vendor-repos/system-one-corpus/runs/act/new-mutations
node --env-file=.env --import tsx packages/sdk-ts/scripts/system-one/act/workflows.ts vendor-repos/system-one-corpus/runs/act/new-workflows
node --env-file=.env --import tsx packages/sdk-ts/scripts/system-one/act/controls.ts vendor-repos/system-one-corpus/runs/act/new-controls
```

Mutation tests deliberately alter controlled HTML during inference. Workflow tests use actual model actions for every scored step. Each run archives relevant source files and hashes. Replay also records exact request bodies and responses without auth headers. Live runs retain page captures, action results, logs and reported usage. Raw artifacts follow the existing gitignored vendor-corpus convention; committed result summaries are under `results/`.
