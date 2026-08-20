/**
 * Phase B deterministic scoring core — plain data in, plain data out.
 * No fetch, Deno.env, DB, or LLM. Shared by edge functions and Node replay harness.
 */

// ── Public types ─────────────────────────────────────────────────────────

export interface HybridFrame {
  frame: 'broad_hero' | 'strict_modifier'
  hero_ingredient: string
  delivery_modifier?: string
  query_packet: string[]
  include_terms?: string[]
  require_any?: string[]
  exclude_terms?: string[]
  stack_terms?: string[]
}

export interface HybridProduct {
  asin: string
  parent_asin: string | null
  product_key: string
  duplicate_asins: string[]
  variant_count: number
  discovery_query?: string | null
  discovery_rank?: number | null
  amazon_url?: string | null
  title: string
  brand: string
  price: number | null
  rating: number | null
  reviews: number
  monthly_sold: number
  bsr_current: number | null
  bsr_avg30: number | null
  bsr_avg90: number | null
  classification: 'exact' | 'stack' | 'adjacent' | 'noise'
  bucket?: 'included' | 'adjacent' | 'excluded'
  lane_fit?: string
  reason?: string
  missing_query_tokens: string[]
  other_ingredient_hits: string[]
  source_payload?: any
}

export interface HybridAggregate {
  top_results: HybridProduct[]
  audit_products: HybridProduct[]
  review_p50: number | null
  review_p90: number | null
  review_max: number | null
  rating_p50: number | null
  price_p50: number | null
  sales_top3_share: number | null
  distinct_brands: number | null
  result_count: number
  confidence: 'high' | 'low'
  monthly_sold_coverage: number
  bsr_best: number | null
  bsr_p50: number | null
  bsr_p90: number | null
  result_quality: any
  error?: string
  tokens_consumed: number
  refill_rate: number | null
  query_packet: string[]
}

export interface DemandRowLite {
  keyword: string
  latest_clicks: number
  latest_sales?: number
  monthly_records?: Array<{ month: string; clicks: number; sales: number }>
}

export interface DemandPacket {
  source: 'datarova' | 'fallback'
  queries: string[]
  rows: Array<{
    keyword: string
    monthly_records: Array<{ month: string; clicks: number; sales: number }>
    latest_clicks: number
    latest_sales: number
    weighted_conversion_pct: number | null
    source?: 'datarova_live' | 'phase_a_snapshot'
  }>
  primary_keyword: string | null
  primary_keyword_clicks: number | null
  primary_keyword_sales: number | null
  frame_relevant_clicks: number | null
  frame_relevant_row_count: number
  total_clicks: number | null
  total_sales: number | null
  weighted_conversion_pct: number | null
  growth_3m_pct: number | null
  growth_6m_pct: number | null
  growth_12m_pct: number | null
  latest_month: string | null
  baseline_month: string | null
  total_monthly_data_points: number
  demand_gate_path?: string
  error?: string
}

export type RecommendationTier = 'launch_priority' | 'strong_candidate' | 'watchlist' | 'needs_work' | 'pass'

export type QualityStatus = 'passed' | 'failed_demand' | 'failed_competitive' | 'failed_frame'

export interface QualityGateResult {
  status: QualityStatus
  reason: string
  summary: any
}

export interface PillarResult {
  score: number
  details?: any
  subsignals?: any
}

export interface DiffPillarInput {
  score: number
  vectors_available?: number
  competitive_gap?: number
  form_factor_fit?: number
  pricing_headroom?: number
  vector_total?: number
  vector_details?: any
  reasoning?: string
}

export interface CompetitionGateResult {
  composite_cap: number
  tier_cap: RecommendationTier
  caps_applied: string[]
}

export interface PhaseBCoreOutput {
  quality_gate_status: QualityStatus
  quality_gate_reason: string
  data_quality_summary: any
  pillar_demand_score: number | null
  pillar_growth_score: number | null
  pillar_growth_details: any | null
  pillar_competitive_score: number | null
  pillar_competitive_subsignals: any | null
  pillar_diff_score: number | null
  composite_score: number | null
  recommendation_tier: RecommendationTier | null
  composite_weights: Record<string, number> | null
  competition_gate: CompetitionGateResult | null
  diff_vectors_available: number | null
  diff_vector_details: any | null
}

// ── Constants ────────────────────────────────────────────────────────────

export const ASIN_RE = /^[A-Z0-9]{10}$/

export const QUERY_STOPWORDS = new Set([
  'supplement', 'supplements', 'capsule', 'capsules', 'powder', 'powders',
  'tablet', 'tablets', 'softgel', 'softgels', 'liquid', 'drops', 'gummy',
  'gummies', 'organic', 'pure', 'natural', 'extra', 'maximum', 'strength',
  'high', 'potency', 'for', 'with', 'and', 'plus', 'mg', 'serving',
])

export const STACK_MARKERS = [
  ' with ', ' plus ', '+', 'complex', 'blend', 'stack', 'multi', 'all-in-one',
  'formula',
]

export const PRODUCT_NOISE_PATTERNS = [
  'for dogs', 'for cats', ' cat ', ' dog ', ' pet ', 'skin care', 'skincare',
  'serum', 'face cream', 'topical', 'lotion', 'essential oil', 'diffuser',
]

export const KEEPA_ENRICH_CAP = 80
export const KEEPA_INCLUDED_COVERAGE_TARGET = 0.85

export const DEMAND_MIN_PRIMARY_CLICKS = 100
export const DEMAND_MIN_ROWS_WITH_DATA = 5
export const DEMAND_STRONG_PRIMARY_CLICKS = 1000
export const DEMAND_STRONG_PRIMARY_MIN_ROWS = 2
export const DEMAND_FRAME_CLICKS_ALT_THRESHOLD = 5000

export const TIER_ORDER: Record<RecommendationTier, number> = {
  pass: 0, needs_work: 1, watchlist: 2, strong_candidate: 3, launch_priority: 4,
}

const FAMILY_NORMALIZATION_PATTERNS: Array<[RegExp, string]> = [
  [/\bpack\s+of\s+\d+\b/g, ' '],
  [/\b\d+\s*[- ]?\s*pack\b/g, ' '],
  [/\b\d+\s*[- ]?\s*day\s+supply\b/g, ' '],
  [/\b\d+\s*(count|ct|capsules?|caps|softgels?|tablets?|tabs|servings?|fl\.?\s*oz|oz|ml|milliliters?)\b/g, ' '],
  [/\b\d+(\.\d+)?\s*(mg|mcg|g|gram|grams)\b/g, ' '],
  [/\b\d+\s*in\s*1\b/g, ' '],
]

// ── Generic helpers ──────────────────────────────────────────────────────

export function n(value: unknown, fallback = 0) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

export function nullableNumber(value: unknown) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

export function clamp(value: number, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value))
}

