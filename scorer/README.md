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

## Writing a shelf spec (rule added 9 Nov 2026; pre-registration rule replaced 11 Nov 2026)
A spec is written from the keyword only, before any run, and committed with its SHA.
- **Shelf keyword = the lane the idea names** ("colostrum capsules", "creatine gummies", "magnesium glycinate powder"),
  even when that phrase is small. It defines the competitor set (Competition and Differentiation).
- Every word in the lane keyword beyond the hero narrows the shelf and must become a gate co-term:
  gender or audience ("for women") -> `required_regex` plus `"audience"`; dose ("12 mg") -> `required_regex` on the dose;
  format ("gummies", "liquid", "powder") -> `gate_format` / `form`; delivery ("liposomal") -> `required_regex`.
- If the hero word has another meaning (pea, black garlic food), add `hero_exclude_regex` and `hero_strong_regex`.
- Audience shelves ("for women", "for men", "kids ...") also set `"audience": "women" | "men" | "kids"` (rules R1, R4).

## Demand rule (Gautam, 11 Nov 2026): a long-tail keyword never decides demand or growth
The old pre-registration rule (use the idea's own phrase whenever it has 100+ clicks) is replaced. It judged colostrum
capsules (845 clicks) and mastic gum capsules (788) on the lane phrase while "colostrum" has 15,509 and "mastic gum" 17,359.
- `demand_keyword` (required): the parent head term for the hero, the highest-click Datarova keyword that is just the
  ingredient (it must match `hero_regex`, and the spec's `form` if any). It is the primary for the demand gate and the D "a" band.
- `demand_cluster`: the parent plus every hero variant with data (format, dose, form, audience variants that match
  `hero_regex`). D's cluster band, CVR and growth use this cluster plus the lane cluster, up to 44 keywords.
- Both come from `python3 tools/demand_terms.py <spec> <log> "<parent candidate>" ...`, which logs every candidate's
  clicks and why the parent was chosen. Commit the log with the spec.
- `demand_growth.json` reports `primary_kw` (parent) and its clicks, `lane_kw` and `lane_clicks`, `agg_clicks` and
  `cluster_keywords_with_data`.
- **Lane fallback:** if the lane's top 12 has too few genuine sellers (thin shelf, fewer than 3 competitors, or fewer
  than 8 badged sellers), `python3 run_shelf.py fallback <lane run>` opens a run on the parent shelf (lane co-terms
  removed) flagged `scored_on: parent`, with the lane run linked. Code: `shelfscorer/lanes.py`; tests: `tests/test_demand_rule.py`.
- Hand decisions on a listing can be carried in the spec as `manual_decisions` (logged with who decided).

## Gautam's shelf rules (10 Nov 2026, after his first label round)
Code: `shelfscorer/fop_rules.py`, wired into the gate step (R4 on titles) and the front-of-pack step (all four).
Tests: `tests/test_fop_rules.py`. The front-of-pack reader quotes the front largest text first, so "first" means "first or bigger".
- **R1 Adults & Kids on a kids shelf:** IN only if kids is first or bigger on the front, else OUT. Any top-15 title naming
  kids and adults on a kids shelf gets a front-of-pack check.
- **R2 Condition-led formula containing the hero:** IN only if the hero is the biggest word on the front (`largest_text`),
  else OUT. Any top-15 title with condition wording (support, relief, flush, health, uric, sleep, ...) gets a check.
- **R3 Hero sharing the front equally with another ingredient:** IN (`co_leads`). The bigger-printed-dose rule still applies.
- **R4 Unisex ("men & women") product on a "for women" / "for men" shelf:** OUT, code EX_UNISEX at the gate, and a
  unisex front blocks a rescue.
