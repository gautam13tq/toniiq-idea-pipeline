/**
 * market-curation-run - Niche Curation v4 monthly strategic curation.
 *
 * v4 is built around two separate evidence layers:
 *   - POE/Datarova: niche demand, growth, conversion, price context.
 *   - Keepa Stage A: ASIN-level BSR/review/rating/price quality signals.
 *
 * The function stores every deterministic candidate in market_curation_candidates,
 * then asks Claude to make a final Toniiq strategic judgment over the best
 * source-grounded candidates. This is not Phase B and must not invent Tier 1 data.
 */

import { corsHeaders } from '../_shared/cors.ts'
import {
  anthropicCall,
  extractJson,
  extractText,
  SONNET,
  svcClient,
} from '../_shared/clients.ts'

const PROMPT_VERSION = 'market-curation-v4-keepa-stage-a'
const FINAL_MODEL = SONNET
const DEFAULT_FINAL_PICK_COUNT = 12
const DEFAULT_MAX_ROWS_TO_SCORE = 50
const DEFAULT_LLM_CANDIDATE_LIMIT = 45

const HARD_NOISE_EXACT = new Set([
  'vitamins', 'supplements', 'weight loss', 'sleep aid', 'energy', 'detox',
  'cleanse', 'diet', 'protein', 'probiotic', 'probiotics', 'multivitamin',
  'gummy', 'gummies',
])

const ROOT_MARKET_EXACT = new Set([
  'vitamin c', 'vitamin d', 'vitamin e', 'vitamins', 'creatine',
  'collagen powder', 'fish oil', 'probiotics for women', 'melatonin',
  'ashwagandha', 'magnesium glycinate',
])

const BADGE_ONLY_SOURCE = 'keepa_bsr_monthlySold_badge'

interface PoeRow {
  id: string
  candidate_id: string
  customer_need: string
  top_search_term_1: string | null
  top_search_term_2: string | null
  top_search_term_3: string | null
  search_volume_360d: number | null
  search_volume_growth_180d: number | null
  search_volume_90d: number | null
  search_volume_growth_90d: number | null
  units_sold_lower_360d: number | null
  units_sold_upper_360d: number | null
  avg_units_sold_lower_360d: number | null
  avg_units_sold_upper_360d: number | null
  top_clicked_products: number | null
  avg_price_usd: number | null
  min_price_usd: number | null
  max_price_usd: number | null
  return_rate: number | null
  flagged_high_opportunity: boolean | null
  import_date: string
}

interface CandidateRow {
  id: string
  ingredient_name: string
  ingredient_name_normalized?: string | null
  category?: string | null
  stage?: string | null
}

interface DatarovaRow {
  candidate_id: string
  keyword: string
  import_date: string
  search_volume: number | null
  search_volume_trend: number | null
  conversion_rate: number | null
  avg_price: number | null
  monthly_revenue_est: number | null
}

interface EnrichmentRow {
  id: string
  poe_snapshot_id: string
  query: string
  query_type: 'customer_need' | 'top_term_1' | 'top_term_2' | 'top_term_3'
  top_results: any[]
  review_p50: number | null
  review_p90: number | null
  review_max: number | null
  rating_p50: number | null
  price_p50: number | null
  sales_top3_share: number | null
  distinct_brands: number | null
  result_count: number | null
  confidence: string | null
  error: string | null
  source: string | null
  source_version: string | null
  sales_signal_source: string | null
  monthly_sold_coverage: number | null
  bsr_best: number | null
  bsr_p50: number | null
  bsr_p90: number | null
  result_quality: any
}

interface RegistryRow {
  product: string
  queue: string | null
  state: string | null
  priority: string | null
  lv_band: string | null
  last_updated: string | null
}

interface ScoredCandidate {
  id: string
  poe: PoeRow
  candidate: CandidateRow
  enrichment: EnrichmentRow
  datarova: DatarovaRow | null
  registry_match: any
  metrics: {
    click_concentration: number
    brand_concentration: number
    concentration: number
    review_moat: number
    attackability: number
    growth: number
    acceleration: number
    price_modifier: number
    demand_quality: number
    specificity: number
    core_opportunity: number
    market_size_intent: number
    early_market_access: number
    growth_timing: number
    differentiation_proxy: number
    composite_score: number
  }
  filter_drops: string[]
  high_return_warning: boolean
  lens: 'launch_wedge' | 'niche_root' | 'anomalous_growth'
}

function n(value: unknown, fallback = 0) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function nullableNumber(value: unknown) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function clamp(value: number, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value))
}

