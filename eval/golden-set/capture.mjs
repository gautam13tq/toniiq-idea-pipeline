#!/usr/bin/env node
/**
 * Capture a Phase B golden-set fixture from Supabase stored evidence.
 *
 * Usage:
 *   SUPABASE_URL=... SUPABASE_SERVICE_KEY=... node eval/golden-set/capture.mjs <concept-id-or-slug>
 *
 * Writes:
 *   eval/golden-set/fixtures/<slug>/inputs.json
 *   eval/golden-set/fixtures/<slug>/expected.json
 *
 * Credentials are read from env at runtime only — never hardcoded or logged.
 */

import { createClient } from '@supabase/supabase-js'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const FIXTURES_DIR = join(__dirname, 'fixtures')

function requireEnv(name) {
  const value = process.env[name]
  if (!value) {
    console.error(`Missing required env var: ${name}`)
    process.exit(1)
  }
  return value
}

function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'concept'
}

function hybridProductFromTopRow(row, index) {
  const asin = String(row.asin || `CAPTURED${String(index).padStart(6, '0')}`).toUpperCase()
  return {
    asin,
    parent_asin: null,
    product_key: `${String(row.brand || 'unknown').toLowerCase()}|${String(row.title || asin).slice(0, 80).toLowerCase()}`,
    duplicate_asins: [asin],
    variant_count: 1,
    title: String(row.title || ''),
    brand: String(row.brand || ''),
    price: row.price ?? null,
    rating: row.rating ?? null,
    reviews: Number(row.reviews || 0),
    monthly_sold: Number(row.monthly_sold || 0),
    bsr_current: row.bsr_current ?? null,
    bsr_avg30: row.bsr_avg30 ?? null,
    bsr_avg90: null,
    classification: 'exact',
    bucket: 'included',
    lane_fit: row.lane_fit || 'hero_single',
    reason: 'Captured from concept_competitive_research.top_products',
    missing_query_tokens: [],
    other_ingredient_hits: [],
    amazon_url: row.amazon_url || null,
  }
}

async function resolveConceptId(sb, arg) {
  if (/^[0-9a-f-]{36}$/i.test(arg)) return arg
  const { data, error } = await sb
    .from('product_concepts')
    .select('id')
    .ilike('concept_name', `%${arg}%`)
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(`concept lookup failed: ${error.message}`)
  if (!data?.id) throw new Error(`No concept found matching "${arg}"`)
  return data.id
}