export function normalize(value: string) {
  return String(value || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9+\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function percentile(values: number[], p: number): number | null {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor((sorted.length - 1) * p)]
}

export function finiteNumber(value: unknown): number | null {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

export function statValue(stats: any, key: 'current' | 'avg30' | 'avg90', idx: number): number | null {
  const arr = stats?.[key]
  if (!Array.isArray(arr)) return null
  const value = arr[idx]
  if (value === -1 || value === -2 || value === 0 || value === null || value === undefined) return null
  return Number.isFinite(Number(value)) ? Number(value) : null
}

export function priceFromCents(value: number | null): number | null {
  return value === null ? null : Math.round(value) / 100
}

function canonicalFamilyTitle(title: string) {
  let value = normalize(title)
  for (const [pattern, replacement] of FAMILY_NORMALIZATION_PATTERNS) {
    value = value.replace(pattern, replacement)
  }
  return value
    .replace(/\b(pack|bundle|bottle|bottles|month|months)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(/\s+/)
    .slice(0, 18)
    .join(' ')
}

function productFamilyKey(brand: string, title: string, parentAsin: string | null, asin: string, reviews = 0) {
  const normalizedBrand = normalize(brand) || 'unknown-brand'
  if (parentAsin && ASIN_RE.test(parentAsin) && parentAsin !== asin) return `parent:${parentAsin}`
  const titleKey = canonicalFamilyTitle(title)
  if (titleKey) return `${normalizedBrand}|${titleKey}`
  if (reviews >= 50) return `${normalizedBrand}|review-family:${reviews}`
  return `${normalizedBrand}|${asin}`
}

function titleLooksLikeVariant(title: string) {
  const text = normalize(title)
  return /\b(pack\s+of\s+\d+|\d+\s*[- ]?\s*pack|\d+\s*[- ]?\s*day\s+supply)\b/.test(text)
}

export function queryTokens(query: string) {
  return normalize(query).split(/\s+/)
    .map(token => token.replace(/^-+|-+$/g, ''))
    .filter(token => token.length >= 3 && !QUERY_STOPWORDS.has(token))
}

export function phraseHit(text: string, term: string) {
  const value = normalize(term)
  if (!value || value.length < 2) return false
  if (value.includes(' ')) return text.includes(value)
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(^|\\s)${escaped}(\\s|$)`).test(text)
}

function phraseStart(text: string, term: string) {
  const value = normalize(term)
  if (!value || value.length < 2) return -1
  if (value.includes(' ')) return text.indexOf(value)
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = text.match(new RegExp(`(^|\\s)${escaped}(\\s|$)`))
  return match ? (match.index || 0) + (match[1] ? match[1].length : 0) : -1
}

export function titleTextForClassification(product: HybridProduct) {
  return normalize(product.title || '')
}

function competingCoactiveLeadStart(titleText: string, coactiveTerms: string[]) {
  const starts = coactiveTerms
    .map(term => phraseStart(titleText, term))
    .filter(index => index >= 0)
  return starts.length ? Math.min(...starts) : -1
}

export function compareHybridProducts(a: HybridProduct, b: HybridProduct) {
  const bucketOrder = { included: 0, adjacent: 1, excluded: 2 }
  const aBucket = bucketOrder[a.bucket || 'excluded']
  const bBucket = bucketOrder[b.bucket || 'excluded']
  const aRank = a.discovery_rank || a.bsr_current || a.bsr_avg30 || 999_999_999
  const bRank = b.discovery_rank || b.bsr_current || b.bsr_avg30 || 999_999_999
  return aBucket - bBucket || aRank - bRank || (b.reviews - a.reviews) || a.asin.localeCompare(b.asin)
}

function meaningfulTerms(terms: unknown[]) {
  return terms
    .map(term => normalize(String(term || '')))
    .filter(term => term && term.length >= 2)
}

export function classifyHybridProduct(frame: HybridFrame, product: HybridProduct) {
  const text = ` ${normalize(`${product.brand || ''} ${product.title || ''}`)} `
  const titleText = ` ${titleTextForClassification(product)} `

  const heroTerms = meaningfulTerms(
    frame.include_terms && frame.include_terms.length > 0
      ? frame.include_terms
      : [frame.hero_ingredient],
  )
  const requireTerms = frame.frame === 'strict_modifier'
    ? meaningfulTerms(frame.require_any && frame.require_any.length > 0
        ? frame.require_any
        : (frame.delivery_modifier ? [frame.delivery_modifier] : []))
    : meaningfulTerms(frame.require_any || [])
  const excludeTerms = meaningfulTerms(frame.exclude_terms && frame.exclude_terms.length > 0
    ? frame.exclude_terms
    : PRODUCT_NOISE_PATTERNS)
  const stackTerms = meaningfulTerms(frame.stack_terms || [])

  const excludedHits = excludeTerms.filter(term => phraseHit(text, term))
  if (excludedHits.length) {
    return { bucket: 'excluded' as const, classification: 'noise' as const, lane_fit: 'noise', reason: `Excluded term: ${excludedHits.slice(0, 3).join(', ')}` }
  }

  const heroHits = heroTerms.map(term => phraseStart(text, term)).filter(index => index >= 0)
  if (!heroHits.length) {
    return { bucket: 'excluded' as const, classification: 'noise' as const, lane_fit: 'wrong_ingredient', reason: `Missing hero ingredient: ${heroTerms.slice(0, 3).join(', ')}` }
  }

  if (frame.frame === 'strict_modifier' && requireTerms.length > 0) {
    const reqHits = requireTerms.map(term => phraseStart(text, term)).filter(index => index >= 0)
    if (!reqHits.length) {
      return { bucket: 'adjacent' as const, classification: 'adjacent' as const, lane_fit: 'sibling_or_parent_market', reason: `Missing ${frame.delivery_modifier || requireTerms[0]} qualifier; appears to be the non-modified hero.` }
    }
    const firstHero = Math.min(...heroHits)
    const firstQualifier = Math.min(...reqHits)
    const qualifierIsClose = Math.abs(firstHero - firstQualifier) <= 90
    if (!qualifierIsClose) {
      return { bucket: 'adjacent' as const, classification: 'adjacent' as const, lane_fit: 'cofactor_in_another_formula', reason: 'Hero and modifier appear in title but are far apart — likely a stack where hero is a cofactor.' }
    }
    return { bucket: 'included' as const, classification: 'exact' as const, lane_fit: 'exact_modified_niche', reason: 'Hero + delivery modifier both in title and lead the product positioning.' }
  }

  const firstHero = Math.min(...heroHits)
  const titleHeroHits = heroTerms.map(term => phraseStart(titleText, term)).filter(index => index >= 0)
  const firstTitleHero = titleHeroHits.length ? Math.min(...titleHeroHits) : firstHero
  const heroLeadWindow = titleText.slice(0, 220)
  const heroInLead = heroTerms.some(term => phraseHit(heroLeadWindow, term))

  if (requireTerms.length > 0) {
    const coactiveLead = competingCoactiveLeadStart(titleText, requireTerms)
    const coactiveLeadsHero = coactiveLead >= 0 && coactiveLead < firstTitleHero && !heroInLead
    if (coactiveLeadsHero) {
      return { bucket: 'adjacent' as const, classification: 'adjacent' as const, lane_fit: 'condition_stack', reason: 'Combo co-active leads title ahead of hero — hero is not the undisputed lead.' }
    }
  }

  const stackHits = stackTerms.filter(term => phraseHit(text, term))
  const hasStackMarker = STACK_MARKERS.some(marker => text.includes(marker))

  if ((stackHits.length >= 2 || (hasStackMarker && stackHits.length >= 1)) && !heroInLead) {
    return { bucket: 'adjacent' as const, classification: 'adjacent' as const, lane_fit: 'condition_stack', reason: `Hero appears inside broader stack: ${stackHits.slice(0, 4).join(', ')}` }
  }

  if (requireTerms.length > 0) {
    const comboHits = requireTerms.filter(term => phraseHit(text, term))
    if (!comboHits.length) {
      return { bucket: 'adjacent' as const, classification: 'adjacent' as const, lane_fit: 'sibling_or_parent_market', reason: `Single-ingredient ${frame.hero_ingredient}; missing combo signal (${requireTerms.slice(0, 4).join(', ')}) — parent market, not the combo lane.` }
    }
  }

  const laneFit = hasStackMarker || stackHits.length ? 'hero_complex' : 'hero_single'
  const reason = hasStackMarker || stackHits.length
    ? 'Hero ingredient leads; cofactor complex retained.'
    : 'Hero ingredient is the undisputed lead.'
  return { bucket: 'included' as const, classification: 'exact' as const, lane_fit: laneFit, reason }
}

export function applyHybridClassification(frame: HybridFrame, products: HybridProduct[]) {
  return products.map(product => {
    const classified = classifyHybridProduct(frame, product)
    return {
      ...product,
      bucket: classified.bucket,
      classification: classified.classification,
      lane_fit: classified.lane_fit,
      reason: classified.reason,
    }
  }).sort(compareHybridProducts)
}

export function selectKeepaEnrichmentTargets(products: HybridProduct[], keepAsins: number): HybridProduct[] {
  const byAsin = new Map<string, HybridProduct>()
  for (const product of products) {
    if (!byAsin.has(product.asin)) byAsin.set(product.asin, product)
  }
  const unique = [...byAsin.values()]
  const included = unique.filter(p => p.bucket === 'included').sort(compareHybridProducts)
  const adjacent = unique.filter(p => p.bucket === 'adjacent').sort(compareHybridProducts)
  const rest = unique.filter(p => p.bucket === 'excluded').sort(compareHybridProducts)
  return [...included, ...adjacent, ...rest].slice(0, keepAsins)
}

function mergeProductFamily(existing: HybridProduct, incoming: HybridProduct) {
  const existingMonthlySold = existing.monthly_sold
  const existingReviews = existing.reviews
  existing.duplicate_asins = [...new Set([...existing.duplicate_asins, incoming.asin, ...incoming.duplicate_asins])]
  existing.variant_count = existing.duplicate_asins.length
  existing.monthly_sold += incoming.monthly_sold
  existing.reviews = Math.max(existing.reviews, incoming.reviews)
  if (incoming.rating && (!existing.rating || incoming.reviews >= existingReviews)) existing.rating = incoming.rating
  if (!existing.price || (incoming.price && !titleLooksLikeVariant(incoming.title) && incoming.price < existing.price)) existing.price = incoming.price

  const existingRank = existing.bsr_current || existing.bsr_avg30 || 999_999_999
  const incomingRank = incoming.bsr_current || incoming.bsr_avg30 || 999_999_999
  if (incomingRank < existingRank) {
    existing.bsr_current = incoming.bsr_current
    existing.bsr_avg30 = incoming.bsr_avg30
    existing.bsr_avg90 = incoming.bsr_avg90
  }

  const preferIncomingTitle = titleLooksLikeVariant(existing.title) && !titleLooksLikeVariant(incoming.title)
  if (preferIncomingTitle || incoming.monthly_sold > existingMonthlySold) {
    existing.title = incoming.title
    existing.asin = incoming.asin
  }

  if (existing.classification !== 'exact' && incoming.classification === 'exact') existing.classification = incoming.classification
  existing.other_ingredient_hits = [...new Set([...existing.other_ingredient_hits, ...incoming.other_ingredient_hits])].slice(0, 12)
  existing.missing_query_tokens = [...new Set([...existing.missing_query_tokens, ...incoming.missing_query_tokens])]
}

export function dedupeProductFamilies(products: HybridProduct[]) {
  const families = new Map<string, HybridProduct>()
  for (const product of products) {
    const existing = families.get(product.product_key)
    if (existing) mergeProductFamily(existing, { ...product, duplicate_asins: [...product.duplicate_asins] })
    else families.set(product.product_key, { ...product, duplicate_asins: [...product.duplicate_asins] })
  }
  return [...families.values()].sort((a, b) => {
    const aRank = a.bsr_current || a.bsr_avg30 || a.discovery_rank || 999_999_999
    const bRank = b.bsr_current || b.bsr_avg30 || b.discovery_rank || 999_999_999
    return aRank - bRank || (b.monthly_sold - a.monthly_sold) || (b.reviews - a.reviews) || a.asin.localeCompare(b.asin)
  })
}

export function mergeKeepaIntoClassifiedProducts(
  classified: HybridProduct[],
  enriched: HybridProduct[],
): HybridProduct[] {
  const keepaByAsin = new Map(enriched.map(product => [product.asin, product]))
  return classified.map(product => {
    const keepa = keepaByAsin.get(product.asin)
    if (!keepa) return product
    return {
      ...product,
      parent_asin: keepa.parent_asin,
      product_key: keepa.product_key || product.product_key,
      price: keepa.price || product.price,
      rating: keepa.rating || product.rating,
      reviews: keepa.reviews || product.reviews,
      monthly_sold: keepa.monthly_sold || product.monthly_sold,
      bsr_current: keepa.bsr_current,
      bsr_avg30: keepa.bsr_avg30,
      bsr_avg90: keepa.bsr_avg90,
      title: keepa.title || product.title,
      brand: keepa.brand || product.brand,
    }
  })
}

export function emptyAggregate(error: string, tokens = 0, refillRate: number | null = null, queryPacket: string[] = []): HybridAggregate {
  return {
    top_results: [],
    audit_products: [],
    review_p50: null,
    review_p90: null,
    review_max: null,
    rating_p50: null,
    price_p50: null,
    sales_top3_share: null,
    distinct_brands: null,
    result_count: 0,
    confidence: 'low',
    monthly_sold_coverage: 0,
    bsr_best: null,
    bsr_p50: null,
    bsr_p90: null,
    result_quality: { scored_count: 0, exact_count: 0, stack_count: 0, adjacent_count: 0, monthly_sold_coverage: 0, raw_result_count: 0, scoring_basis: 'empty' },
    error,
    tokens_consumed: tokens,
    refill_rate: refillRate,
    query_packet: queryPacket,
  }
}

export function computeAggregates(products: HybridProduct[]): Omit<HybridAggregate, 'tokens_consumed' | 'refill_rate' | 'audit_products' | 'query_packet'> {
  const uniqueProducts = dedupeProductFamilies(products)
  const rawExact = products.filter(p => p.classification === 'exact')
  const exact = uniqueProducts.filter(p => p.classification === 'exact')
  const usable = exact.length >= 5 ? exact : uniqueProducts.filter(p => p.classification !== 'noise' && p.classification !== 'adjacent')
  const top10 = usable.slice(0, 10)
  const withMonthlySold = top10.filter(p => p.monthly_sold > 0)
  const reviews = top10.map(p => p.reviews).filter(r => r > 0)
  const ratings = top10.map(p => p.rating).filter((r): r is number => Number.isFinite(r || NaN) && (r || 0) > 0)
  const prices = top10.map(p => p.price).filter((p): p is number => Number.isFinite(p || NaN) && (p || 0) > 0)
  const brands = new Set(top10.map(p => p.brand.toLowerCase()).filter(Boolean))
  const bsrValues = top10.map(p => p.bsr_current || p.bsr_avg30 || 0).filter(r => r > 0)
  const totalBadgeSales = withMonthlySold.reduce((sum, product) => sum + product.monthly_sold, 0)
  const top3BadgeSales = withMonthlySold.slice(0, 3).reduce((sum, product) => sum + product.monthly_sold, 0)
  const result_quality = {
    scored_count: top10.length,
    unique_result_count: uniqueProducts.length,
    exact_count: exact.length,
    raw_exact_count: rawExact.length,
    stack_count: uniqueProducts.filter(p => p.classification === 'stack').length,
    adjacent_count: uniqueProducts.filter(p => p.classification === 'adjacent').length,
    monthly_sold_coverage: withMonthlySold.length,
    raw_result_count: products.length,
    duplicate_variant_count: Math.max(0, products.length - uniqueProducts.length),
    scoring_basis: exact.length >= 5 ? 'exact' : 'non_adjacent_non_noise',
  }
  return {
    top_results: usable.slice(0, 30),
    review_p50: percentile(reviews, 0.50),
    review_p90: percentile(reviews, 0.90),
    review_max: reviews.length ? Math.max(...reviews) : null,
    rating_p50: percentile(ratings, 0.50),
    price_p50: percentile(prices, 0.50),
    sales_top3_share: totalBadgeSales > 0 ? top3BadgeSales / totalBadgeSales : null,
    distinct_brands: brands.size || null,
    result_count: top10.length,
    confidence: (top10.length >= 8 && withMonthlySold.length >= 4 && exact.length >= 5) ? 'high' : 'low',
    monthly_sold_coverage: withMonthlySold.length,
    bsr_best: bsrValues.length ? Math.min(...bsrValues) : null,
    bsr_p50: percentile(bsrValues, 0.50),
    bsr_p90: percentile(bsrValues, 0.90),
    result_quality,
    error: products.length ? undefined : 'no_results_returned',
  }
}

export function scoreKeywordFrameRelevance(keyword: string, frame: HybridFrame): number {
  const kw = normalize(keyword)
  if (!kw) return 0
  let score = 0
  const hero = normalize(frame.hero_ingredient)
  if (hero && (kw.includes(hero) || hero.split(/\s+/).every(part => part.length >= 3 && kw.includes(part)))) score += 10
  for (const term of frame.include_terms || []) {
    const t = normalize(term)
    if (t && kw.includes(t)) score += 4
  }
  for (const term of frame.require_any || []) {
    const t = normalize(term)
    if (t && kw.includes(t)) score += 3
  }
  for (const query of frame.query_packet || []) {
    const q = normalize(query)
    if (!q) continue
    if (kw.includes(q) || q.includes(kw)) score += 2
  }
  return score
}

export function selectFrameRelevantDemandPrimary(rows: DemandRowLite[], frame: HybridFrame) {
  const withData = rows.filter(r => r.latest_clicks > 0)
  const ranked = withData
    .map(row => ({ row, relevance: scoreKeywordFrameRelevance(row.keyword, frame) }))
    .filter(entry => entry.relevance > 0)
    .sort((a, b) =>
      b.relevance - a.relevance ||
      b.row.latest_clicks - a.row.latest_clicks ||
      a.row.keyword.localeCompare(b.row.keyword),
    )
  const frameRelevantRows = ranked.map(entry => entry.row)
  const frameRelevantClicks = frameRelevantRows.reduce((sum, row) => sum + row.latest_clicks, 0)
  const primary = ranked[0]?.row || [...withData].sort((a, b) =>
    b.latest_clicks - a.latest_clicks || a.keyword.localeCompare(b.keyword),
  )[0] || null
  return { primary, frameRelevantRows, frameRelevantClicks, frameRelevantRowCount: frameRelevantRows.length }
}

export function evaluateDemandQualityGate(input: {
  source: string
  error?: string
  demandRowsWithData: number
  primaryKeywordClicks: number
  frameRelevantClicks: number
  frameRelevantRowCount: number
  primaryKeyword: string | null
}): { passes: boolean; path: 'default' | 'strong_primary' | 'frame_clicks' | 'failed'; reason: string } {
  if (input.source !== 'datarova') {
    return {
      passes: false,
      path: 'failed',
      reason: `Datarova demand packet unavailable (source=${input.source}, error=${input.error || 'unknown'})`,
    }
  }
  if (input.primaryKeywordClicks < DEMAND_MIN_PRIMARY_CLICKS) {
    return {
      passes: false,
      path: 'failed',
      reason: `Demand data insufficient: primary keyword "${input.primaryKeyword}" only ${input.primaryKeywordClicks} monthly clicks (need ≥${DEMAND_MIN_PRIMARY_CLICKS})`,
    }
  }
  if (input.demandRowsWithData >= DEMAND_MIN_ROWS_WITH_DATA) {
    return { passes: true, path: 'default', reason: 'all gates passed' }
  }
  if (input.primaryKeywordClicks >= DEMAND_STRONG_PRIMARY_CLICKS && input.demandRowsWithData >= DEMAND_STRONG_PRIMARY_MIN_ROWS) {
    return { passes: true, path: 'strong_primary', reason: 'all gates passed' }
  }
  if (input.frameRelevantClicks >= DEMAND_FRAME_CLICKS_ALT_THRESHOLD && input.frameRelevantRowCount >= DEMAND_STRONG_PRIMARY_MIN_ROWS) {
    return { passes: true, path: 'frame_clicks', reason: 'all gates passed' }
  }
  return {
    passes: false,
    path: 'failed',
    reason: `Demand data insufficient: ${input.demandRowsWithData} Datarova rows with click data, primary keyword ${input.primaryKeywordClicks} clicks, frame-relevant aggregate ${input.frameRelevantClicks} clicks (need ≥${DEMAND_MIN_ROWS_WITH_DATA} rows, OR ≥${DEMAND_STRONG_PRIMARY_MIN_ROWS} rows when primary ≥${DEMAND_STRONG_PRIMARY_CLICKS}, OR frame-relevant aggregate ≥${DEMAND_FRAME_CLICKS_ALT_THRESHOLD} with ≥${DEMAND_STRONG_PRIMARY_MIN_ROWS} frame-relevant rows)`,
  }
}

// ── Demand packet assembly (deterministic post-fetch) ────────────────────

function monthKey(date: Date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-01`
}

function addMonths(date: Date, offset: number) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + offset, 1))
}

