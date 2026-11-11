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

## Writing a shelf spec (rule added 9 Nov 2026; pre-registration rule replaced by the sleeve rule 11 Nov 2026)
A spec is written from the keyword only, before any run, and committed with its SHA.
- **Shelf keyword = the lane the idea names** ("colostrum capsules", "creatine gummies", "magnesium glycinate powder"),
  even when that phrase is small. It defines the competitor set (Competition and Differentiation).
- Every word in the lane keyword beyond the hero narrows the shelf and must become a gate co-term:
  gender or audience ("for women") -> `required_regex` plus `"audience"`; dose ("12 mg") -> `required_regex` on the dose;
  format ("gummies", "liquid", "powder") -> `gate_format` / `form`; delivery ("liposomal") -> `required_regex`.
- If the hero word has another meaning (pea, black garlic food), add `hero_exclude_regex` and `hero_strong_regex`.
- Audience shelves ("for women", "for men", "kids ...") also set `"audience": "women" | "men" | "kids"` (rules R1, R4).

## Sleeve rule (Gautam, 11 Nov 2026): judge a sleeve on every phrasing of it
Toniiq's system looks for sleeves: a format, dose, audience, variety or pairing inside a parent ("colostrum capsules",
"astaxanthin 24mg") with its own demand and weaker leaders. Parents are usually too competitive. This replaces both
the old pre-registration rule (take the idea's own phrase whenever it has 100+ clicks) and the same-morning
parent-keyword rule (score demand on the parent). The failure was reading a sleeve's demand off one exact phrase.
Code: `shelfscorer/sleeves.py`; tests: `tests/test_sleeve_rule.py`.
1. **Sleeve cluster.** Demand and growth come from every Datarova phrasing of the same sleeve: format synonyms
   (capsules, caps, pills, tablets, softgels), modifiers (bovine, organic, supplement, for women) and word order.
   Each phrasing must match `hero_regex`, the sleeve qualifier `sleeve_regex` and the spec's `form`, and must not name
   another format. Datarova has no related-keywords endpoint, so new phrasings come from Amazon autocomplete plus
   generated synonyms and word orders. The D "a" band and the D cluster band both read the sleeve cluster's clicks.
2. **The parent is context only.** Its clicks and trend are logged; Competition and Diff come from the sleeve's own top 12.
3. **Default format.** For a format sleeve, if 75%+ of the parent's top 12 by monthly-sold badge are already in the
   sleeve's format, the sleeve is the parent: the spec becomes the parent keyword and cluster with
   `scored_on: parent_default_format`. Doses, audiences, varieties and pairings are always sleeves.
4. **Sleeve gate.** A sleeve passes with >= 1,000 latest-month cluster clicks over 2+ keyword rows (checked before any
   Keepa spend) AND >= 2,000 summed monthly-sold badges in its top 12 (checked after ranking; a hard stop in the
   composite). Parent shelves keep the old gate on the parent keyword. `demand_growth.json` logs `demand_gate.path`;
   `score.json` logs `sleeve_sales_gate`.
5. **Spec fields.** `scored_on` (required: `sleeve`, `parent` or `parent_default_format`). A sleeve also sets
   `sleeve_kind`, `sleeve_regex`, `hero_names`, `parent_keyword` and `sleeve_cluster`. A parent sets `demand_keyword`
   (the head term) and `demand_cluster` (its phrasings), both from `tools/demand_terms.py`.
6. **Pre-registration.** `python3 tools/sleeve_terms.py <spec> <log>` pulls autocomplete and Datarova, writes
   `sleeve_cluster`, runs the default-format check on Keepa, and logs every phrasing with its latest clicks and
   12-month trend, the parent's clicks, the parent's top 12 with formats, and the share. Every call goes into a
   pre-registration run folder. Commit the log with the spec.
7. **Reporting.** Each shelf reports cluster clicks and keywords, parent clicks, the default-format share and the gate path.
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