async function main() {
  const arg = process.argv[2]
  if (!arg) {
    console.error('Usage: SUPABASE_URL=... SUPABASE_SERVICE_KEY=... node eval/golden-set/capture.mjs <concept-id-or-slug>')
    process.exit(1)
  }

  const url = requireEnv('SUPABASE_URL')
  const key = requireEnv('SUPABASE_SERVICE_KEY')
  const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })

  const conceptId = await resolveConceptId(sb, arg)

  const { data: concept, error: conceptErr } = await sb
    .from('product_concepts')
    .select('id, concept_name, candidate_id, target_dosage, key_ingredients, target_price, planned_price, positioning_angle, format')
    .eq('id', conceptId)
    .single()
  if (conceptErr || !concept) throw new Error(`concept fetch failed: ${conceptErr?.message}`)

  const { data: score, error: scoreErr } = await sb
    .from('concept_scores')
    .select(`
      competitive_frame,
      pillar_demand_score,
      pillar_growth_score,
      pillar_growth_details,
      pillar_competitive_score,
      pillar_competitive_subsignals,
      pillar_diff_score,
      competition_gate,
      quality_gate_status,
      data_quality_summary,
      composite_score,
      recommendation_tier,
      composite_weights,
      diff_vectors_available,
      diff_vector_details
    `)
    .eq('concept_id', conceptId)
    .order('scored_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (scoreErr) throw new Error(`concept_scores fetch failed: ${scoreErr.message}`)
  if (!score) throw new Error('No concept_scores row found for concept')

  const { data: research, error: researchErr } = await sb
    .from('concept_competitive_research')
    .select('top_products, total_competitors')
    .eq('concept_id', conceptId)
    .order('researched_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (researchErr) throw new Error(`concept_competitive_research fetch failed: ${researchErr.message}`)

  const { data: enrichment, error: enrichErr } = await sb
    .from('datarova_enrichments')
    .select('raw_api_responses, related_keywords')
    .eq('candidate_id', concept.candidate_id)
    .order('enriched_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (enrichErr) throw new Error(`datarova_enrichments fetch failed: ${enrichErr.message}`)

  const frame = score.competitive_frame
  const topProducts = Array.isArray(research?.top_products) ? research.top_products : []
  const audit_products = topProducts.map(hybridProductFromTopRow)

  const summary = score.data_quality_summary || {}
  const inputs = {
    frame,
    demand: {
      source: summary.demand_source === 'datarova' ? 'datarova' : 'fallback',
      queries: frame?.query_packet || [],
      rows: [],
      primary_keyword: summary.demand_primary_keyword ?? null,
      primary_keyword_clicks: summary.demand_primary_clicks ?? null,
      primary_keyword_sales: null,
      frame_relevant_clicks: summary.demand_frame_relevant_clicks ?? null,
      frame_relevant_row_count: summary.demand_frame_relevant_rows ?? 0,
      total_clicks: null,
      total_sales: null,
      weighted_conversion_pct: null,
      growth_3m_pct: score.pillar_growth_details?.growth_3m_pct ?? null,
      growth_6m_pct: score.pillar_growth_details?.growth_6m_pct ?? null,
      growth_12m_pct: score.pillar_growth_details?.growth_12m_pct ?? null,
      latest_month: score.pillar_growth_details?.latest_month ?? null,
      baseline_month: score.pillar_growth_details?.baseline_month ?? null,
      total_monthly_data_points: summary.demand_total_monthly_data_points ?? 0,
    },
    audit_products,
    enrichment: {
      top_results: [],
      audit_products: [],
      review_p50: null,
      review_p90: null,
      review_max: null,
      rating_p50: null,
      price_p50: null,
      sales_top3_share: null,
      distinct_brands: null,
      result_count: audit_products.length,
      confidence: 'low',
      monthly_sold_coverage: summary.monthly_sold_badge_count ?? 0,
      bsr_best: null,
      bsr_p50: null,
      bsr_p90: null,
      result_quality: {
        discovery_result_count: summary.discovery_result_count ?? 0,
        included_count: summary.included_count ?? audit_products.length,
        adjacent_count: summary.adjacent_count ?? 0,
        excluded_count: summary.excluded_count ?? 0,
      },
      tokens_consumed: summary.keepa_tokens_consumed ?? 0,
      refill_rate: null,
      query_packet: frame?.query_packet || [],
    },
    concept: {
      concept_name: concept.concept_name,
      target_dosage: concept.target_dosage,
      key_ingredients: concept.key_ingredients,
      target_price: concept.target_price,
      planned_price: concept.planned_price,
      positioning_angle: concept.positioning_angle,
      format: concept.format,
    },
    differentiation: {
      score: score.pillar_diff_score ?? 0,
      vectors_available: score.diff_vectors_available ?? 0,
      vector_total: null,
      vector_details: score.diff_vector_details ?? {},
      reasoning: '',
    },
    capture_meta: {
      concept_id: conceptId,
      datarova_raw_api_responses: enrichment?.raw_api_responses ?? null,
      datarova_related_keywords: enrichment?.related_keywords ?? null,
      note: 'demand.rows may be empty — rebuild with buildDemandPacketFromRecords if raw_api_responses present',
    },
  }

  const expected = {
    quality_gate_status: score.quality_gate_status,
    quality_gate_reason: score.quality_gate_status === 'passed' ? 'all gates passed' : null,
    data_quality_summary: score.data_quality_summary,
    pillar_demand_score: score.pillar_demand_score,
    pillar_growth_score: score.pillar_growth_score,
    pillar_growth_details: score.pillar_growth_details,
    pillar_competitive_score: score.pillar_competitive_score,
    pillar_competitive_subsignals: score.pillar_competitive_subsignals,
    pillar_diff_score: score.pillar_diff_score,
    composite_score: score.composite_score,
    recommendation_tier: score.recommendation_tier,
    composite_weights: score.composite_weights,
    competition_gate: score.competition_gate,
    diff_vectors_available: score.diff_vectors_available,
    diff_vector_details: score.diff_vector_details,
  }

  const slug = slugify(concept.concept_name || conceptId)
  const outDir = join(FIXTURES_DIR, slug)
  mkdirSync(outDir, { recursive: true })
  writeFileSync(join(outDir, 'inputs.json'), `${JSON.stringify(inputs, null, 2)}\n`)
  writeFileSync(join(outDir, 'expected.json'), `${JSON.stringify(expected, null, 2)}\n`)

  console.log(`Captured fixture: ${outDir}`)
  console.log(`  concept_id=${conceptId}`)
  console.log(`  quality_gate_status=${score.quality_gate_status}`)
  console.log(`  included_products=${audit_products.length}`)
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
})