function latestCompleteMonth() {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))
}

export function buildDemandPacketFromRecords(
  records: Array<{ keyword?: string; records?: Array<{ start_date?: string; date?: string; clicks?: unknown; sales?: unknown }> }>,
  frame: HybridFrame,
  phaseAEnrichment: any = null,
  queries?: string[],
): DemandPacket {
  const phaseAKeywords = Array.isArray(phaseAEnrichment?.related_keywords)
    ? phaseAEnrichment.related_keywords
      .map((item: any) => normalize(String(item?.keyword || '')))
      .filter(Boolean)
    : []
  const resolvedQueries = queries ?? [...new Set([
    ...frame.query_packet.map(q => normalize(q)).filter(Boolean),
    ...phaseAKeywords,
  ])].sort((a, b) => a.localeCompare(b)).slice(0, 44)

  const empty = (error?: string): DemandPacket => ({
    source: 'fallback', queries: resolvedQueries,
    rows: [],
    primary_keyword: null, primary_keyword_clicks: null, primary_keyword_sales: null,
    frame_relevant_clicks: null, frame_relevant_row_count: 0,
    total_clicks: null, total_sales: null, weighted_conversion_pct: null,
    growth_3m_pct: null, growth_6m_pct: null, growth_12m_pct: null,
    latest_month: null, baseline_month: null, total_monthly_data_points: 0,
    error,
  })
  if (!resolvedQueries.length) return empty('empty_query_packet')

  const rowByKeyword = new Map<string, DemandPacket['rows'][number]>()
  for (const item of records) {
    const keyword = String(item.keyword || '').trim()
    if (!keyword) continue
    const sorted = [...(item.records || [])]
      .filter((r: any) => (r.start_date || r.date))
      .sort((a: any, b: any) => String(a.start_date || a.date).localeCompare(String(b.start_date || b.date)))
    const monthly_records = sorted.map((r: any) => ({
      month: String(r.start_date || r.date).slice(0, 10),
      clicks: n(r.clicks),
      sales: n(r.sales),
    }))
    const latest = [...monthly_records].reverse().find(r => r.clicks > 0 || r.sales > 0) || monthly_records.at(-1)
    const totalClicks = monthly_records.reduce((s, r) => s + r.clicks, 0)
    const totalSales = monthly_records.reduce((s, r) => s + r.sales, 0)
    rowByKeyword.set(normalize(keyword), {
      keyword,
      monthly_records,
      latest_clicks: latest?.clicks || 0,
      latest_sales: latest?.sales || 0,
      weighted_conversion_pct: totalClicks > 0 ? Number(((totalSales / totalClicks) * 100).toFixed(1)) : null,
      source: 'datarova_live',
    })
  }

  for (const item of (phaseAEnrichment?.related_keywords || [])) {
    const keyword = String(item?.keyword || '').trim()
    const key = normalize(keyword)
    if (!keyword || rowByKeyword.has(key)) continue
    const clicks = n(item?.clicks)
    const sales = n(item?.sales)
    if (clicks <= 0 && sales <= 0) continue
    const snapshotMonth = String(item?.snapshot_month || monthKey(latestCompleteMonth())).slice(0, 10)
    rowByKeyword.set(key, {
      keyword,
      monthly_records: [{ month: snapshotMonth, clicks, sales }],
      latest_clicks: clicks,
      latest_sales: sales,
      weighted_conversion_pct: clicks > 0 ? Number(((sales / clicks) * 100).toFixed(1)) : null,
      source: 'phase_a_snapshot',
    })
  }

  const rows = [...rowByKeyword.values()]
    .filter(r => r.keyword && (r.latest_clicks > 0 || r.latest_sales > 0))
    .sort((a, b) => b.latest_clicks - a.latest_clicks || a.keyword.localeCompare(b.keyword))

  const monthTotals = new Map<string, { clicks: number; sales: number }>()
  for (const row of rows) {
    for (const m of row.monthly_records) {
      const cur = monthTotals.get(m.month) || { clicks: 0, sales: 0 }
      cur.clicks += m.clicks
      cur.sales += m.sales
      monthTotals.set(m.month, cur)
    }
  }
  const months = [...monthTotals.keys()].sort()
  const latestMonth = [...months].reverse().find(m => (monthTotals.get(m)?.clicks || 0) > 0) || months.at(-1) || null
  const latestIdx = latestMonth ? months.indexOf(latestMonth) : -1
  const latestTotals = latestMonth ? monthTotals.get(latestMonth) : null

  const windowGrowth = (windowMonths: number): number | null => {
    if (latestIdx < windowMonths) return null
    const recent = months.slice(latestIdx - windowMonths + 1, latestIdx + 1)
    const prior = months.slice(Math.max(0, latestIdx - 2 * windowMonths + 1), latestIdx - windowMonths + 1)
    if (!recent.length || !prior.length) return null
    const recentAvg = recent.reduce((s, m) => s + (monthTotals.get(m)?.clicks || 0), 0) / recent.length
    const priorAvg = prior.reduce((s, m) => s + (monthTotals.get(m)?.clicks || 0), 0) / prior.length
    if (priorAvg <= 0) return null
    return Number((((recentAvg - priorAvg) / priorAvg) * 100).toFixed(1))
  }

  const yoyGrowth = (): number | null => {
    if (!latestMonth || latestIdx < 12) return null
    const latestClicks = monthTotals.get(latestMonth)?.clicks || 0
    const baselineMonth = months[latestIdx - 12]
    const baselineClicks = monthTotals.get(baselineMonth)?.clicks || 0
    if (baselineClicks <= 0) return null
    return Number((((latestClicks - baselineClicks) / baselineClicks) * 100).toFixed(1))
  }

  const baselineMonth = (latestMonth && latestIdx >= 12) ? months[latestIdx - 12] : (months[0] || null)

  const demandRows: DemandRowLite[] = rows.map(row => ({
    keyword: row.keyword,
    latest_clicks: row.latest_clicks,
    latest_sales: row.latest_sales,
    monthly_records: row.monthly_records,
  }))
  const selection = selectFrameRelevantDemandPrimary(demandRows, frame)
  const primary = selection.primary
  const totalClicks = latestTotals?.clicks || 0
  const totalSales = latestTotals?.sales || 0

  return {
    source: 'datarova', queries: resolvedQueries, rows,
    primary_keyword: primary?.keyword || null,
    primary_keyword_clicks: primary?.latest_clicks ?? null,
    primary_keyword_sales: primary?.latest_sales ?? null,
    frame_relevant_clicks: selection.frameRelevantClicks || null,
    frame_relevant_row_count: selection.frameRelevantRowCount,
    total_clicks: totalClicks || null,
    total_sales: totalSales || null,
    weighted_conversion_pct: totalClicks > 0 ? Number(((totalSales / totalClicks) * 100).toFixed(1)) : null,
    growth_3m_pct: windowGrowth(3),
    growth_6m_pct: windowGrowth(6),
    growth_12m_pct: yoyGrowth(),
    latest_month: latestMonth,
    baseline_month: baselineMonth,
    total_monthly_data_points: months.length,
  }
}