function normalize(value: string) {
  return String(value || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9+\s-]/g, ' ')
    .replace(/\b(supplements?|capsules?|powders?|gumm(y|ies)|tablets?|softgels?|liquid|organic|pure|natural|extra strength|maximum strength)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function compactNumber(value: unknown) {
  const parsed = nullableNumber(value)
  return parsed === null ? null : Math.round(parsed)
}

function logScore(value: unknown, min: number, max: number) {
  const parsed = n(value)
  if (parsed <= 0) return 0
  const low = Math.log10(min)
  const high = Math.log10(max)
  return clamp((Math.log10(parsed) - low) / (high - low))
}

function priceScore(value: unknown) {
  const price = n(value)
  if (price <= 0) return 0.3
  if (price < 14) return 0.25
  if (price <= 28) return 0.55 + ((price - 14) / 14) * 0.25
  if (price <= 55) return 0.8 + ((price - 28) / 27) * 0.2
  return 0.85
}

function conversionScore(value: unknown) {
  const parsed = n(value)
  if (parsed <= 0) return 0.35
  const pct = parsed > 1 ? parsed : parsed * 100
  return clamp(pct / 22)
}

function growthScore(...values: unknown[]) {
  const nums = values
    .map(value => nullableNumber(value))
    .filter((value): value is number => value !== null)
  if (!nums.length) return 0.4
  const avg = nums.reduce((sum, value) => sum + value, 0) / nums.length
  return clamp((avg + 0.05) / 0.45)
}

function reviewMoatScore(enrichment: EnrichmentRow) {
  const p50 = logScore(enrichment.review_p50, 400, 50_000)
  const p90 = logScore(enrichment.review_p90, 800, 80_000)
  const max = logScore(enrichment.review_max, 1_500, 120_000)
  return clamp((p50 * 0.55) + (p90 * 0.25) + (max * 0.20))
}

function specificityScore(query: string, customerNeed: string) {
  const key = normalize(query || customerNeed)
  if (!key) return 0.2
  if (HARD_NOISE_EXACT.has(key)) return 0.15
  if (ROOT_MARKET_EXACT.has(key)) return 0.35

  const tokens = key.split(/\s+/).filter(Boolean)
  const hasModifier = /\b(for women|for men|d3 k2|mk-7|hmb|1000mg|500mg|extract|standardized|liposomal|saccharomyces|creapure|glycinate|threonate|complex|glp-?1|aged|sac|strain)\b/.test(key)
  if (hasModifier && tokens.length >= 2) return 0.95
  if (tokens.length >= 4) return 0.85
  if (tokens.length === 3) return 0.75
  if (tokens.length === 2) return 0.62
  return 0.4
}

function brandConcentrationScore(distinctBrands: unknown) {
  const brands = n(distinctBrands)
  if (!brands) return 0.55
  return clamp(1 - ((brands - 2) / 8), 0.05, 0.95)
}

function clickConcentrationScore(topClickedProducts: unknown) {
  const count = n(topClickedProducts)
  if (!count) return 0.55
  return clamp(1 - ((count - 5) / 95), 0.05, 0.95)
}

function resultQualityScore(enrichment: EnrichmentRow) {
  const quality = enrichment.result_quality || {}
  const scored = n(quality.scored_count || enrichment.result_count)
  const single = n(quality.single_ingredient_count)
  const coverage = n(quality.monthly_sold_coverage || enrichment.monthly_sold_coverage)
  const countScore = clamp(scored / 10)
  const singleScore = scored > 0 ? clamp(single / scored) : 0
  const coverageScore = clamp(coverage / 5)
  return clamp((countScore * 0.45) + (singleScore * 0.35) + (coverageScore * 0.20))
}

function lensFor(scored: Omit<ScoredCandidate, 'lens'>): ScoredCandidate['lens'] {
  const { metrics } = scored
  if (metrics.specificity >= 0.72 && metrics.attackability >= 0.18) return 'launch_wedge'
  if (metrics.growth_timing >= 7.5 && metrics.specificity >= 0.55) return 'anomalous_growth'
  return 'niche_root'
}

function filterDrops(poe: PoeRow, enrichment: EnrichmentRow, metrics: ScoredCandidate['metrics']) {
  const drops: string[] = []
  const key = normalize(enrichment.query || poe.customer_need)
  const need = normalize(poe.customer_need)
  if (enrichment.source !== 'keepa_product_finder') drops.push('legacy_or_missing_keepa_source')
  if (enrichment.error) drops.push(enrichment.error)
  if (HARD_NOISE_EXACT.has(key) || HARD_NOISE_EXACT.has(need)) drops.push('generic_or_non_actionable_root')
  if (n(enrichment.result_count) < 5) drops.push('thin_keepa_result_set')
  if (metrics.review_moat >= 0.78 && metrics.specificity < 0.62) drops.push('fortress_root_market')
  if (metrics.composite_score < 32) drops.push('low_stage_a_score')
  return [...new Set(drops)]
}

function scoreCandidate(poe: PoeRow, candidate: CandidateRow, enrichment: EnrichmentRow, datarova: DatarovaRow | null, registryMatch: any): ScoredCandidate {
  const quality = resultQualityScore(enrichment)
  const clickConcentration = clickConcentrationScore(poe.top_clicked_products)
  const brandConcentration = brandConcentrationScore(enrichment.distinct_brands)
  const concentration = Math.max(clickConcentration, brandConcentration)
  const reviewMoat = reviewMoatScore(enrichment)
  const attackability = clamp((1 - concentration) * (1 - reviewMoat) * (0.65 + quality * 0.35))

  const growth = growthScore(poe.search_volume_growth_90d, poe.search_volume_growth_180d, datarova?.search_volume_trend)
  const acceleration = clamp((n(poe.search_volume_growth_90d) - n(poe.search_volume_growth_180d) + 0.2) / 0.5)
  const price = nullableNumber(enrichment.price_p50) || nullableNumber(poe.avg_price_usd) || nullableNumber(datarova?.avg_price)
  const pScore = priceScore(price)
  const pModifier = clamp(0.7 + pScore * 0.6, 0.7, 1.3)
  const demandQuality = clamp((conversionScore(datarova?.conversion_rate) * 0.65) + (quality * 0.35))
  const specificity = specificityScore(enrichment.query, poe.customer_need)

  const poeVolume = Math.max(n(poe.search_volume_90d), n(datarova?.search_volume), n(poe.search_volume_360d) / 4)
  const nicheUnits = n(poe.units_sold_upper_360d) || n(poe.units_sold_lower_360d)
  const volumeScore = Math.max(logScore(poeVolume, 15_000, 3_000_000), logScore(nicheUnits, 5_000, 600_000))
  const marketSizeIntent = clamp((volumeScore * 0.45) + (demandQuality * 0.25) + (pScore * 0.20) + (quality * 0.10)) * 10
  const earlyMarketAccess = clamp((attackability * 0.72) + ((1 - reviewMoat) * 0.18) + (specificity * 0.10)) * 10
  const growthTiming = clamp((growth * 0.72) + (acceleration * 0.18) + (poe.flagged_high_opportunity ? 0.10 : 0)) * 10
  const differentiationProxy = clamp((specificity * 0.45) + (pScore * 0.20) + ((1 - reviewMoat) * 0.20) + (quality * 0.15)) * 10
  const coreOpportunity = clamp(attackability * growth * pModifier * specificity)
  const compositeScore = Math.round(clamp(
    (marketSizeIntent * 0.20 + earlyMarketAccess * 0.25 + growthTiming * 0.20 + differentiationProxy * 0.35) / 10,
  ) * 100)

  const metrics = {
    click_concentration: clickConcentration,
    brand_concentration: brandConcentration,
    concentration,
    review_moat: reviewMoat,
    attackability,
    growth,
    acceleration,
    price_modifier: pModifier,
    demand_quality: demandQuality,
    specificity,
    core_opportunity: coreOpportunity,
    market_size_intent: marketSizeIntent,
    early_market_access: earlyMarketAccess,
    growth_timing: growthTiming,
    differentiation_proxy: differentiationProxy,
    composite_score: compositeScore,
  }

  const partial = {
    id: crypto.randomUUID(),
    poe,
    candidate,
    enrichment,
    datarova,
    registry_match: registryMatch,
    metrics,
    filter_drops: [] as string[],
    high_return_warning: n(poe.return_rate) >= 0.02,
  }

  const scored = { ...partial, filter_drops: filterDrops(poe, enrichment, metrics) }
  return { ...scored, lens: lensFor(scored) }
}

function candidateInsertRow(runId: string, scored: ScoredCandidate) {
  const m = scored.metrics
  return {
    id: scored.id,
    run_id: runId,
    enrichment_id: scored.enrichment.id,
    poe_snapshot_id: scored.poe.id,
    query: scored.enrichment.query,
    query_type: scored.enrichment.query_type,
    click_concentration: m.click_concentration,
    brand_concentration: m.brand_concentration,
    concentration: m.concentration,
    review_moat: m.review_moat,
    attackability: m.attackability,
    growth: m.growth,
    acceleration: m.acceleration,
    price_modifier: m.price_modifier,
    demand_quality: m.demand_quality,
    specificity: m.specificity,
    core_opportunity: m.core_opportunity,
    filter_drops: scored.filter_drops,
    high_return_warning: scored.high_return_warning,
    risks: [],
    registry_match: scored.registry_match,
    composite_score: m.composite_score,
    lens: scored.lens,
    promoted_to_picks: false,
    score_version: 'v4',
  }
}

function topProducts(enrichment: EnrichmentRow) {
  return (Array.isArray(enrichment.top_results) ? enrichment.top_results : [])
    .slice(0, 3)
    .map(product => ({
      asin: product.asin,
      brand: product.brand,
      title: String(product.title || '').slice(0, 90),
      reviews: compactNumber(product.reviews),
      rating: nullableNumber(product.rating),
      price: nullableNumber(product.price),
      monthly_sold_badge: compactNumber(product.monthly_sold),
      bsr_current: compactNumber(product.bsr_current),
      bsr_avg30: compactNumber(product.bsr_avg30),
      classification: product.classification,
    }))
}

function llmCandidate(scored: ScoredCandidate) {
  const m = scored.metrics
  const e = scored.enrichment
  const p = scored.poe
  const d = scored.datarova
  return {
    curation_candidate_id: scored.id,
    idea_candidate_id: scored.candidate.id,
    candidate_name: scored.candidate.ingredient_name,
    customer_need: p.customer_need,
    query: e.query,
    query_type: e.query_type,
    lens: scored.lens,
    stage: scored.candidate.stage,
    category: scored.candidate.category,
    deterministic_score: m.composite_score,
    computed_pillars: {
      market_size_intent: Number(m.market_size_intent.toFixed(1)),
      early_market_access: Number(m.early_market_access.toFixed(1)),
      growth_timing: Number(m.growth_timing.toFixed(1)),
      differentiation_proxy: Number(m.differentiation_proxy.toFixed(1)),
      attackability: Number(m.attackability.toFixed(3)),
      review_moat: Number(m.review_moat.toFixed(3)),
      specificity: Number(m.specificity.toFixed(3)),
      result_quality: Number(resultQualityScore(e).toFixed(3)),
    },
    poe: {
      import_date: p.import_date,
      search_volume_90d: compactNumber(p.search_volume_90d),
      growth_90d: nullableNumber(p.search_volume_growth_90d),
      growth_180d: nullableNumber(p.search_volume_growth_180d),
      units_sold_360d_range: [compactNumber(p.units_sold_lower_360d), compactNumber(p.units_sold_upper_360d)],
      avg_units_sold_360d_range: [compactNumber(p.avg_units_sold_lower_360d), compactNumber(p.avg_units_sold_upper_360d)],
      top_clicked_products: compactNumber(p.top_clicked_products),
      avg_price: nullableNumber(p.avg_price_usd),
      return_rate: nullableNumber(p.return_rate),
      top_terms: [p.top_search_term_1, p.top_search_term_2, p.top_search_term_3].filter(Boolean),
      flagged_high_opportunity: p.flagged_high_opportunity,
    },
    datarova: d ? {
      keyword: d.keyword,
      search_volume: compactNumber(d.search_volume),
      growth: nullableNumber(d.search_volume_trend),
      conversion_rate: nullableNumber(d.conversion_rate),
      monthly_revenue_est: nullableNumber(d.monthly_revenue_est),
    } : null,
    keepa: {
      source: e.source,
      source_version: e.source_version,
      sales_signal_source: e.sales_signal_source || BADGE_ONLY_SOURCE,
      review_p50: compactNumber(e.review_p50),
      review_p90: compactNumber(e.review_p90),
      review_max: compactNumber(e.review_max),
      rating_p50: nullableNumber(e.rating_p50),
      price_p50: nullableNumber(e.price_p50),
      distinct_brands: compactNumber(e.distinct_brands),
      bsr_best: compactNumber(e.bsr_best),
      bsr_p50: compactNumber(e.bsr_p50),
      monthly_sold_coverage: compactNumber(e.monthly_sold_coverage),
      result_quality: e.result_quality,
      top_products: topProducts(e),
    },
    pipeline: {
      registry_match: scored.registry_match,
      filter_drops: scored.filter_drops,
      high_return_warning: scored.high_return_warning,
    },
  }
}

function curationSystemPrompt() {
  return `You are Toniiq's monthly supplement opportunity curator.

Your job is to choose a small number of genuinely useful Toniiq product opportunities from POE, Datarova, and Keepa Stage A evidence.

Use Phase B philosophy, adapted upstream:
- Market Size & Intent (20%): POE volume/unit range, Datarova volume/conversion, price.
- Early Market Access (25%): Keepa review moat, BSR leader signal, brand/click concentration, result quality.
- Growth & Timing (20%): POE 90d/180d growth plus Datarova trend confirmation.
- Toniiq Differentiation Hypothesis (35%): hypothesize potency, branded ingredient, purity/standardization, stack, strain specificity, or bioavailability/delivery.

Guardrails:
- This is not Phase B. Do not invent Amazon revenue, exact monthly ASIN sales, TikTok stats, clinical claims, or supplier prices.
- Keepa monthly_sold is only an Amazon badge/bracket signal. Treat BSR/reviews as directional ASIN evidence, not exact sales truth.
- Prefer specific launchable wedges over huge root categories.
- Penalize fortress markets unless there is a precise wedge Toniiq can own.
- Penalize generic, brand-led, non-supplement, or already-known ideas.
- Evidence must cite only fields supplied in the candidate JSON.
- Return strict JSON only.`
}

async function loadAnthropicKey(sb: any) {
  const { data, error } = await sb
    .from('system_config')
    .select('value')
    .eq('key', 'anthropic_api_key')
    .single()
  if (error || !data?.value) throw new Error(`anthropic_api_key not in system_config: ${error?.message || 'missing value'}`)
  return data.value as string
}

function latestDatarovaByCandidate(rows: DatarovaRow[]) {
  const map = new Map<string, DatarovaRow>()
  for (const row of rows || []) {
    if (!row.candidate_id) continue
    const current = map.get(row.candidate_id)
    if (!current || String(row.import_date) > String(current.import_date)) map.set(row.candidate_id, row)
  }
  return map
}

function registryMatch(candidate: CandidateRow, registryRows: RegistryRow[]) {
  const candidateText = normalize(candidate.ingredient_name || candidate.ingredient_name_normalized || '')
  if (!candidateText) return null
  const match = registryRows.find(row => {
    const productText = normalize(row.product)
    return productText && (productText.includes(candidateText) || candidateText.includes(productText))
  })
  if (!match) return null
  return {
    product: match.product,
    queue: match.queue,
    state: match.state,
    priority: match.priority,
    lv_band: match.lv_band,
    last_updated: match.last_updated,
  }
}

async function runFinalPass(apiKey: string, candidates: ScoredCandidate[], count: number) {
  const response = await anthropicCall(apiKey, {
    model: FINAL_MODEL,
    max_tokens: 3500,
    temperature: 0.15,
    system: curationSystemPrompt(),
    messages: [{
      role: 'user',
      content: `Select the final ranked top ${count} Toniiq opportunities from these v4 Stage A candidates.

Be selective. The best answer may be fewer than ${count} picks if the evidence is not good enough.
Remove duplicates across queries. Prefer a specific Toniiq thesis over a generic market.
Do not rescue a candidate with outside knowledge. If the evidence is weak, pass.
Use compact wording. The code will attach the numeric evidence and pillar scores after your selection.
Do not include target price ranges in next_action. Say "validate price band" if price needs Phase B review.

Return STRICT JSON only:
{
  "summary": "one sentence monthly readout",
  "picks": [
    {
      "curation_candidate_id": "uuid from input",
      "cluster_key": "short-normalized-key",
      "cluster_name": "human cluster name",
      "idea_title": "specific product idea, ≤8 words",
      "recommendation_label": "launch_priority|strong_candidate|watchlist|pass",
      "strategic_score": 0-100,
      "wedge_lever": "potency|branded|delivery|stack|demographic|purity|none",
      "wedge_specifics": "≤12 words or null",
      "fit_reason": "≤16 words",
      "thesis": "≤24 words, source-grounded",
      "risk": "≤12 words",
      "duplicate_status": "new|prior_pick|in_research|in_evaluation|in_development|registry_overlap",
      "next_action": "≤14 words"
    }
  ]
}

Candidates:
${JSON.stringify(candidates.map(llmCandidate))}`,
    }],
  })
  return { parsed: extractJson<any>(extractText(response)), usage: response.usage || {} }
}

function normalizeRecommendation(value: string) {
  if (['launch_priority', 'strong_candidate', 'watchlist', 'pass'].includes(value)) return value
  return 'watchlist'
}

function normalizeWedge(value: string | null | undefined) {
  if (!value) return 'none'
  const key = normalize(value)
  if (['potency', 'branded', 'delivery', 'stack', 'demographic', 'purity', 'none'].includes(key)) return key
  if (key.includes('brand')) return 'branded'
  if (key.includes('bioavailability') || key.includes('liposomal')) return 'delivery'
  return 'none'
}

function defaultPillarScores(scored: ScoredCandidate, pick: any) {
  const m = scored.metrics
  const fitReason = pick.fit_reason || pick.wedge_specifics || 'Toniiq angle needs Phase A validation.'
  return {
    market_size_intent: {
      score: Number((m.market_size_intent / 10).toFixed(1)),
      weight: 0.20,
      reason: 'POE/Datarova demand and price context.',
    },
    early_market_access: {
      score: Number((m.early_market_access / 10).toFixed(1)),
      weight: 0.25,
      reason: 'Keepa review moat and concentration proxy.',
    },
    growth_timing: {
      score: Number((m.growth_timing / 10).toFixed(1)),
      weight: 0.20,
      reason: 'POE 90d/180d and Datarova trend.',
    },
    differentiation_hypothesis: {
      score: Math.max(0, Math.min(10, Math.round(n(pick.strategic_score, m.composite_score) / 10))),
      weight: 0.35,
      reason: fitReason,
    },
  }
}

function defaultEvidenceRefs(scored: ScoredCandidate) {
  const p = scored.poe
  const e = scored.enrichment
  const d = scored.datarova
  const refs = [
    {
      source: 'poe',
      label: '90d volume / growth',
      value: `${compactNumber(p.search_volume_90d) || 'n/a'} / ${nullableNumber(p.search_volume_growth_90d) ?? 'n/a'}`,
    },
    {
      source: 'poe',
      label: '360d units range',
      value: `${compactNumber(p.units_sold_lower_360d) || 'n/a'}-${compactNumber(p.units_sold_upper_360d) || 'n/a'}`,
    },
    {
      source: 'keepa',
      label: 'BSR best / review p50',
      value: `${compactNumber(e.bsr_best) || 'n/a'} / ${compactNumber(e.review_p50) || 'n/a'}`,
    },
  ]
  if (d) {
    refs.push({
      source: 'datarova',
      label: 'volume / conversion',
      value: `${compactNumber(d.search_volume) || 'n/a'} / ${nullableNumber(d.conversion_rate) ?? 'n/a'}`,
    })
  }
  if (scored.registry_match) {
    refs.push({
      source: 'registry',
      label: 'registry overlap',
      value: scored.registry_match.product,
    })
  }
  return refs
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const sb = svcClient()
  let runId: string | null = null

  try {
    const body = await req.json().catch(() => ({}))
    const requestedImportDate = body.import_date
    const finalPickCount = Math.max(1, Math.min(20, Number(body.count || DEFAULT_FINAL_PICK_COUNT)))
    const maxRows = Math.max(10, Math.min(500, Number(body.max_rows || DEFAULT_MAX_ROWS_TO_SCORE)))
    const llmCandidateLimit = Math.max(10, Math.min(80, Number(body.llm_candidate_limit || DEFAULT_LLM_CANDIDATE_LIMIT)))
    const anthropicApiKey = await loadAnthropicKey(sb)

    let importDate = requestedImportDate
    if (!importDate) {
      const { data, error } = await sb.from('poe_snapshots').select('import_date').order('import_date', { ascending: false }).limit(1).single()
      if (error || !data) throw new Error(`No POE import found: ${error?.message || 'empty table'}`)
      importDate = data.import_date
    }

    const { data: run, error: runError } = await sb.from('market_curation_runs').insert({
      import_date: importDate,
      status: 'running',
      model: FINAL_MODEL,
      prompt_version: PROMPT_VERSION,
      started_at: new Date().toISOString(),
    }).select('*').single()
    if (runError || !run) throw new Error(`Could not create curation run: ${runError?.message}`)
    runId = run.id

    const [poeRes, candidatesRes, datarovaRes, priorPicksRes, registryRes] = await Promise.all([
      sb.from('poe_snapshots').select('*').eq('import_date', importDate).order('search_volume_90d', { ascending: false, nullsFirst: false }).limit(maxRows),
      sb.from('idea_candidates').select('id, ingredient_name, ingredient_name_normalized, category, stage'),
      sb.from('datarova_snapshots').select('candidate_id, keyword, import_date, search_volume, search_volume_trend, conversion_rate, avg_price, monthly_revenue_est').order('import_date', { ascending: false }),
      sb.from('market_curation_picks').select('candidate_id, feedback_rating, dismissed_at, promoted_review_id, created_at').is('dismissed_at', null),
      sb.from('npd_registry_products').select('product, queue, state, priority, lv_band, last_updated'),
    ])

    const loadError = poeRes.error || candidatesRes.error || datarovaRes.error || priorPicksRes.error || registryRes.error
    if (loadError) throw new Error(`Could not load market context: ${loadError.message}`)

    const poeRows = poeRes.data || []
    const snapshotIds = poeRows.map((row: PoeRow) => row.id)
    const enrichmentRes = snapshotIds.length
      ? await sb
        .from('poe_competitive_enrichments')
        .select('*')
        .in('poe_snapshot_id', snapshotIds)
        .eq('source', 'keepa_product_finder')
      : { data: [], error: null }
    if (enrichmentRes.error) throw new Error(`Could not load Keepa enrichments: ${enrichmentRes.error.message}`)

    const candidateMap = new Map((candidatesRes.data || []).map((row: CandidateRow) => [row.id, row]))
    const drMap = latestDatarovaByCandidate(datarovaRes.data || [])
    const registryRows = registryRes.data || []

    const enrichmentsBySnapshot = new Map<string, EnrichmentRow[]>()
    for (const enrichment of enrichmentRes.data || []) {
      if (!enrichmentsBySnapshot.has(enrichment.poe_snapshot_id)) enrichmentsBySnapshot.set(enrichment.poe_snapshot_id, [])
      enrichmentsBySnapshot.get(enrichment.poe_snapshot_id)!.push(enrichment)
    }

    const scored: ScoredCandidate[] = []
    const missingEnrichmentCount = { count: 0 }
    for (const poe of poeRows as PoeRow[]) {
      const candidate = candidateMap.get(poe.candidate_id)
      if (!candidate) continue
      const enrichments = enrichmentsBySnapshot.get(poe.id) || []
      if (!enrichments.length) {
        missingEnrichmentCount.count += 1
        continue
      }
      const match = registryMatch(candidate, registryRows)
      const datarova = drMap.get(poe.candidate_id) || null
      for (const enrichment of enrichments) {
        scored.push(scoreCandidate(poe, candidate, enrichment, datarova, match))
      }
    }

    if (scored.length) {
      const { error: insertCandidatesError } = await sb
        .from('market_curation_candidates')
        .insert(scored.map(item => candidateInsertRow(runId!, item)))
      if (insertCandidatesError) throw new Error(`Could not insert curation candidates: ${insertCandidatesError.message}`)
    }

    const priorPickedCandidates = new Set((priorPicksRes.data || []).map((row: any) => row.candidate_id).filter(Boolean))
    const eligible = scored
      .filter(item => !item.filter_drops.some(drop => [
        'generic_or_non_actionable_root',
        'skipped_brand_led_query',
        'skipped_invalid_query_too_short',
        'thin_keepa_result_set',
        'legacy_or_missing_keepa_source',
      ].includes(drop)))
      .sort((a, b) => {
        const priorPenaltyA = priorPickedCandidates.has(a.candidate.id) ? 8 : 0
        const priorPenaltyB = priorPickedCandidates.has(b.candidate.id) ? 8 : 0
        return (b.metrics.composite_score - priorPenaltyB) - (a.metrics.composite_score - priorPenaltyA)
      })
      .slice(0, llmCandidateLimit)

    let final: any = { parsed: { summary: null, picks: [] }, usage: {} }
    if (eligible.length) final = await runFinalPass(anthropicApiKey, eligible, finalPickCount)

    const scoredById = new Map(scored.map(item => [item.id, item]))
    const rawPicks = Array.isArray(final.parsed.picks) ? final.parsed.picks : []
    const seenCandidates = new Set<string>()
    const validPicks = rawPicks
      .filter((pick: any) => scoredById.has(pick.curation_candidate_id))
      .filter((pick: any) => {
        const scoredPick = scoredById.get(pick.curation_candidate_id)!
        const key = scoredPick.candidate.id
        if (seenCandidates.has(key)) return false
        seenCandidates.add(key)
        return true
      })
      .slice(0, finalPickCount)

    const pickRows = validPicks.map((pick: any, index: number) => {
      const scoredPick = scoredById.get(pick.curation_candidate_id)!
      const risks = Array.isArray(pick.risks)
        ? pick.risks
        : (pick.risk ? [pick.risk] : [])
      const computedSignals = {
        deterministic_score: scoredPick.metrics.composite_score,
        market_size_intent: scoredPick.metrics.market_size_intent,
        early_market_access: scoredPick.metrics.early_market_access,
        growth_timing: scoredPick.metrics.growth_timing,
        differentiation_proxy: scoredPick.metrics.differentiation_proxy,
        attackability: scoredPick.metrics.attackability,
        review_moat: scoredPick.metrics.review_moat,
        specificity: scoredPick.metrics.specificity,
        core_opportunity: scoredPick.metrics.core_opportunity,
        filter_drops: scoredPick.filter_drops,
      }
      return {
        run_id: runId,
        candidate_id: scoredPick.candidate.id,
        curation_candidate_id: scoredPick.id,
        cluster_key: pick.cluster_key || normalize(pick.idea_title || pick.cluster_name || `pick-${index + 1}`),
        cluster_name: pick.cluster_name || scoredPick.poe.customer_need,
        idea_title: pick.idea_title || pick.cluster_name || scoredPick.poe.customer_need,
        rank: index + 1,
        recommendation_label: normalizeRecommendation(pick.recommendation_label),
        strategic_score: pick.strategic_score === null || pick.strategic_score === undefined ? scoredPick.metrics.composite_score : Math.round(Number(pick.strategic_score)),
        pillar_scores: defaultPillarScores(scoredPick, pick),
        thesis: pick.thesis || null,
        evidence_refs: defaultEvidenceRefs(scoredPick),
        risks,
        duplicate_status: pick.duplicate_status || (scoredPick.registry_match ? 'registry_overlap' : 'new'),
        status_flags: { already_known: Boolean(scoredPick.registry_match), needs_phase_a: true },
        next_action: pick.next_action || null,
        lens: scoredPick.lens,
        source_poe_snapshot_id: scoredPick.poe.id,
        primary_query: scoredPick.enrichment.query,
        query_type: scoredPick.enrichment.query_type,
        computed_signals: computedSignals,
        competitive_snapshot: {
          keepa: llmCandidate(scoredPick).keepa,
          source_guardrail: 'Keepa monthly_sold is badge/bracket evidence only; BSR/reviews are directional ASIN signals.',
        },
        score_version: 'v4',
      }
    })

    if (pickRows.length) {
      const { error: insertPicksError } = await sb.from('market_curation_picks').insert(pickRows)
      if (insertPicksError) throw new Error(`Could not insert picks: ${insertPicksError.message}`)

      await Promise.all(validPicks.map((pick: any) => {
        const scoredPick = scoredById.get(pick.curation_candidate_id)!
        const risks = Array.isArray(pick.risks)
          ? pick.risks
          : (pick.risk ? [pick.risk] : [])
        return sb.from('market_curation_candidates').update({
          playbook_fit: Math.max(0, Math.min(10, Math.round(n(pick.strategic_score, scoredPick.metrics.composite_score) / 10))),
          wedge_lever: normalizeWedge(pick.wedge_lever),
          wedge_specifics: pick.wedge_specifics || null,
          fit_reason: pick.fit_reason || null,
          thesis: pick.thesis || null,
          risks,
          promoted_to_picks: true,
          composite_score: pick.strategic_score === null || pick.strategic_score === undefined ? scoredPick.metrics.composite_score : Math.round(Number(pick.strategic_score)),
        }).eq('id', scoredPick.id)
      }))
    }

    const runSummary = `${importDate} v4: scored ${scored.length} Keepa-backed candidates from the top ${poeRows.length} POE rows, sent ${eligible.length} candidates to Claude, and stored ${pickRows.length} Monthly AI Picks.`

    await sb.from('market_curation_runs').update({
      status: 'completed',
      total_rows: poeRows.length,
      candidate_rows: scored.length,
      clusters_considered: eligible.length,
      picks_count: pickRows.length,
      token_usage: { final: final.usage || {}, max_rows: maxRows, llm_candidate_limit: llmCandidateLimit },
      summary: runSummary,
      completed_at: new Date().toISOString(),
    }).eq('id', runId)

    return new Response(JSON.stringify({
      ok: true,
      run_id: runId,
      import_date: importDate,
      max_rows: maxRows,
      scored_candidates: scored.length,
      eligible_candidates: eligible.length,
      missing_enrichment_rows: missingEnrichmentCount.count,
      picks_count: pickRows.length,
      summary: runSummary,
    }), { headers: { 'Content-Type': 'application/json', ...corsHeaders } })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (runId) {
      await sb.from('market_curation_runs').update({
        status: 'failed',
        error: message,
        completed_at: new Date().toISOString(),
      }).eq('id', runId)
    }
    return new Response(JSON.stringify({ ok: false, error: message, run_id: runId }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    })
  }
})
