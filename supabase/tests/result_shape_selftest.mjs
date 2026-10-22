#!/usr/bin/env node
/**
 * Piece 1 acceptance check: the _selftest golden fixture, stored the way
 * phase-b-evaluate stores it, comes back through idea_score_result() with the
 * same composite, tier and pillars that eval:phase-b computes.
 *
 * Usage: PGURL=postgres://... node --experimental-strip-types supabase/tests/result_shape_selftest.mjs
 * PGURL must point at a disposable database with the baseline tables and the
 * piece 1 migration (see supabase/tests/README.md). Writes are rolled back.
 */

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runPhaseBDeterministicCore } from '../functions/_shared/scoring_core.ts'

const __dirname = dirname(fileURLToPath(import.meta.url))
const fixtureDir = join(__dirname, '../../eval/golden-set/fixtures/_selftest')
const inputs = JSON.parse(readFileSync(join(fixtureDir, 'inputs.json'), 'utf8'))
const expected = JSON.parse(readFileSync(join(fixtureDir, 'expected.json'), 'utf8'))
const core = runPhaseBDeterministicCore(inputs)

const pgUrl = process.env.PGURL
if (!pgUrl) {
  console.error('Set PGURL to a disposable test database.')
  process.exit(2)
}

const text = value => `'${String(value).replace(/'/g, "''")}'`
const lit = value => `${text(JSON.stringify(value ?? null))}::jsonb`
const included = inputs.audit_products.filter(p => p.bucket === 'included')
// Same projection as writeCompetitiveResearch() in phase-b-evaluate.
const topProducts = included.slice(0, 15).map(p => ({
  asin: p.asin, brand: p.brand, title: p.title, price: p.price, rating: p.rating,
  reviews: p.reviews, monthly_sold: p.monthly_sold, bsr_current: p.bsr_current,
  bsr_avg30: p.bsr_avg30, lane_fit: p.lane_fit, amazon_url: `https://www.amazon.com/dp/${p.asin}`,
}))

// Data-modifying CTEs are invisible to their own statement, so the result is read
// in a second statement.
const sql = `
BEGIN;
CREATE TEMP TABLE selftest_score ON COMMIT DROP AS
WITH cand AS (
  INSERT INTO idea_candidates (ingredient_name, ingredient_name_normalized)
  VALUES ('Selftest Cayenne', 'selftest cayenne') RETURNING id
), con AS (
  INSERT INTO product_concepts (candidate_id, concept_name, concept_type, status)
  SELECT id, ${text(inputs.concept.concept_name)}, 'single_ingredient', 'accepted' FROM cand RETURNING id
), res AS (
  INSERT INTO concept_competitive_research (concept_id, top_products, researched_at)
  SELECT id, ${lit(topProducts)}, now() - interval '2 seconds' FROM con
), sc AS (
  INSERT INTO concept_scores (concept_id, scoring_version, competitive_frame,
    pillar_demand_score, pillar_growth_score, pillar_growth_details, pillar_competitive_score,
    pillar_competitive_subsignals, pillar_diff_score, competition_gate, quality_gate_status,
    data_quality_summary, composite_score, composite_weights, recommendation_tier,
    diff_vectors_available, diff_vector_details, scored_at)
  SELECT id, 'phase-b-v5-hybrid-competitive', ${lit(inputs.frame)},
    ${core.pillar_demand_score}, ${core.pillar_growth_score}, ${lit(core.pillar_growth_details)},
    ${core.pillar_competitive_score}, ${lit(core.pillar_competitive_subsignals)}, ${core.pillar_diff_score},
    ${lit(core.competition_gate)}, 'passed', ${lit(core.data_quality_summary)}, ${core.composite_score},
    ${lit(core.composite_weights)}, '${core.recommendation_tier}',
    ${core.diff_vectors_available ?? 'NULL'}, ${lit(core.diff_vector_details)}, now()
  FROM con RETURNING id
)
SELECT id FROM sc;
SELECT idea_score_result(id) FROM selftest_score;
ROLLBACK;
`

const out = execFileSync('psql', [pgUrl, '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1'], { input: sql, encoding: 'utf8' })
const result = JSON.parse(out.trim().split('\n').find(line => line.startsWith('{')))

const checks = [
  ['composite', result.composite, expected.composite_score],
  ['tier', result.tier, expected.recommendation_tier],
  ['pillars.demand', result.pillars.demand, expected.pillar_demand_score],
  ['pillars.growth', result.pillars.growth, expected.pillar_growth_score],
  ['pillars.competitive', result.pillars.competitive, expected.pillar_competitive_score],
  ['pillars.differentiation', result.pillars.differentiation, expected.pillar_diff_score],
  ['gate.status', result.gate.status, expected.quality_gate_status],
  ['cap_applied', JSON.stringify(result.cap_applied), JSON.stringify(expected.competition_gate.caps_applied)],
  ['competitive_signals.review_moat', result.competitive_signals.review_moat, expected.pillar_competitive_subsignals.review_moat.score],
  ['competitive_signals.spec', result.competitive_signals.spec, expected.pillar_competitive_subsignals.spec_wedge.score],
  ['demand.primary_keyword', result.demand.primary_keyword, expected.data_quality_summary.demand_primary_keyword],
  ['data_quality.included', result.data_quality.included, expected.data_quality_summary.included_count],
  ['scale', result.scale, '0-100'],
  ['competitors.length', result.competitors.length, Math.min(10, included.length)],
  ['frame.hero', result.frame.hero, inputs.frame.hero_ingredient],
]

let failed = 0
for (const [name, actual, want] of checks) {
  const ok = Number.isFinite(want) ? Number(actual) === want : actual === want
  if (!ok) {
    failed++
    console.error(`FAIL ${name}: expected ${want}, got ${actual}`)
  }
}
if (core.composite_score !== expected.composite_score) {
  failed++
  console.error(`FAIL core drift: eval core gives ${core.composite_score}, fixture expects ${expected.composite_score}`)
}
if (failed) process.exit(1)
console.log(`result shape selftest: ${checks.length} checks passed (composite ${result.composite}, ${result.tier})`)