// ── Quality gate + pillar scores ─────────────────────────────────────────

export function qualityGate(frame: HybridFrame, demand: DemandPacket, enrichment: HybridAggregate, included: HybridProduct[]): QualityGateResult {
  const minIncluded = frame.frame === 'strict_modifier' ? 3 : 5
  const keepaCoveredIncluded = included.filter(p =>
    (p.bsr_current || p.bsr_avg30) != null && p.reviews > 0 && (p.price || 0) > 0
  )
  const monthlySoldCovered = included.filter(p => p.monthly_sold > 0)
  const keepaCoveragePct = included.length > 0 ? keepaCoveredIncluded.length / included.length : 0
  const monthlySoldCoveragePct = included.length > 0 ? monthlySoldCovered.length / included.length : 0

  const demandRowsWithData = demand.rows.filter(r => r.latest_clicks > 0).length
  const primaryClicks = demand.primary_keyword_clicks || 0
  const frameRelevantClicks = demand.frame_relevant_clicks || 0
  const frameRelevantRowCount = demand.frame_relevant_row_count || 0

  const summary = {
    frame: frame.frame, hero: frame.hero_ingredient, modifier: frame.delivery_modifier || null,
    discovery_result_count: (enrichment.result_quality as any)?.discovery_result_count || 0,
    included_count: included.length,
    adjacent_count: ((enrichment.result_quality as any)?.adjacent_count || 0),
    excluded_count: ((enrichment.result_quality as any)?.excluded_count || 0),
    keepa_coverage_count: keepaCoveredIncluded.length,
    keepa_coverage_pct: Number((keepaCoveragePct * 100).toFixed(1)),
    monthly_sold_badge_count: monthlySoldCovered.length,
    monthly_sold_badge_pct: Number((monthlySoldCoveragePct * 100).toFixed(1)),
    demand_source: demand.source,
    demand_rows_with_data: demandRowsWithData,
    demand_primary_clicks: primaryClicks,
    demand_primary_keyword: demand.primary_keyword,
    demand_frame_relevant_clicks: frameRelevantClicks,
    demand_frame_relevant_rows: frameRelevantRowCount,
    demand_total_monthly_data_points: demand.total_monthly_data_points,
    keepa_tokens_consumed: enrichment.tokens_consumed,
    min_included_required: minIncluded,
  }

  const demandGate = evaluateDemandQualityGate({
    source: demand.source,
    error: demand.error,
    demandRowsWithData,
    primaryKeywordClicks: primaryClicks,
    frameRelevantClicks,
    frameRelevantRowCount,
    primaryKeyword: demand.primary_keyword,
  })
  const summaryWithDemand = { ...summary, demand_gate_path: demandGate.path }
  if (!demandGate.passes) {
    return { status: 'failed_demand', reason: demandGate.reason, summary: summaryWithDemand }
  }

  if (included.length < minIncluded) {
    return { status: 'failed_competitive', reason: `Competitive data insufficient: ${included.length}/${minIncluded} included competitors after classification (frame=${frame.frame})`, summary: summaryWithDemand }
  }
  const KEEPA_MIN_COVERED_INCLUDED_ABS = 40
  if (keepaCoveragePct < 0.8 && keepaCoveredIncluded.length < KEEPA_MIN_COVERED_INCLUDED_ABS) {
    return { status: 'failed_competitive', reason: `Competitive data insufficient: only ${keepaCoveredIncluded.length}/${included.length} (${(keepaCoveragePct * 100).toFixed(0)}%) included competitors have Keepa BSR/reviews/price data (need ≥80% or ≥${KEEPA_MIN_COVERED_INCLUDED_ABS} covered)`, summary: summaryWithDemand }
  }

  return { status: 'passed', reason: 'all gates passed', summary: summaryWithDemand }
}

