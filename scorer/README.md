# Shelf scorer v1

The agreed Amazon idea scorer (Gautam, 8 Nov 2026). Spec and locked decisions:
`/mnt/project-files/product-dev/amazon-ideas-system/final-scoring-proposal-2026-11-08/FINAL_SCORING_SYSTEM_PROPOSAL.md`.

Score = 10 x (0.25 Demand + 0.05 Growth + 0.45 Competition + 0.25 Differentiation). Strong at 60; soft caps hold at 59.9.
The shelf is the top 12 product lines by summed Keepa "bought in past month" badge, after Grok's gate (v11.2, frozen,
plus the two v11.3 rules Gautam confirmed).

## Run one shelf (on the Mac, through Remote Control)

```
export SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=...      # keys are read from system_config, never written
python3 run_shelf.py new specs/<shelf>.json --idea <idea-id> --runs runs --cap 2.0
python3 run_shelf.py go runs/<run_id>
python3 run_shelf.py publish runs/<run_id>
```

Write the spec from the keyword alone, before looking at any listing (fields: shelf_keyword, hero_regex,
cluster_keywords, microbial, optional parent_keyword, form, other_forms, gate_format pill|powder|gummy, modifier,
finder_terms, seed_asins, candidate_subniches, hero_name). `new` refuses a spec once any data call exists.

## What makes it impossible to cut corners

- 15 steps, in order; each writes its artifact and records a pass/fail check. A step will not start until the ones
  before it have passed. There is no flag to skip a step.
- Every API call (Datarova, Keepa, Apify, Anthropic) is logged in `calls.jsonl` with query, rows, cost and the raw
  response file and its hash.
- `validate` recomputes D, G, C, Diff and the score from the raw files, checks every required call happened, every
  unsure listing had a judge call, the top 12 has no open front-of-pack check, and no file changed after it was written.
- `publish` is the only path that writes a score, and it refuses on any failed BLOCKER check.

## Tests

`python3 -m unittest discover tests` runs the maths checks (including Grok's R-ALA worked example) and offline
end-to-end runs with fake APIs, including planted failures (a deleted Datarova call, a hand-edited number, a missing
Differentiation call, skipping a step). Replay of Grok's 69 rows and the golden sets need Grok's raw data export.

## Writing a shelf spec (rule added 9 Nov 2026 after the first blind round)
A spec is written from the keyword only, before any run, and committed with its SHA.
- Every word in the keyword beyond the hero narrows the shelf and must become a gate co-term:
  gender or audience ("for women") -> `required_regex` (e.g. `women|woman|female|\bher\b`); dose ("12 mg") -> `required_regex` on the dose;
  format ("gummies", "liquid", "powder") -> `gate_format` / `form`; delivery ("liposomal") -> `required_regex`.
- Use plain words in the keyword (no "+"); the keyword must be the one shoppers type.
- If the hero word has another meaning (pea, black garlic food), add `hero_exclude_regex` and `hero_strong_regex`.
