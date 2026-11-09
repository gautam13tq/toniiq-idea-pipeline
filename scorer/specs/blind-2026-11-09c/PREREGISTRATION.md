# Blind round 3 pre-registration, 9 Nov 2026 (5 fresh Atlas shelves, seed 20261112)

I wrote this before any run, Datarova pull or listing view for these shelves. The specs come from the keyword alone, following the spec-writing rules in scorer/README.md. Code: 7ac7119.

## Draw
- **Source:** the Supabase category_atlas_entries cache: 527 rows, 390 distinct entry_key. Where a key has several rows, the lowest id is used.
- **Exclusions:**
  - the 10 Atlas keys already used today (5 in round 1, 5 in round 2);
  - any key whose key, name or best keyword names a hero already tested: the round 2 list plus maca, probiotic, boswellia, coq10/ubiquinol and threonate.
- **Demand filter (tracker, 9 Nov):** best_keyword_clicks must be at least 100. best_keyword_sales must also be present, so each row has real Datarova numbers.
  - A first draw that used the click filter alone picked glp-1-support-drink-mix. Its only click figure (30,000) sits on a brand keyword, "leefar cutting mix", with no sales, and its Atlas score had failed a quality gate.
  - I added the sales condition (it drops 18 rows) and redrew with the same seed before writing any spec. Both draws are recorded here.
- **Pool:** 282 keys. Draw: `random.Random(20261112).sample(sorted(pool), 5)`.

| Atlas key | Best keyword (clicks / sales) | Shelf keyword |
|---|---|---|
| goldenseal-alkaloid-system | goldenseal (3,089 / 932) | "goldenseal" |
| tart-cherry-ratio-anthocyanin-system | tart cherry (7,050 / 2,370) | "tart cherry" |
| glutathione-nac-glynac | nac supplement (69,169 / 24,874) | "nac supplement" |
| mens-magnesium | magnesium complex for men (8,908 / 2,313) | "magnesium complex for men" |
| kids-magnesium-powder | kids magnesium (6,386 / 2,328) | "kids magnesium powder" (the Atlas primary keyword) |

## Co-terms (README rules)
- **goldenseal, tart cherry and nac supplement:** no narrowing words. ("supplement" is generic.)
- **magnesium complex for men:** required_regex needs a men word AND a complex word (complex, N forms, triple, multi-magnesium, full spectrum, N in 1). It rejects "men & women" wording, the same reading as creatine for women.
- **kids magnesium powder:** required_regex on kids, child or toddler, and gate_format powder.

## Also run
- Magnesium L-threonate is rerun on 7ac7119 with the round 2 spec, to confirm that the NOW Magtein 90 ct and 180 ct listings merge (shared reviews).

## Pass marks
- Same as rounds 1 and 2: every run has 0 failed BLOCKER checks and costs under $2.
- The report adds per-shelf counts of off-hero listings, merges and condition-led borderlines.

## Spec SHA-256
- e74f80628af497247ccc499eb91c978dc02f228106b2c8f93ad548c369a64f91  goldenseal.json
- d2d4e1235aad52d0c28a0ffc926a418ffb53b329f9e121d905f75642aa2740d5  kids-magnesium-powder.json
- 71ff61d2d1e211da91f11e00349a8a170cb89d3aa9e299062382cfbc6b1fe4f7  magnesium-complex-for-men.json
- 76dfd4185da450ce319de2f9338a44ea1dffcac0d99476e493c00db8c62549cc  nac-supplement.json
- 0eee12b4b1f3e35e9850ebf155e0503ede6b598f1a5a4f0789fb39498333e7f9  tart-cherry.json

## Amendment, 9 Nov 2026 (before any data call for NAC)
- **nac-supplement.json stopped at V-SPEC** before it made any data call. Its hero_regex did not match the cluster keyword "n acetyl cysteine", because the regex expected "n-acetyl" or "nacetyl" and the keyword has a space.
- **Fix:** hero_regex is now `\bnac\b|n[- ]?acetyl[- ]?(?:l[- ]?)?cysteine`. No other field changed.
- **New SHA:** 137d6852a55a48e2b8e2aba0cf68a60c44063ad3190c02d0ad7a64a76d6c9712  nac-supplement.json