export function computeDemandPillar(demand: DemandPacket): PillarResult {
  const clicks = demand.primary_keyword_clicks || 0
  let clicksPts = 0
  if (clicks >= 100_000) clicksPts = 4
  else if (clicks >= 10_000) clicksPts = 3
  else if (clicks >= 1_000) clicksPts = 2
  else if (clicks >= 100) clicksPts = 1

  const aggClicks = demand.rows.reduce((s, r) => s + r.latest_clicks, 0)
  let aggPts = 0
  if (aggClicks >= 200_000) aggPts = 3
  else if (aggClicks >= 50_000) aggPts = 2
  else if (aggClicks >= 10_000) aggPts = 1

  const cvr = demand.weighted_conversion_pct || 0
  let cvrPts = 0
  if (cvr >= 30) cvrPts = 3
  else if (cvr >= 20) cvrPts = 2
  else if (cvr >= 15) cvrPts = 1

  const score = clicksPts + aggPts + cvrPts
  return {
    score,
    details: {
      primary_clicks: clicks,
      primary_clicks_pts: clicksPts,
      aggregate_cluster_clicks: aggClicks,
      aggregate_cluster_pts: aggPts,
      weighted_conversion_pct: cvr,
      conversion_pts: cvrPts,
    },
  }
}

export function computeGrowthPillar(demand: DemandPacket): PillarResult {
  const mapWindow = (pct: number | null): number => {
    if (pct === null) return 4
    if (pct > 100) return 10
    if (pct > 50) return 8
    if (pct > 20) return 6
    if (pct > 0) return 4
    if (pct > -20) return 2
    return 0
  }
  const w3 = mapWindow(demand.growth_3m_pct)
  const w6 = mapWindow(demand.growth_6m_pct)
  const w12 = mapWindow(demand.growth_12m_pct)
  const score = (w3 * 0.40) + (w6 * 0.30) + (w12 * 0.30)

  let shape = 'unknown'
  const g3 = demand.growth_3m_pct ?? 0
  const g6 = demand.growth_6m_pct ?? 0
  const g12 = demand.growth_12m_pct ?? 0
  if (g3 > 20 && g6 > 20 && g12 > 20) shape = 'consistent strong growth'
  else if (g12 > 50 && g3 < 10) shape = 'long-term explosive but recent flattening'
  else if (g12 < 0 && g3 > 20) shape = 'recent rebound from decline'
  else if (g3 < -10 && g6 < -10 && g12 < -10) shape = 'consistent decline'
  else if (Math.abs(g3) < 10 && Math.abs(g6) < 10 && Math.abs(g12) < 10) shape = 'stable mature market'
  else if (g12 > 0 && g3 > 0) shape = 'growth with variance'
  else if (g12 < 0 && g3 < 0) shape = 'declining'
  else shape = 'mixed signals'

  return {
    score: Number(score.toFixed(2)),
    details: {
      growth_3m_pct: demand.growth_3m_pct,
      growth_6m_pct: demand.growth_6m_pct,
      growth_12m_pct: demand.growth_12m_pct,
      window_scores: { w3, w6, w12 },
      window_weights: { w3: 0.40, w6: 0.30, w12: 0.30 },
      trajectory_shape: shape,
      latest_month: demand.latest_month,
      baseline_month: demand.baseline_month,
    },
  }
}

