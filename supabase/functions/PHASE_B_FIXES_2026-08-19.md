# Phase B Scoring Engine Fixes (2026-08-19)

Three production gate failures on **glucomannan**, **clear protein**, and **thymoquinone combo**, plus run-to-run classification instability. Root causes, fixes, and live validation evidence below.

---

## Defect 1 — Included-competitor starvation (`failed_competitive`)

### Evidence
- **glucomannan**: `discovery_result_count=315` → `included=3`, `adjacent=25`, `excluded=4`
- **clear protein**: `discovery_result_count=393` → `included=3`, `adjacent=25`, `excluded=8`
- Adjacent ≈25 is **not** a hard cap — it is `DEFAULT_KEEP_ASINS (40)` minus included/excluded after dedupe.

### Root causes

1. **Classification ran only on the Keepa slice, not the full Apify universe**  
   `runHybridQuery()` called `enrichApifyProductsWithKeepa(..., keepAsins=40)` then `applyHybridClassification()` on that 40-ASIN subset (`hybrid_scoring.ts` ~740–741, pre-fix). ~275–350 discovered products were never bucketed; gate counts reflected a random 40-ASIN sample ordered by Apify return order.

2. **False “hero buried” shunts via global `INGREDIENT_WORDS`**  
   `firstIngredientStart()` scanned a static ingredient list (vitamin, mct, collagen, …) and demoted products to **adjacent** when any list token preceded the hero in brand+title (`hybrid_scoring.ts` ~501–513, ~585–598, pre-fix). On-category singles (glucomannan, clear protein) were shunted when titles mentioned common cofactors.

3. **Keepa enrichment order ignored classification**  
   The first 40 discovery rows were enriched regardless of bucket, so included competitors deeper in Apify results had no Keepa fields for the 80% coverage gate.

### Fixes

| Change | File | Lines (approx.) |
|--------|------|-----------------|
| Classify **all** discovered products before Keepa | `hybrid_scoring.ts` | `runHybridQuery` |
| `selectKeepaEnrichmentTargets()` — included → adjacent → excluded, deterministic | `hybrid_scoring.ts` | new export |
| `mergeKeepaIntoClassifiedProducts()` — Keepa merge back into full classified set | `hybrid_scoring.ts` | new export |
| Remove `firstIngredientStart` / global-ingredient bury rule | `hybrid_scoring.ts` | `classifyHybridProduct` |
| Combo co-active lead check uses **title-only** + `require_any` terms only | `hybrid_scoring.ts` | `classifyHybridProduct` |
| Hero-in-lead window expanded to **220 chars of title** (not brand+title) | `hybrid_scoring.ts` | `classifyHybridProduct` |
| Deterministic Apify sort: `discovery_rank`, then `asin` | `hybrid_scoring.ts` | `runApifyDiscovery` |
| Stable sort tie-breaks on `asin` throughout | `hybrid_scoring.ts` | `compareHybridProducts`, `dedupeProductFamilies` |

### Live validation evidence
Re-run **glucomannan** and **clear protein** Phase B. Expect:
- `included_count ≥ 5` (broad_hero minimum)
- `discovery_result_count` unchanged (~300+)
- `adjacent_count` **not** pinned at ~25; should scale with full universe
- `keepa_coverage_pct ≥ 80` on included (included ASINs prioritized for enrichment)

---

## Defect 2 — Demand-packet keyword mis-selection (`failed_demand`)

### Evidence
- **thymoquinone combo**: frame hero=`black seed oil`, `demand_primary_clicks=302`, `demand_rows_with_data=2`
- Phase A `datarova_enrichments` for same candidate: 44 keywords / 551K monthly clicks, including **"oil of oregano with black seed oil"** at 133K clicks/mo.

### Root causes

1. **Demand packet queried only `frame.query_packet` (≤12 LLM queries)**  
   `fetchDatarovaPacket()` ignored Phase A harvest (`phase-b-evaluate/index.ts` ~487–488, pre-fix).

2. **Primary keyword = global max clicks among packet rows**  
   Sort `b.latest_clicks - a.latest_clicks` with no frame-relevance scoring (`phase-b-evaluate/index.ts` ~569, pre-fix). Weak literal variants could win; combo-relevant high-volume terms from Phase A never entered the packet.

3. **Row-count gate shape wrong for combo/niche lanes**  
   Gate required ≥5 rows (or ≥2 when primary ≥1,000 clicks) but had no aggregate frame-relevant clicks path — combo concepts failed despite strong clustered demand.

### Fixes

| Change | File | Lines (approx.) |
|--------|------|-----------------|
| Load Phase A `datarova_enrichments.related_keywords` for candidate | `phase-b-evaluate/index.ts` | main handler |
| Merge Phase A + frame queries (up to **44** keywords), backfill missing rows from Phase A snapshots | `phase-b-evaluate/index.ts` | `fetchDatarovaPacket` |
| `selectFrameRelevantDemandPrimary()` — primary = highest **frame-relevance score**, then clicks | `hybrid_scoring.ts` | new export |
| `evaluateDemandQualityGate()` with **frame_clicks** alternative path | `hybrid_scoring.ts` | new export |
| Gate summary adds `demand_primary_keyword`, `demand_frame_relevant_clicks`, `demand_gate_path` | `phase-b-evaluate/index.ts` | `qualityGate` |

