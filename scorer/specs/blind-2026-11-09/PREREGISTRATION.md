# Blind test pre-registration, 9 Nov 2026 (section 7C, the 10 shelves that do not need Gautam)

Written before any run, Datarova pull or listing view for these shelves. Specs were written from the keyword only.
Code under test: branch shelf-scorer-v1 at 00157526d63b00b240b8e055e2de91f4da6f2597 (gate v11.3, frozen). Runs use that commit plus this spec commit only.

## Draw (seed 20261110)
- Dashboard (product-dev/ideas-dashboard/ideas.json, 96 rows): the four named shelves (Astaxanthin 12 mg, S. boulardii, Black garlic, Magnesium glycinate gummies), plus one drawn with `random.Random(20261110).choice(sorted(ideas))` from the 90 rows left after removing those four and the two golden-set shelves (Lactoferrin, PEA). Draw: **L-theanine liquid drops**.
- Category Atlas (Supabase category_atlas_entries, 527 rows, 390 distinct entry_key): `random.Random(20261110).sample(sorted(distinct entry_key), 5)`. Where an entry_key has more than one row, the row with the lowest id is used. Draw: inulin-prebiotic-fiber-powder, rice-germ-spermidine-system (shelf: spermidine), creatine-for-women-flavored, nad-booster-powder, urolithin-a (lowest id is the liposomal row, shelf: liposomal urolithin a).

## Runs
- One full live run per shelf (new, go, validate), $2 cap each, no publish.
- Astaxanthin 12 mg run twice, live, back to back, for stability.

## Pass marks recorded now (from section 7C; Gautam's labels come later)
- Every run: 0 failed BLOCKER checks; cost under $2.
- Stability: the two astaxanthin 12 mg scores within 1.0.
- Astaxanthin 12 mg's twelve include its fortress sellers (Sports Research, BioAstin / Nutrex).
- Top-12 precision (>= 95%), P2 to P4 = 0, false drops <= 5% and E7 agreement need Gautam's labels and are not judged here.

## Known limitation, stated before running
- Spec field dose_lane (section 3.0) is not implemented in v1 code, so the astaxanthin 12 mg gate admits any astaxanthin dose; the 12 mg lane is carried only by the demand keyword.

## Spec SHA-256
- b1dcd733262abe8c5e90d101f9c3ee33fd4545cbf5f70c3a8e9cf7582861451f  astaxanthin-12mg.json
- 848b6ed53523b34858d24613532013517636ade1a306900dc6f086ab2092e22f  black-garlic.json
- 93b4132f148f8c13819dc0b021331ea8db501431e7cad9f13223f9d988668ca2  creatine-for-women.json
- c6c561b9bb9c78d86cfe58f5454ce29d356df86491663dadafa10c9fe490dc05  inulin-powder.json
- 5b68c70a97be2b5e627e2d363c3adaf8c6e712a25cf7e21f14e74e770bcd740b  l-theanine-liquid.json
- 2fab06d408ef827cdd0b7f6cde6f8134202be870bb2e0cbea80a0b942daf1149  liposomal-urolithin-a.json
- 8f70227d44b2eeb4924145fdb85a8639eab4fcca67ce29c01d295b03296b1734  magnesium-glycinate-gummies.json
- 8cb83d7d3064373989894d430fc9d1530e847c36dba2e5a52a9ec34a98469046  nad-booster.json
- 71e1162bbfeaa5947b2e6a0ee08b366fb2434e0eb7dc107d7c5745c9144dfe9c  saccharomyces-boulardii.json
- 4f6e98d8e0e0233ccd6a0a09495e696c24a2fb0db5e034eaf4c5b8cc2edf0af5  spermidine.json