export function parseDoseFromString(text: string): number | null {
  if (!text) return null
  const cfuMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:bn|billion)\s*(?:cfu)?/i)
  if (cfuMatch) return parseFloat(cfuMatch[1])
  const mgMatch = text.match(/(\d{1,5}(?:\.\d+)?)\s*mg\b/i)
  if (mgMatch) return parseFloat(mgMatch[1])
  const mcgMatch = text.match(/(\d{1,6}(?:\.\d+)?)\s*mcg\b/i)
  if (mcgMatch) return parseFloat(mcgMatch[1]) / 1000
  const iuMatch = text.match(/(\d{1,6}(?:\.\d+)?)\s*iu\b/i)
  if (iuMatch) return parseFloat(iuMatch[1])
  return null
}

export function computeCompetitivePillar(included: HybridProduct[], enrichment: HybridAggregate, concept: any): PillarResult {
  const reviews = included.map(p => p.reviews).filter(r => r > 0).sort((a, b) => a - b)
  const reviewP50 = percentile(reviews, 0.5) || 0
  const reviewP90 = percentile(reviews, 0.9) || 0
  const reviewMax = reviews.length ? Math.max(...reviews) : 0
  const logScale = (val: number, lo: number, hi: number): number => {
    if (val <= 0) return 10
    const logVal = Math.log10(val)
    const logLo = Math.log10(lo)
    const logHi = Math.log10(hi)
    return clamp(10 - ((logVal - logLo) / (logHi - logLo)) * 10, 0, 10)
  }
  const reviewMoatScore = (logScale(reviewP50, 500, 50_000) * 0.55) + (logScale(reviewP90, 1_000, 100_000) * 0.25) + (logScale(reviewMax, 2_000, 200_000) * 0.20)

  const ratios: number[] = []
  for (const p of included) {
    if (p.monthly_sold > 0 && (p.price || 0) > 0 && p.reviews > 0) {
      ratios.push((p.monthly_sold * (p.price || 0)) / p.reviews)
    }
  }
  const ratioP50 = ratios.length ? percentile(ratios, 0.5) || 0 : 0
  let revReviewScore = 0
  if (ratioP50 >= 50) revReviewScore = 10
  else if (ratioP50 >= 30) revReviewScore = 8
  else if (ratioP50 >= 15) revReviewScore = 7
  else if (ratioP50 >= 8) revReviewScore = 5
  else if (ratioP50 >= 3) revReviewScore = 3
  else if (ratioP50 > 0) revReviewScore = 1
  else revReviewScore = 0
  const reviewRevenueAvailable = ratios.length

  const bsrValues = included.map(p => p.bsr_current || p.bsr_avg30 || 0).filter(b => b > 0).sort((a, b) => a - b)
  const bsrBest = bsrValues.length ? bsrValues[0] : 0
  let bsrScore = 5
  if (bsrBest === 0) bsrScore = 5
  else if (bsrBest <= 200) bsrScore = 2
  else if (bsrBest <= 1_000) bsrScore = 4
  else if (bsrBest <= 5_000) bsrScore = 6
  else if (bsrBest <= 20_000) bsrScore = 8
  else bsrScore = 10
  const top3BsrAvg = bsrValues.length >= 3 ? (bsrValues[0] + bsrValues[1] + bsrValues[2]) / 3 : bsrBest
  if (top3BsrAvg <= 500 && bsrScore > 4) bsrScore = Math.max(3, bsrScore - 2)

  const brandsTop20 = new Set(included.slice(0, 20).map(p => normalize(p.brand)).filter(Boolean))
  const distinctBrands = brandsTop20.size
  const brandSales = new Map<string, number>()
  for (const p of included.slice(0, 20)) {
    const b = normalize(p.brand)
    if (!b) continue
    const weight = p.monthly_sold > 0 ? p.monthly_sold : p.reviews
    brandSales.set(b, (brandSales.get(b) || 0) + weight)
  }
  const totalWeight = [...brandSales.values()].reduce((s, w) => s + w, 0)
  const topBrandWeight = [...brandSales.values()].sort((a, b) => b - a)[0] || 0
  const topBrandShare = totalWeight > 0 ? topBrandWeight / totalWeight : 0
  let brandScore = 5
  if (distinctBrands >= 12 && topBrandShare < 0.20) brandScore = 10
  else if (distinctBrands >= 8 && topBrandShare < 0.30) brandScore = 8
  else if (distinctBrands >= 6 && topBrandShare < 0.40) brandScore = 6
  else if (distinctBrands >= 4 && topBrandShare < 0.55) brandScore = 4
  else if (distinctBrands >= 3) brandScore = 2
  else brandScore = 1

  let densityScore = 5
  const ic = included.length
  if (ic >= 15 && ic <= 50) densityScore = 10
  else if (ic >= 8 && ic < 15) densityScore = 8
  else if (ic >= 50 && ic <= 80) densityScore = 7
  else if (ic >= 80 && ic <= 100) densityScore = 5
  else if (ic > 100) densityScore = 3
  else if (ic >= 5) densityScore = 6
  else densityScore = 3

  const top20 = included.slice(0, 20)
  const premium = top20.filter(p =>
    (p.price || 0) >= 25 && (p.rating || 0) >= 4.3 && p.reviews >= 500
  )
  const premiumShare = top20.length > 0 ? premium.length / top20.length : 0
  let premiumScore = 0
  if (premiumShare >= 0.5) premiumScore = 10
  else if (premiumShare >= 0.3) premiumScore = 8
  else if (premiumShare >= 0.2) premiumScore = 6
  else if (premiumShare >= 0.1) premiumScore = 4
  else if (premiumShare > 0) premiumScore = 2
  else premiumScore = 0

  const conceptDose = parseDoseFromString(concept.target_dosage || '') || parseDoseFromString(JSON.stringify(concept.key_ingredients || []))
  const top10 = included.slice(0, 10)
  const topDoses = top10.map(p => parseDoseFromString(p.title)).filter((d): d is number => d !== null)
  let specScore = 5
  if (conceptDose && topDoses.length >= 5) {
    const maxTopDose = Math.max(...topDoses)
    const medianTopDose = percentile(topDoses, 0.5) || 0
    const strictAbove = topDoses.every(d => conceptDose > d)
    if (strictAbove && conceptDose >= maxTopDose * 1.5) specScore = 10
    else if (strictAbove) specScore = 8
    else if (conceptDose >= maxTopDose) specScore = 6
    else if (conceptDose >= medianTopDose) specScore = 4
    else specScore = 2
  } else if (conceptDose && topDoses.length >= 2) {
    const maxTopDose = Math.max(...topDoses)
    if (conceptDose > maxTopDose) specScore = 8
    else if (conceptDose >= maxTopDose * 0.8) specScore = 5
    else specScore = 3
  } else {
    specScore = 5
  }

  const weights = { review_moat: 0.25, rev_review: 0.20, bsr: 0.15, brand: 0.10, density: 0.10, premium: 0.10, spec: 0.10 }
  const pillarScore = (reviewMoatScore * weights.review_moat) +
    (revReviewScore * weights.rev_review) +
    (bsrScore * weights.bsr) +
    (brandScore * weights.brand) +
    (densityScore * weights.density) +
    (premiumScore * weights.premium) +
    (specScore * weights.spec)

  return {
    score: Number(pillarScore.toFixed(2)),
    subsignals: {
      review_moat: {
        score: Number(reviewMoatScore.toFixed(2)),
        weight: weights.review_moat,
        review_p50: reviewP50, review_p90: reviewP90, review_max: reviewMax,
        reasoning: `p50=${reviewP50.toLocaleString()}, p90=${reviewP90.toLocaleString()}, max=${reviewMax.toLocaleString()} reviews; ${reviewMoatScore >= 7 ? 'low moat — attackable' : reviewMoatScore >= 4 ? 'moderate moat' : 'high moat — entrenched competitors'}`,
      },
      rev_review_efficiency: {
        score: revReviewScore, weight: weights.rev_review,
        ratio_p50: Number(ratioP50.toFixed(2)),
        rev_review_data_count: reviewRevenueAvailable,
        reasoning: `${reviewRevenueAvailable} competitors with revenue+reviews data; p50 ratio ${ratioP50.toFixed(1)} ${revReviewScore >= 7 ? '(healthy velocity)' : revReviewScore >= 4 ? '(moderate)' : '(mature/saturated or sparse data)'}`,
      },
      bsr_concentration: {
        score: bsrScore, weight: weights.bsr,
        best_bsr: bsrBest, top3_avg_bsr: Number(top3BsrAvg.toFixed(0)),
        reasoning: `Best BSR ${bsrBest.toLocaleString()}, top-3 avg ${top3BsrAvg.toLocaleString()}; ${bsrScore >= 7 ? 'top is diffuse' : bsrScore >= 4 ? 'moderate concentration' : 'locked-up top'}`,
      },
      brand_concentration: {
        score: brandScore, weight: weights.brand,
        distinct_brands_top20: distinctBrands,
        top_brand_share: Number(topBrandShare.toFixed(3)),
        reasoning: `${distinctBrands} distinct brands in top 20, top brand share ${(topBrandShare * 100).toFixed(1)}%; ${brandScore >= 7 ? 'diverse market' : brandScore >= 4 ? 'moderately concentrated' : 'consolidated'}`,
      },
      competitor_density: {
        score: densityScore, weight: weights.density,
        included_count: ic,
        reasoning: ic >= 15 && ic <= 50 ? 'sweet-spot density' : ic < 15 ? 'niche/thin market' : 'crowded — race-to-bottom risk',
      },
      premium_tier_viability: {
        score: premiumScore, weight: weights.premium,
        premium_count_top20: premium.length,
        premium_share: Number(premiumShare.toFixed(3)),
        reasoning: `${premium.length}/${top20.length} top products at ≥$25 AND ≥4.3★ AND ≥500 reviews; ${premiumScore >= 7 ? 'premium tier is viable' : premiumScore >= 4 ? 'narrow premium space' : 'no premium tier present'}`,
      },
      spec_wedge: {
        score: specScore, weight: weights.spec,
        concept_dose: conceptDose,
        top10_doses: topDoses,
        reasoning: conceptDose ? `Concept dose ${conceptDose}, top-10 sample doses [${topDoses.slice(0, 6).join(', ')}]; ${specScore >= 7 ? 'spec wedge exists' : specScore >= 4 ? 'parity with leaders' : 'concept under-doses vs market'}` : 'no comparable dose data extracted',
      },
    },
    details: {
      pillar_weights: weights,
      pillar_score: Number(pillarScore.toFixed(2)),
    },
  }
}

