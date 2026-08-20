# Harness Notes — Phase B Golden Set

## Module split

### Moved into `supabase/functions/_shared/scoring_core.ts`

| Area | Functions |
|------|-----------|
| Types | `HybridFrame`, `HybridProduct`, `HybridAggregate`, `DemandRowLite`, `DemandPacket`, pillar/gate output types |
| Helpers | `n`, `nullableNumber`, `clamp`, `normalize`, `percentile`, `finiteNumber`, `statValue`, `priceFromCents`, `queryTokens`, `phraseHit` |
| Classification | `classifyHybridProduct`, `applyHybridClassification`, `titleTextForClassification`, `compareHybridProducts`, `selectKeepaEnrichmentTargets`, `mergeKeepaIntoClassifiedProducts`, `dedupeProductFamilies` |
| Aggregates | `emptyAggregate`, `computeAggregates` |
| Demand | `scoreKeywordFrameRelevance`, `selectFrameRelevantDemandPrimary`, `evaluateDemandQualityGate`, `buildDemandPacketFromRecords` |
| Phase B scoring | `qualityGate`, `computeDemandPillar`, `computeGrowthPillar`, `computeCompetitivePillar`, `parseDoseFromString`, `applyCompetitionGate`, `parsePlannedPrice`, `labelForScore`, `capTier` |
| Orchestrator | `runPhaseBDeterministicCore` |

`hybrid_scoring.ts` re-exports core symbols for Category Atlas and existing imports; it retains **network I/O only** (`runApifyDiscovery`, `enrichApifyProductsWithKeepa`, `runHybridQuery`, Keepa helpers, Apify normalization).

### Stays outside the core

| Step | Location | Why |
|------|----------|-----|
| Frame inference (Sonnet) | `phase-b-evaluate/index.ts` → `inferCompetitiveFrame` | LLM |
| Datarova HTTP fetch | `phase-b-evaluate/index.ts` → `fetchDatarovaPacket` | Network; calls `buildDemandPacketFromRecords` after fetch |
| Apify + Keepa discovery | `hybrid_scoring.ts` → `runHybridQuery` | Network |
| Differentiation pillar (Sonnet) | `phase-b-evaluate/index.ts` → `runDifferentiation` | LLM; frozen in fixtures as `inputs.differentiation` |
| DB persistence, messaging | `phase-b-evaluate/index.ts` | Side effects / prose |

## Node vs Deno

- **Core**: zero imports; runs under Node (`node --experimental-strip-types`) and Deno edge functions.
- **Replay**: `eval/golden-set/replay.mjs` imports `scoring_core.ts` directly (no new npm deps).
- **Deno check**: `deno` was not available in the build environment. Type-check locally with `deno check supabase/functions/phase-b-evaluate/index.ts` after installing Deno.

## npm dependencies

**None added.** Replay uses Node built-ins + TypeScript strip-types. `capture.mjs` uses existing `@supabase/supabase-js`.

## Stored DB evidence — coverage gaps

Honest limits when capturing from Supabase without re-running live APIs:

| Field | Replay fidelity | Gap |
|-------|-----------------|-----|
| `quality_gate_status` | High | Needs accurate `audit_products` bucket tags + demand summary counts |
| `pillar_demand_score` | Partial | `capture.mjs` may leave `demand.rows` empty; gate/score need row-level Datarova data — rebuild from `raw_api_responses` |
| `pillar_growth_score` | High if growth details stored | YoY/windows come from live Datarova monthly series; snapshot uses stored `pillar_growth_details` in demand block |
| `pillar_competitive_score` | Partial | `top_products` is top-15 included only, not full classified audit universe — subsignals can diverge vs live run |
| `pillar_diff_score` | Pass-through | Stored as frozen input; core does not recompute |
| `composite_score` / `recommendation_tier` | High when gate passes | Depends on pillars above + frozen diff input |
| `competition_gate` | High | Derived from competitive subsignals |
| `overall_assessment`, `opportunity_signals`, `risk_factors`, `next_steps` | **Not in replay** | Prose helpers remain in edge function only |
| Full classification replay | Partial | Needs raw Apify discovery list + frame; DB stores enriched top-N only |

Fields **not** faked: if evidence is insufficient, capture leaves gaps explicit (`capture_meta`, empty `demand.rows`) rather than inventing API payloads.

## Self-test fixture

`fixtures/_selftest/` — synthetic cayenne concept, hand-authored inputs, `expected.json` generated once by calling `runPhaseBDeterministicCore`. Proves the replay loop end-to-end.
