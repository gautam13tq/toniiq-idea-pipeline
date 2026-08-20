# Phase B Golden-Set Regression Harness

Offline replay of the **deterministic** Phase B scoring core against frozen fixtures. Catches regressions in classification, demand gating, pillar math, composite formula, and competition caps before deployment.

## Layout

```
eval/golden-set/
  replay.mjs          # Run all fixtures; exit 0 on exact match
  capture.mjs         # Snapshot a concept from Supabase (operator-run)
  fixtures/
    <slug>/
      inputs.json     # Frozen inputs to runPhaseBDeterministicCore()
      expected.json   # Expected outputs (from stored concept_scores)
    _selftest/        # Synthetic smoke fixture (checked into repo)
```

## Run replay

```bash
npm run eval:phase-b
# or
node --experimental-strip-types eval/golden-set/replay.mjs
```

- **Exit 0** — all fixtures match exactly (or no fixtures with a notice).
- **Exit 1** — per-field diffs printed for each failing slug.

Requires **Node 22+** (uses `--experimental-strip-types` via the npm script).

## Capture a fixture (operator)

After a real Phase B evaluation in Supabase:

```bash
export SUPABASE_URL="https://YOUR_PROJECT.supabase.co"
export SUPABASE_SERVICE_KEY="..."   # service role — never commit

node eval/golden-set/capture.mjs <concept-uuid-or-name-fragment>
```

This writes `fixtures/<slug>/inputs.json` and `expected.json`. Review the JSON before committing. **Do not commit credentials.**

### Improving captured demand data

If `capture_meta.datarova_raw_api_responses` is present, you can rebuild a richer `demand` block offline with `buildDemandPacketFromRecords()` from `scoring_core.ts` (see `HARNESS_NOTES.md`).

## Interpreting diffs

Replay compares the full `expected.json` tree to fresh core output:

- **Gate status change** — usually classification or demand-primary selection.
- **Pillar subsignal drift** — competitive math or included-set composition changed.
- **Composite / tier only** — check competition gate caps and differentiation input (frozen LLM score).

Fix the scoring bug or, if the change is intentional, re-capture the fixture after verifying live output.

## What is *not* replayed

- LLM frame inference (stored as `inputs.frame`)
- LLM differentiation (stored as `inputs.differentiation`)
- Live Apify / Keepa / Datarova fetches

See `HARNESS_NOTES.md` for the full boundary.