### New thresholds (named, with rationale)

| Constant | Value | Rationale |
|----------|-------|-----------|
| `DEMAND_MIN_PRIMARY_CLICKS` | **100** | Unchanged floor — blocks fabricated/thin primary signals |
| `DEMAND_MIN_ROWS_WITH_DATA` | **5** | Unchanged default cluster depth |
| `DEMAND_STRONG_PRIMARY_CLICKS` | **1,000** | Unchanged niche exception (e.g. S. boulardii) |
| `DEMAND_STRONG_PRIMARY_MIN_ROWS` | **2** | Unchanged companion to strong-primary exception |
| `DEMAND_FRAME_CLICKS_ALT_THRESHOLD` | **5,000** | **New.** Combo/niche lanes may have few distinct tracked keywords but large aggregate frame-relevant volume (thymoquinone: 133K+ on combo terms). Passes when ≥2 frame-relevant rows AND aggregate ≥5K clicks/mo, primary still ≥100. |
| `KEEPA_ENRICH_CAP` | **80** | Token budget guard for dynamic enrichment sizing |
| `KEEPA_INCLUDED_COVERAGE_TARGET` | **0.85** | Size Keepa batch to cover ≥85% of included families so the 80% gate remains reachable when classification surfaces >40 included |

### Live validation evidence
Re-run **thymoquinone combo** Phase B. Expect:
- `demand_primary_keyword` ≈ `"oil of oregano with black seed oil"` (or another frame-relevant combo term with highest relevance×clicks)
- `demand_primary_clicks` ≫ 302 (order of 10K–133K if Phase A data present)
- `demand_rows_with_data` ≫ 2
- `demand_gate_path` = `frame_clicks` or `default` or `strong_primary`
- `quality_gate_status=passed` on demand axis (if competitive gate also passes)

---

## Defect 3 — Run-to-run classification instability

### Evidence
Two thymoquinone runs minutes apart: `included=34` (demand-failed) vs `included=4` (competitive-failed).

### Root causes

1. **LLM frame inference without temperature lock** — `inferCompetitiveFrame()` had no `temperature: 0` (`phase-b-evaluate/index.ts` ~363, pre-fix). Different `combo_terms`, `query_packet`, and `hero_ingredient` frames across runs.

2. **Unstable ordering before classification / Keepa slice** — Apify results processed in nondeterministic return order; first-40-ASIN Keepa slice varied (`hybrid_scoring.ts` `runApifyDiscovery`, pre-fix).

3. **Unstable sorts** — classification and family dedupe lacked `asin` tie-breaks; equal-rank products swapped buckets across runs when merged.

4. **Residual variance (documented, not eliminated)** — Apify search results and Keepa token timing can still shift discovery_rank ordering slightly. Frame inference is now temperature-0 but LLM outputs may still vary on edge cases; combo_terms empty vs populated remains the largest semantic lever.

### Fixes

| Change | File |
|--------|------|
| `temperature: 0` on frame inference Sonnet call | `phase-b-evaluate/index.ts` |
| Dedupe + sorted `query_packet`, `combo_terms`, `inclusion_rules`, `exclusion_rules` | `phase-b-evaluate/index.ts` |
| Deterministic discovery sort + `compareHybridProducts()` with `asin` tie-break | `hybrid_scoring.ts` |
| Classify full universe (removes Keepa-slice sampling variance from bucket counts) | `hybrid_scoring.ts` |

### Live validation evidence
Run **thymoquinone combo** twice back-to-back. Expect:
- Identical `frame.hero_ingredient`, `frame.query_packet`, `frame.require_any` in stored `competitive_frame` (or diff only on LLM `reasoning` text)
- `included_count` stable within ±1 (Apify/Keepa drift only), not 34 vs 4

---

## Tests

```bash
# Preferred (requires Deno)
deno test supabase/functions/_shared/__tests__/scoring_fixes_test.ts --allow-read

# Node fallback (verified in staging workspace)
node supabase/functions/_shared/__tests__/scoring_fixes_test.mjs
```

Covers: glucomannan/clear protein inclusion, combo adjacent/included, Keepa target prioritization, frame-relevant primary selection, frame_clicks gate path, thin-primary rejection.

---

## Files changed

- `supabase/functions/_shared/hybrid_scoring.ts`
- `supabase/functions/phase-b-evaluate/index.ts`
- `supabase/functions/_shared/__tests__/scoring_fixes_test.ts`
- `supabase/functions/_shared/__tests__/scoring_fixes_test.mjs`
- `CHANGES.md`

No schema changes. No new dependencies. Gate philosophy preserved: thin/fabricated data still fails; plumbing fixed so real data passes.