export function parsePlannedPrice(concept: any): number | null {
  const fields = [concept.target_price, concept.planned_price, concept.positioning_angle]
  for (const f of fields) {
    if (!f) continue
    const m = String(f).match(/\$\s*(\d{1,3}(?:\.\d{1,2})?)/)
    if (m) return parseFloat(m[1])
  }
  return null
}

export function applyCompetitionGate(
  competitivePillar: PillarResult,
  frame: HybridFrame,
  included: HybridProduct[],
  concept: any,
): CompetitionGateResult {
  const subs: any = competitivePillar.subsignals || {}
  let cap = 100
  let tierCap: RecommendationTier = 'launch_priority'
  const caps_applied: string[] = []

  const setCap = (compositeCap: number, newTierCap: RecommendationTier, reason: string) => {
    cap = Math.min(cap, compositeCap)
    if (TIER_ORDER[newTierCap] < TIER_ORDER[tierCap]) tierCap = newTierCap
    caps_applied.push(reason)
  }

  const PILLAR_CAP_TO_COMPOSITE: Record<number, number> = { 5: 78, 6: 82 }

  if ((subs.review_moat?.score ?? 10) <= 2) {
    setCap(PILLAR_CAP_TO_COMPOSITE[5], 'strong_candidate', 'review_moat_at_or_below_2_caps_pillar_at_5')
  }
  if ((subs.spec_wedge?.score ?? 10) <= 2) {
    setCap(PILLAR_CAP_TO_COMPOSITE[5], 'strong_candidate', 'spec_wedge_at_or_below_2_caps_pillar_at_5')
  }
  const bestBsr = subs.bsr_concentration?.best_bsr ?? 999_999_999
  if (bestBsr > 0 && bestBsr <= 200) {
    setCap(PILLAR_CAP_TO_COMPOSITE[6], 'strong_candidate', `dominant_top_bsr_${bestBsr}_caps_pillar_at_6`)
  }
  const conceptPrice = parsePlannedPrice(concept)
  const premium = subs.premium_tier_viability?.score ?? 10
  if (premium <= 2 && conceptPrice && conceptPrice >= 25) {
    setCap(PILLAR_CAP_TO_COMPOSITE[5], 'strong_candidate', `premium_tier_weak_${premium}_with_planned_price_${conceptPrice}_caps_pillar_at_5`)
  }
  if (frame.frame === 'strict_modifier' && included.length < 3) {
    if (TIER_ORDER.strong_candidate < TIER_ORDER[tierCap]) tierCap = 'strong_candidate'
    caps_applied.push(`strict_modifier_with_${included.length}_included_caps_tier_at_strong_candidate`)
  }

  return { composite_cap: cap, tier_cap: tierCap, caps_applied }
}

export function labelForScore(score: number): RecommendationTier {
  if (score >= 80) return 'launch_priority'
  if (score >= 65) return 'strong_candidate'
  if (score >= 50) return 'watchlist'
  if (score >= 35) return 'needs_work'
  return 'pass'
}

export function capTier(label: RecommendationTier, maxLabel: RecommendationTier): RecommendationTier {
  return TIER_ORDER[label] <= TIER_ORDER[maxLabel] ? label : maxLabel
}

// ── Main deterministic orchestrator ──────────────────────────────────────

export interface PhaseBCoreInput {
  frame: HybridFrame
  demand: DemandPacket
  audit_products: HybridProduct[]
  enrichment: HybridAggregate
  concept: Record<string, unknown>
  /** Frozen LLM differentiation output — not recomputed in core. */
  differentiation: DiffPillarInput
}

export function runPhaseBDeterministicCore(input: PhaseBCoreInput): PhaseBCoreOutput {
  const included = input.audit_products.filter(p => p.bucket === 'included')
  const gate = qualityGate(input.frame, input.demand, input.enrichment, included)

  if (gate.status !== 'passed') {
    return {
      quality_gate_status: gate.status,
      quality_gate_reason: gate.reason,
      data_quality_summary: gate.summary,
      pillar_demand_score: null,
      pillar_growth_score: null,
      pillar_growth_details: null,
      pillar_competitive_score: null,
      pillar_competitive_subsignals: null,
      pillar_diff_score: null,
      composite_score: null,
      recommendation_tier: gate.status.startsWith('failed') ? 'pass' : null,
      composite_weights: null,
      competition_gate: null,
      diff_vectors_available: null,
      diff_vector_details: null,
    }
  }

  const demandPillar = computeDemandPillar(input.demand)
  const growthPillar = computeGrowthPillar(input.demand)
  const competitivePillar = computeCompetitivePillar(included, input.enrichment, input.concept)
  const diffPillar = input.differentiation

  const weights = { demand: 0.20, growth: 0.15, competitive: 0.35, differentiation: 0.30 }
  const rawComposite = (
    demandPillar.score * weights.demand +
    growthPillar.score * weights.growth +
    competitivePillar.score * weights.competitive +
    diffPillar.score * weights.differentiation
  ) * 10

  const competitionGateResult = applyCompetitionGate(competitivePillar, input.frame, included, input.concept)
  const cappedComposite = Math.min(rawComposite, competitionGateResult.composite_cap)
  const naiveTier = labelForScore(cappedComposite)
  const cappedTier = capTier(naiveTier, competitionGateResult.tier_cap)

  return {
    quality_gate_status: 'passed',
    quality_gate_reason: gate.reason,
    data_quality_summary: gate.summary,
    pillar_demand_score: demandPillar.score,
    pillar_growth_score: growthPillar.score,
    pillar_growth_details: growthPillar.details,
    pillar_competitive_score: competitivePillar.score,
    pillar_competitive_subsignals: competitivePillar.subsignals,
    pillar_diff_score: diffPillar.score,
    composite_score: Number(cappedComposite.toFixed(2)),
    recommendation_tier: cappedTier,
    composite_weights: weights,
    competition_gate: competitionGateResult,
    diff_vectors_available: diffPillar.vectors_available ?? null,
    diff_vector_details: diffPillar.vector_details ?? null,
  }
}
