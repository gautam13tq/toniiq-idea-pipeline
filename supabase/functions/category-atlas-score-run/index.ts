/**
 * category-atlas-score-run — exact-query Category Atlas v4 scoring.
 *
 * This is deliberately parallel to Market Atlas v4, but it starts from
 * category-atlas entries instead of POE rows. A Category Atlas row is not scored
 * until Keepa Stage A has been run against that row's exact primary keyword
 * (for example, "liposomal berberine", not parent "berberine").
 */

import { corsHeaders } from '../_shared/cors.ts'
import { datarovaKeywords, svcClient } from '../_shared/clients.ts'
import {
  ASIN_RE,
  INGREDIENT_WORDS,
  PRODUCT_NOISE_PATTERNS,
  QUERY_STOPWORDS,
  STACK_MARKERS,
  clamp,
  dedupeProductFamilies,
  enrichApifyProductsWithKeepa,
  finiteNumber,
  keepaGet,
  n,
  normalize,
  nullableNumber,
  percentile,
  priceFromCents,
  runApifyDiscovery,
  statValue,
  waitForKeepaTokens,
} from '../_shared/hybrid_scoring.ts'

const SCORING_VERSION = 'category-atlas-v5-hybrid-competitive'
const KEEPA_DOMAIN_US = 1
const DEFAULT_KEEP_ASINS = 50

type RecommendationLabel = 'launch_priority' | 'strong_candidate' | 'watchlist' | 'pass'

interface CategoryEntry {
  id: string
  import_id: string
  category_id: string
  name: string
  primary_keyword: string | null
  best_keyword: string | null
  latest_clicks: number | null
  latest_sales: number | null
  weighted_conversion_pct: number | null
  best_keyword_cvr: number | null
  best_keyword_growth: number | null
  atlas_role?: string | null
  query_packet?: string[] | null
  competitive_frame?: any
  route_or_format: string | null
  mechanism_lane: string | null
  source_payload: any
}

interface KeepaProduct {
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

interface KeepaAggregate {
  top_results: KeepaProduct[]
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
  audit_products?: KeepaProduct[]
  query_packet?: string[]
}

interface KeywordMarket {
  source: string
  source_version: string
  keywords: string[]
  tracked_keyword_count: number
  latest_month: string | null
  baseline_month: string | null
  total_clicks: number | null
  total_sales: number | null
  weighted_conversion_pct: number | null
  market_growth_pct: number | null
  growth_3m_pct: number | null
  primary_keyword: string | null
  primary_keyword_clicks: number | null
  primary_keyword_sales: number | null
  primary_keyword_growth_pct: number | null
  rows: any[]
  error?: string
}

// Note: QUERY_STOPWORDS, INGREDIENT_WORDS, STACK_MARKERS, PRODUCT_NOISE_PATTERNS
// now come from _shared/hybrid_scoring.ts. The category-atlas-specific terms
// below remain local because they're only used by the strict-modifier and
// keyword-market logic.

const GENERIC_NICHE_TERMS = new Set([
  'activator', 'activators', 'support', 'supports', 'booster', 'boosters',
  'complex', 'formula', 'blend', 'extract', 'root', 'leaf', 'vitamin',
  'mineral', 'supplement',
])

const TERM_ALIASES: Record<string, string[]> = {
  sirt6: ['sirtuin 6', 'sirtuin6'],
}

const FAMILY_NORMALIZATION_PATTERNS: Array<[RegExp, string]> = [
  [/\bpack\s+of\s+\d+\b/g, ' '],
  [/\b\d+\s*[- ]?\s*pack\b/g, ' '],
  [/\b\d+\s*[- ]?\s*day\s+supply\b/g, ' '],
  [/\b\d+\s*(count|ct|capsules?|caps|softgels?|tablets?|tabs|servings?|fl\.?\s*oz|oz|ml|milliliters?)\b/g, ' '],
  [/\b\d+(\.\d+)?\s*(mg|mcg|g|gram|grams)\b/g, ' '],
  [/\b\d+\s*in\s*1\b/g, ' '],
]

const RECOMMENDATION_ORDER: Record<RecommendationLabel, number> = {
  pass: 0,
  watchlist: 1,
  strong_candidate: 2,
  launch_priority: 3,
}

// n, nullableNumber, clamp, normalize, percentile, finiteNumber, statValue,
// priceFromCents — imported from _shared/hybrid_scoring.ts.

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

function productFamilyKey(brand: string, title: string, parentAsin: string | null, asin: string, reviews = 0, rank: number | null = null) {
  const normalizedBrand = normalize(brand) || 'unknown-brand'
  if (parentAsin && ASIN_RE.test(parentAsin) && parentAsin !== asin) return `parent:${parentAsin}`
  const titleKey = canonicalFamilyTitle(title)
  if (titleKey) return `${normalizedBrand}|${titleKey}`
  if (reviews >= 50) return `${normalizedBrand}|review-family:${reviews}`
  return `${normalizedBrand}|${asin}`
}

function queryTokens(query: string) {
  return normalize(query).split(/\s+/)
    .map(token => token.replace(/^-+|-+$/g, ''))
    .filter(token => token.length >= 3 && !QUERY_STOPWORDS.has(token))
}

function sourceKeywordCandidates(entry: CategoryEntry) {
  const values: string[] = []
  const add = (value: unknown) => {
    const clean = normalize(String(value || ''))
    if (clean && !values.includes(clean)) values.push(clean)
  }
  add(entry.primary_keyword)
  add(entry.best_keyword)
  for (const value of (Array.isArray(entry.query_packet) ? entry.query_packet : [])) add(value)

  const payload = entry.source_payload || {}
  const collections = [
    payload.top_direct_terms,
    payload.top_keywords,
    payload.top_terms,
  ].filter(Array.isArray)

  for (const collection of collections) {
    for (const item of collection) {
      if (Array.isArray(item)) add(item[0])
      else if (item && typeof item === 'object') add((item as any).keyword)
    }
  }
  return values
}

function primaryKeyword(entry: CategoryEntry) {
  const existing = String(entry.primary_keyword || '').trim()
  if (hasStrictModifiedLane(entry)) {
    const preferredCandidates = [
      ...(Array.isArray(entry.query_packet) ? entry.query_packet : []),
      entry.best_keyword,
      ...sourceKeywordCandidates(entry),
    ]
    const strictCandidate = [...new Set(preferredCandidates.map(value => normalize(String(value || ''))).filter(Boolean))]
      .find(candidate => strictKeywordCandidateAllowed(entry, candidate, candidate))
    if (strictCandidate) return strictCandidate
  }
  if (existing && (!hasStrictModifiedLane(entry) || strictKeywordCandidateAllowed(entry, existing, existing))) return existing
  const best = String(entry.best_keyword || '').trim()
  if (best && hasStrictModifiedLane(entry) && strictKeywordCandidateAllowed(entry, best, best)) return best
  const name = String(entry.name || '').trim()
  if (entry.category_id === 'liposomal') {
    if (best.toLowerCase().includes('liposomal')) return best
    return `liposomal ${name}`.trim()
  }
  return best || name
}

function keepaSearchTitle(query: string) {
  const text = normalize(query)
  if (/\b(supplement|capsule|powder|softgel|tablet|drops|gummy)\b/.test(text)) return query
  return `${query} supplement`
}

function classifyProduct(query: string, title: string): {
  classification: KeepaProduct['classification']
  missing_query_tokens: string[]
  other_ingredient_hits: string[]
} {
  const text = ` ${normalize(title)} `
  if (PRODUCT_NOISE_PATTERNS.some(pattern => text.includes(pattern))) {
    return { classification: 'noise', missing_query_tokens: [], other_ingredient_hits: [] }
  }

  const tokens = queryTokens(query)
  const missing = tokens.filter(token => !(text.includes(` ${token} `) || text.includes(token)))
  const queryTokenSet = new Set(tokens)
  const otherIngredientHits = [...INGREDIENT_WORDS]
    .filter(token => !queryTokenSet.has(token) && (text.includes(` ${token} `) || text.includes(token)))
    .slice(0, 12)

  if (missing.length > 0) return { classification: 'adjacent', missing_query_tokens: missing, other_ingredient_hits: otherIngredientHits }
  const hasStackMarker = STACK_MARKERS.some(marker => text.includes(marker))
  if ((hasStackMarker && otherIngredientHits.length >= 2) || otherIngredientHits.length >= 3) {
    return { classification: 'stack', missing_query_tokens: [], other_ingredient_hits: otherIngredientHits }
  }
  return { classification: 'exact', missing_query_tokens: [], other_ingredient_hits: otherIngredientHits }
}

async function loadKeepaKey(sb: any): Promise<string> {
  const envKey = Deno.env.get('KEEPA_API_KEY')
  if (envKey) return envKey
  const { data, error } = await sb.from('system_config').select('value').eq('key', 'keepa_api_key').maybeSingle()
  if (error) throw new Error(`keepa_api_key lookup failed: ${error.message}`)
  if (!data?.value) throw new Error('KEEPA_API_KEY env or keepa_api_key system_config value required')
  return data.value
}

async function loadApifyToken(sb: any): Promise<string> {
  const envToken = Deno.env.get('APIFY_API_TOKEN')
  if (envToken) return envToken
  const { data, error } = await sb.from('system_config').select('value').eq('key', 'apify_api_token').maybeSingle()
  if (error) throw new Error(`apify_api_token lookup failed: ${error.message}`)
  if (!data?.value) throw new Error('APIFY_API_TOKEN env or apify_api_token system_config value required')
  return data.value
}

async function loadDatarovaKey(sb: any): Promise<string | null> {
  const envKey = Deno.env.get('DATAROVA_API_KEY')
  if (envKey) return envKey
  const { data, error } = await sb.from('system_config').select('value').eq('key', 'datarova_api_key').maybeSingle()
  if (error) throw new Error(`datarova_api_key lookup failed: ${error.message}`)
  return data?.value || null
}

// keepaGet, waitForKeepaTokens — imported from _shared/hybrid_scoring.ts.

function normalizeKeepaProduct(query: string, raw: any): KeepaProduct | null {
  const asin = String(raw.asin || '').toUpperCase()
  if (!ASIN_RE.test(asin)) return null
  const parentAsin = String(raw.parentAsin || '').toUpperCase()
  const parent_asin = ASIN_RE.test(parentAsin) ? parentAsin : null
  const title = String(raw.title || '').slice(0, 300).trim()
  if (!title) return null
  const stats = raw.stats || {}
  const price = priceFromCents(statValue(stats, 'current', 18) || statValue(stats, 'current', 1) || statValue(stats, 'avg30', 18) || statValue(stats, 'avg30', 1))
  const ratingRaw = statValue(stats, 'current', 16)
  const classified = classifyProduct(query, title)
  const brand = String(raw.brand || raw.manufacturer || '').slice(0, 120)
  const reviews = statValue(stats, 'current', 17) || 0
  const bsr_current = statValue(stats, 'current', 3)
  const bsr_avg30 = statValue(stats, 'avg30', 3)
  return {
    asin,
    parent_asin,
    product_key: productFamilyKey(brand, title, parent_asin, asin, reviews, bsr_current || bsr_avg30),
    duplicate_asins: [asin],
    variant_count: 1,
    title,
    brand,
    price,
    rating: ratingRaw === null ? null : Math.round(ratingRaw) / 10,
    reviews,
    monthly_sold: finiteNumber(raw.monthlySold) || 0,
    bsr_current,
    bsr_avg30,
    bsr_avg90: statValue(stats, 'avg90', 3),
    ...classified,
  }
}

// dedupeProductFamilies imported from _shared/hybrid_scoring.ts.

async function runKeepaQuery(apiKey: string, query: string, keepAsins: number, tokenWaitMs: number): Promise<KeepaAggregate> {
  await waitForKeepaTokens(apiKey, tokenWaitMs, keepAsins * 2 + 10)
  const finder = await keepaGet('/query/', {
    domain: KEEPA_DOMAIN_US,
    selection: JSON.stringify({
      title: keepaSearchTitle(query),
      current_SALES_gte: 1,
      sort: ['current_SALES', 'asc'],
      page: 0,
      perPage: 50,
    }),
  }, apiKey)

  const asinList = (finder.asinList || [])
    .map((asin: string) => String(asin || '').toUpperCase())
    .filter((asin: string) => ASIN_RE.test(asin))
    .slice(0, keepAsins)

  if (!asinList.length) {
    return emptyAggregate('no_keepa_finder_results', Number(finder.tokensConsumed || 0), finiteNumber(finder.refillRate))
  }

  await waitForKeepaTokens(apiKey, tokenWaitMs, keepAsins)
  const enriched = await keepaGet('/product', {
    domain: KEEPA_DOMAIN_US,
    asin: asinList.join(','),
    stats: 90,
    history: 0,
    rating: 1,
  }, apiKey)

  const products = (enriched.products || [])
    .map((raw: any) => normalizeKeepaProduct(query, raw))
    .filter(Boolean) as KeepaProduct[]

  products.sort((a, b) => {
    const aRank = a.bsr_current || a.bsr_avg30 || 999_999_999
    const bRank = b.bsr_current || b.bsr_avg30 || 999_999_999
    return aRank - bRank || (b.monthly_sold - a.monthly_sold) || (b.reviews - a.reviews)
  })

  return {
    ...computeAggregates(products),
    tokens_consumed: Number(finder.tokensConsumed || 0) + Number(enriched.tokensConsumed || 0),
    refill_rate: finiteNumber(enriched.refillRate) || finiteNumber(finder.refillRate),
  }
}

function emptyAggregate(error: string, tokens = 0, refillRate: number | null = null): KeepaAggregate {
  return {
    top_results: [],
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
  }
}

function computeAggregates(products: KeepaProduct[]): Omit<KeepaAggregate, 'tokens_consumed' | 'refill_rate'> {
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

function growthScore(value: unknown) {
  const parsed = nullableNumber(value)
  if (parsed === null) return 0.4
  const decimal = Math.abs(parsed) > 2 ? parsed / 100 : parsed
  return clamp((decimal + 0.05) / 0.45)
}

function reviewMoatScore(enrichment: KeepaAggregate) {
  const p50 = logScore(enrichment.review_p50, 400, 50_000)
  const p90 = logScore(enrichment.review_p90, 800, 80_000)
  const max = logScore(enrichment.review_max, 1_500, 120_000)
  return clamp((p50 * 0.55) + (p90 * 0.25) + (max * 0.20))
}

function brandConcentrationScore(distinctBrands: unknown) {
  const brands = n(distinctBrands)
  if (!brands) return 0.55
  return clamp(1 - ((brands - 2) / 8), 0.05, 0.95)
}

function resultQualityScore(enrichment: KeepaAggregate) {
  const quality = enrichment.result_quality || {}
  const scored = n(quality.scored_count || enrichment.result_count)
  const exact = n(quality.exact_count)
  const coverage = n(quality.monthly_sold_coverage || enrichment.monthly_sold_coverage)
  return clamp((clamp(scored / 10) * 0.45) + (scored > 0 ? clamp(exact / scored) * 0.35 : 0) + (clamp(coverage / 5) * 0.20))
}

function specificityScore(query: string) {
  const key = normalize(query)
  const tokens = key.split(/\s+/).filter(Boolean)
  const hasModifier = /\b(d3 k2|mk-7|hmb|extract|standardized|liposomal|saccharomyces|glycinate|threonate|complex|glp-?1|aged|strain)\b/.test(key)
  if (hasModifier && tokens.length >= 2) return 0.95
  if (tokens.length >= 4) return 0.85
  if (tokens.length === 3) return 0.75
  if (tokens.length === 2) return 0.62
  return 0.4
}

function competitionGate(metrics: any, enrichment: KeepaAggregate) {
  let score_cap = 100
  let max_recommendation: RecommendationLabel = 'launch_priority'
  const reasons: string[] = []
  const apply = (cap: number, recommendation: RecommendationLabel, reason: string) => {
    score_cap = Math.min(score_cap, cap)
    max_recommendation = RECOMMENDATION_ORDER[max_recommendation] <= RECOMMENDATION_ORDER[recommendation] ? max_recommendation : recommendation
    reasons.push(reason)
  }
  if (metrics.early_market_access < 2.0) apply(72, 'watchlist', 'early_access_below_2_0')
  else if (metrics.early_market_access < 3.0) apply(78, 'strong_candidate', 'early_access_below_3_0')
  else if (metrics.early_market_access < 3.6) apply(82, 'strong_candidate', 'early_access_below_launch_threshold')
  if (metrics.review_moat >= 0.75) apply(72, 'watchlist', 'review_moat_above_75')
  else if (metrics.review_moat >= 0.60) apply(78, 'strong_candidate', 'review_moat_above_60')
  if (metrics.attackability < 0.04) apply(72, 'watchlist', 'attackability_below_04')
  else if (metrics.attackability < 0.10) apply(78, 'strong_candidate', 'attackability_below_10')
  if (metrics.growth_timing > 0 && metrics.growth_timing < 4.0) apply(76, 'strong_candidate', 'growth_below_launch_threshold')
  if (n(enrichment.bsr_best) > 0 && n(enrichment.bsr_best) <= 500 && (metrics.review_moat >= 0.35 || n(enrichment.review_p50) >= 5_000 || (n(enrichment.distinct_brands) > 0 && n(enrichment.distinct_brands) <= 3))) {
    apply(68, 'watchlist', 'dominant_top_bsr_leader')
  }
  return { score_cap, max_recommendation, reasons: [...new Set(reasons)] }
}

function capRecommendation(label: RecommendationLabel, maxLabel: RecommendationLabel): RecommendationLabel {
  return RECOMMENDATION_ORDER[label] <= RECOMMENDATION_ORDER[maxLabel] ? label : maxLabel
}

function labelForScore(score: number): RecommendationLabel {
  if (score >= 85) return 'launch_priority'
  if (score >= 70) return 'strong_candidate'
  if (score >= 50) return 'watchlist'
  return 'pass'
}

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

function recordDate(record: any) {
  return String(record?.start_date || record?.date || '').slice(0, 10)
}

function recordClicks(record: any) {
  return n(record?.clicks)
}

function recordSales(record: any) {
  return n(record?.sales)
}

function strictQualifierTerms(entry: CategoryEntry) {
  const terms = Array.isArray(entry.competitive_frame?.require_any) ? entry.competitive_frame.require_any : []
  return terms.map((term: unknown) => normalize(String(term || ''))).filter(Boolean)
}

function hasStrictModifiedLane(entry: CategoryEntry) {
  return strictQualifierTerms(entry).some(term => /\b(liposomal|liposome|phytosome|phospholipid|berbevis|quercefit|meriva|siliphos|dihydroberberine|glucovantage|sucrosomial|micellar|nacet)\b/.test(term))
}

function earlyPhraseHit(text: string, term: string) {
  const value = normalize(term)
  if (!value || value.length < 2) return false
  if (value.includes(' ')) return text.includes(value)
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(^|\\s)${escaped}(\\s|$)`).test(text)
}

function earlyMeaningfulTerms(terms: unknown[]) {
  return terms
    .map(term => normalize(String(term || '')))
    .filter(term => term && !GENERIC_NICHE_TERMS.has(term))
}

function strictQualifierFamily(entry: CategoryEntry, keyword = '') {
  const frameKey = normalize(strictQualifierTerms(entry).join(' '))
  const key = frameKey || normalize(keyword)
  if (/\b(liposomal|liposome)\b/.test(key)) return ['liposomal', 'liposome']
  if (/\b(phytosome|phospholipid|berbevis|quercefit|meriva|siliphos)\b/.test(key)) return ['phytosome', 'phospholipid', 'berbevis', 'quercefit', 'meriva', 'siliphos']
  if (/\b(dihydroberberine|glucovantage)\b/.test(key)) return ['dihydroberberine', 'glucovantage']
  if (/\bsucrosomial\b/.test(key)) return ['sucrosomial']
  if (/\bmicellar\b/.test(key)) return ['micellar']
  if (/\b(nacet|nac ethyl ester)\b/.test(key)) return ['nacet', 'nac ethyl ester']
  return strictQualifierTerms(entry)
}

function heroTermsForEntry(entry: CategoryEntry, keyword: string) {
  const frame = entry.competitive_frame || {}
  const qualifierTerms = new Set(strictQualifierFamily(entry, keyword))
  const fromFrame = earlyMeaningfulTerms(Array.isArray(frame.include) ? frame.include : [])
  const fromKeyword = queryTokens(keyword)
  return [...new Set([...fromFrame, ...fromKeyword])]
    .map(term => normalize(term))
    .filter(term => term && !qualifierTerms.has(term) && !['liposomal', 'liposome', 'phytosome', 'phospholipid', 'supplement'].includes(term))
}

function strictKeywordCandidateAllowed(entry: CategoryEntry, keyword: string, candidate: string) {
  if (!hasStrictModifiedLane(entry)) return true
  const text = ` ${normalize(candidate)} `
  const qualifierTerms = strictQualifierFamily(entry, keyword)
  const heroTerms = heroTermsForEntry(entry, keyword)
  const hasQualifier = qualifierTerms.some(term => earlyPhraseHit(text, term))
  const qualifierImpliesHero = qualifierTerms.some(qualifier =>
    heroTerms.some(hero => qualifier.includes(hero) || hero.includes(qualifier))
  )
  const hasHero = heroTerms.length === 0
    || heroTerms.some(term => earlyPhraseHit(text, term))
    || (hasQualifier && qualifierImpliesHero)
  return hasQualifier && hasHero
}

function marketBaseKeyword(keyword: string) {
  return normalize(keyword)
    .replace(/\b(extract|supplements?|capsules?|capsule|powders?|powder|gummies|gummy|drops|liquid|standardized)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

async function keywordEvidenceRows(sb: any, entryId: string) {
  const { data, error } = await sb.from('category_atlas_keyword_evidence')
    .select('keyword, clicks, sales, conversion_rate_pct, growth_pct, has_data, term_type')
    .eq('entry_id', entryId)
    .order('clicks', { ascending: false, nullsFirst: false })
    .limit(30)
  if (error) return []
  return data || []
}

function keywordMarketPacket(entry: CategoryEntry, keyword: string, evidenceRows: any[]) {
  const values: string[] = []
  const add = (value: unknown) => {
    const clean = normalize(String(value || ''))
    if (clean && clean.length >= 3 && !values.includes(clean)) values.push(clean)
  }

  if (strictKeywordCandidateAllowed(entry, keyword, keyword)) add(keyword)
  if (strictKeywordCandidateAllowed(entry, keyword, `${keyword} supplement`)) add(`${keyword} supplement`)
  for (const value of (Array.isArray(entry.query_packet) ? entry.query_packet : [])) {
    if (strictKeywordCandidateAllowed(entry, keyword, String(value || ''))) add(value)
  }
  for (const row of evidenceRows) {
    if (strictKeywordCandidateAllowed(entry, keyword, String(row.keyword || ''))) add(row.keyword)
  }

  if (!hasStrictModifiedLane(entry)) {
    const base = marketBaseKeyword(keyword)
    add(base)
    add(`${base} supplement`)
    add(`${base} gummies`)
  }

  return values.slice(0, 12)
}

function aggregateKeywordMarket(records: any[], keywords: string[]): KeywordMarket {
  const rows = records.map(item => {
    const keyword = String(item.keyword || '').trim()
    const sorted = [...(item.records || [])]
      .filter(record => recordDate(record))
      .sort((a, b) => recordDate(a).localeCompare(recordDate(b)))
    const latest = [...sorted].reverse().find(record => recordClicks(record) > 0 || recordSales(record) > 0) || sorted.at(-1)
    const baselineTarget = latest ? monthKey(addMonths(new Date(`${recordDate(latest)}T00:00:00Z`), -12)) : null
    const baseline = baselineTarget
      ? sorted.find(record => recordDate(record) === baselineTarget)
      : null
    const fallbackBaseline = sorted.find(record => recordClicks(record) > 0)
    const baselineRecord = baseline || fallbackBaseline
    const latestClicks = latest ? recordClicks(latest) : 0
    const latestSales = latest ? recordSales(latest) : 0
    const baselineClicks = baselineRecord ? recordClicks(baselineRecord) : 0
    const growthPct = baselineClicks > 0 ? ((latestClicks - baselineClicks) / baselineClicks) * 100 : null
    return {
      keyword,
      latest_month: latest ? recordDate(latest) : null,
      latest_clicks: latestClicks,
      latest_sales: latestSales,
      conversion_rate_pct: latestClicks > 0 ? Number(((latestSales / latestClicks) * 100).toFixed(1)) : null,
      baseline_month: baselineRecord ? recordDate(baselineRecord) : null,
      baseline_clicks: baselineClicks,
      growth_pct: growthPct === null ? null : Number(growthPct.toFixed(1)),
      records: sorted.map(record => ({
        month: recordDate(record),
        clicks: recordClicks(record),
        sales: recordSales(record),
      })),
    }
  }).filter(row => row.keyword && (row.latest_clicks > 0 || row.latest_sales > 0))

  const monthTotals = new Map<string, { clicks: number; sales: number }>()
  for (const row of rows) {
    for (const record of row.records || []) {
      const current = monthTotals.get(record.month) || { clicks: 0, sales: 0 }
      current.clicks += record.clicks || 0
      current.sales += record.sales || 0
      monthTotals.set(record.month, current)
    }
  }
  const months = [...monthTotals.keys()].sort()
  const latestMonth = [...months].reverse().find(month => (monthTotals.get(month)?.clicks || 0) > 0) || months.at(-1) || null
  const latestDate = latestMonth ? new Date(`${latestMonth}T00:00:00Z`) : null
  const baselineTarget = latestDate ? monthKey(addMonths(latestDate, -12)) : null
  const baselineMonth = baselineTarget && monthTotals.has(baselineTarget)
    ? baselineTarget
    : months.find(month => (monthTotals.get(month)?.clicks || 0) > 0) || null
  const latestTotals = latestMonth ? monthTotals.get(latestMonth) : null
  const baselineTotals = baselineMonth ? monthTotals.get(baselineMonth) : null
  const totalClicks = latestTotals?.clicks || 0
  const totalSales = latestTotals?.sales || 0
  const marketGrowth = baselineTotals?.clicks
    ? ((totalClicks - baselineTotals.clicks) / baselineTotals.clicks) * 100
    : null
  const latestIndex = latestMonth ? months.indexOf(latestMonth) : -1
  const last3 = latestIndex >= 2 ? months.slice(latestIndex - 2, latestIndex + 1) : []
  const prev3 = latestIndex >= 5 ? months.slice(latestIndex - 5, latestIndex - 2) : []
  const avgClicks = (list: string[]) => list.length ? list.reduce((sum, month) => sum + (monthTotals.get(month)?.clicks || 0), 0) / list.length : 0
  const last3Avg = avgClicks(last3)
  const prev3Avg = avgClicks(prev3)
  const growth3m = prev3Avg > 0 ? ((last3Avg - prev3Avg) / prev3Avg) * 100 : null
  const primary = [...rows].sort((a, b) => b.latest_clicks - a.latest_clicks)[0] || null

  return {
    source: 'datarova',
    source_version: 'category-atlas-keyword-market-v1',
    keywords,
    tracked_keyword_count: rows.length,
    latest_month: latestMonth,
    baseline_month: baselineMonth,
    total_clicks: totalClicks || null,
    total_sales: totalSales || null,
    weighted_conversion_pct: totalClicks > 0 ? Number(((totalSales / totalClicks) * 100).toFixed(1)) : null,
    market_growth_pct: marketGrowth === null ? null : Number(marketGrowth.toFixed(1)),
    growth_3m_pct: growth3m === null ? null : Number(growth3m.toFixed(1)),
    primary_keyword: primary?.keyword || null,
    primary_keyword_clicks: primary?.latest_clicks || null,
    primary_keyword_sales: primary?.latest_sales || null,
    primary_keyword_growth_pct: primary?.growth_pct ?? null,
    rows: rows.slice(0, 12),
  }
}

async function runKeywordMarket(sb: any, datarovaKey: string | null, entry: CategoryEntry, keyword: string): Promise<KeywordMarket> {
  const evidence = await keywordEvidenceRows(sb, entry.id)
  const keywords = keywordMarketPacket(entry, keyword, evidence)
  if (!datarovaKey || !keywords.length) {
    return {
      source: 'category_atlas_source',
      source_version: 'fallback-no-datarova',
      keywords,
      tracked_keyword_count: 0,
      latest_month: null,
      baseline_month: null,
      total_clicks: entry.latest_clicks,
      total_sales: entry.latest_sales,
      weighted_conversion_pct: entry.weighted_conversion_pct,
      market_growth_pct: entry.best_keyword_growth,
      growth_3m_pct: null,
      primary_keyword: entry.best_keyword || keyword,
      primary_keyword_clicks: entry.latest_clicks,
      primary_keyword_sales: entry.latest_sales,
      primary_keyword_growth_pct: entry.best_keyword_growth,
      rows: evidence,
      error: datarovaKey ? undefined : 'datarova_api_key_not_available',
    }
  }

  try {
    const end = latestCompleteMonth()
    const start = addMonths(end, -12)
    const records = await datarovaKeywords(datarovaKey, {
      keywords,
      start: monthKey(start),
      end: monthKey(end),
      marketplace: 'US',
    })
    const market = aggregateKeywordMarket(records, keywords)
    if (!market.total_clicks && !market.total_sales) {
      return {
        ...market,
        total_clicks: entry.latest_clicks,
        total_sales: entry.latest_sales,
        weighted_conversion_pct: entry.weighted_conversion_pct,
        market_growth_pct: entry.best_keyword_growth,
        primary_keyword: entry.best_keyword || keyword,
        primary_keyword_clicks: entry.latest_clicks,
        primary_keyword_sales: entry.latest_sales,
        primary_keyword_growth_pct: entry.best_keyword_growth,
        error: 'no_datarova_keyword_market_rows',
      }
    }
    return market
  } catch (error) {
    return {
      source: 'category_atlas_source',
      source_version: 'fallback-datarova-error',
      keywords,
      tracked_keyword_count: 0,
      latest_month: null,
      baseline_month: null,
      total_clicks: entry.latest_clicks,
      total_sales: entry.latest_sales,
      weighted_conversion_pct: entry.weighted_conversion_pct,
      market_growth_pct: entry.best_keyword_growth,
      growth_3m_pct: null,
      primary_keyword: entry.best_keyword || keyword,
      primary_keyword_clicks: entry.latest_clicks,
      primary_keyword_sales: entry.latest_sales,
      primary_keyword_growth_pct: entry.best_keyword_growth,
      rows: evidence,
      error: error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300),
    }
  }
}

function scoreEntry(entry: CategoryEntry, keyword: string, enrichment: KeepaAggregate) {
  const quality = resultQualityScore(enrichment)
  const observedSalesConcentration = nullableNumber(enrichment.sales_top3_share)
  const monthlyCoverage = n(enrichment.monthly_sold_coverage || enrichment.result_quality?.monthly_sold_coverage)
  const salesConcentration = observedSalesConcentration === null
    ? 0.55
    : monthlyCoverage >= 5
      ? observedSalesConcentration
      : monthlyCoverage >= 4
        ? (observedSalesConcentration * 0.5) + (0.55 * 0.5)
        : 0.55
  const brandConcentration = brandConcentrationScore(enrichment.distinct_brands)
  const concentration = Math.max(salesConcentration, brandConcentration)
  const review_moat = reviewMoatScore(enrichment)
  const attackability = clamp((1 - concentration) * (1 - review_moat) * (0.65 + quality * 0.35))
  const growth = growthScore(entry.best_keyword_growth)
  const acceleration = 0.5
  const price = enrichment.price_p50
  const pScore = priceScore(price)
  const demand_quality = clamp((conversionScore(entry.weighted_conversion_pct ?? entry.best_keyword_cvr) * 0.65) + (quality * 0.35))
  const specificity = specificityScore(keyword)
  const volumeScore = Math.max(logScore(entry.latest_clicks, 5_000, 300_000), logScore(entry.latest_sales, 500, 50_000))
  const market_size_intent = clamp((volumeScore * 0.45) + (demand_quality * 0.25) + (pScore * 0.20) + (quality * 0.10)) * 10
  const early_market_access = clamp((attackability * 0.72) + ((1 - review_moat) * 0.18) + (specificity * 0.10)) * 10
  const growth_timing = clamp((growth * 0.72) + (acceleration * 0.18)) * 10
  const differentiation_proxy = clamp((specificity * 0.45) + (pScore * 0.20) + ((1 - review_moat) * 0.20) + (quality * 0.15)) * 10
  const core_opportunity = clamp(attackability * growth * clamp(0.7 + pScore * 0.6, 0.7, 1.3) * specificity)
  const raw_composite_score = Math.round(clamp((market_size_intent * 0.20 + early_market_access * 0.25 + growth_timing * 0.20 + differentiation_proxy * 0.35) / 10) * 100)
  const metrics = {
    click_concentration: salesConcentration,
    sales_concentration: salesConcentration,
    observed_sales_concentration: observedSalesConcentration,
    monthly_sold_coverage: monthlyCoverage,
    brand_concentration: brandConcentration,
    concentration,
    review_moat,
    attackability,
    growth,
    acceleration,
    price_modifier: clamp(0.7 + pScore * 0.6, 0.7, 1.3),
    demand_quality,
    specificity,
    core_opportunity,
    market_size_intent,
    early_market_access,
    growth_timing,
    differentiation_proxy,
    raw_composite_score,
  }
  const gate = competitionGate(metrics, enrichment)
  const composite_score = Math.min(raw_composite_score, gate.score_cap)
  const recommendation_label = capRecommendation(labelForScore(composite_score), gate.max_recommendation)
  const filter_drops = [
    enrichment.error,
    n(enrichment.result_quality?.exact_count) === 0 ? 'no_exact_competitors' : null,
    n(enrichment.result_quality?.exact_count) > 0 && n(enrichment.result_quality?.exact_count) < 5 ? 'thin_exact_competitor_set' : null,
    enrichment.result_count < 5 ? 'thin_keepa_result_set' : null,
    review_moat >= 0.78 && specificity < 0.62 ? 'fortress_root_market' : null,
    composite_score < 32 ? 'low_stage_a_score' : null,
  ].filter(Boolean) as string[]
  const lens = specificity >= 0.72 && attackability >= 0.18
    ? 'launch_wedge'
    : growth_timing >= 7.5 && specificity >= 0.55
      ? 'anomalous_growth'
      : 'niche_root'
  return { metrics: { ...metrics, score_cap: gate.score_cap, composite_score, competition_gate_reasons: gate.reasons }, gate, composite_score, recommendation_label, filter_drops, lens }
}

function pillarScores(score: ReturnType<typeof scoreEntry>, keyword: string, entry: CategoryEntry, enrichment: KeepaAggregate, keywordMarket?: KeywordMarket) {
  const demandSource = keywordMarket?.source === 'datarova'
    ? `Keyword market packet (${keywordMarket.tracked_keyword_count} tracked terms)`
    : `Exact keyword ${keyword}`
  const growthSource = keywordMarket?.source === 'datarova'
    ? `Datarova market-packet growth ${keywordMarket.market_growth_pct ?? 'n/a'}% from ${keywordMarket.baseline_month || 'baseline'} to ${keywordMarket.latest_month || 'latest'}`
    : `Source keyword growth ${entry.best_keyword_growth ?? 'n/a'}%`
  return {
    market_size_intent: {
      score: Number(score.metrics.market_size_intent.toFixed(1)),
      weight: 0.20,
      reason: `${demandSource}; demand ${n(entry.latest_clicks).toLocaleString()} clicks / ${n(entry.latest_sales).toLocaleString()} sales; Keepa result quality ${score.metrics.demand_quality.toFixed(2)}.`,
    },
    early_market_access: {
      score: Number(score.metrics.early_market_access.toFixed(1)),
      weight: 0.25,
      reason: `Attackability ${score.metrics.attackability.toFixed(3)}, review moat ${score.metrics.review_moat.toFixed(3)}, review p50 ${n(enrichment.review_p50).toLocaleString()}, best BSR ${n(enrichment.bsr_best).toLocaleString()}.`,
    },
    growth_timing: {
      score: Number(score.metrics.growth_timing.toFixed(1)),
      weight: 0.20,
      reason: `${growthSource}.`,
    },
    differentiation_proxy: {
      score: Number(score.metrics.differentiation_proxy.toFixed(1)),
      weight: 0.35,
      reason: `Exact keyword specificity ${score.metrics.specificity.toFixed(2)}; no parent-market fallback used.`,
    },
  }
}

function competitorRows(importId: string, entryId: string, runId: string, products: KeepaProduct[]) {
  const counters = { included: 0, adjacent: 0, excluded: 0 }
  return products.map(product => {
    const bucket = product.bucket || 'excluded'
    counters[bucket] += 1
    return {
      import_id: importId,
      entry_id: entryId,
      score_run_id: runId,
      bucket,
      lane_fit: product.lane_fit || null,
      rank: counters[bucket],
      asin: product.asin,
      parent_asin: product.parent_asin,
      brand: product.brand,
      title: product.title,
      amazon_url: product.amazon_url || `https://www.amazon.com/dp/${product.asin}`,
      price: product.price,
      rating: product.rating,
      reviews: product.reviews || null,
      monthly_sold: product.monthly_sold || null,
      bsr_current: product.bsr_current,
      bsr_avg30: product.bsr_avg30,
      bsr_avg90: product.bsr_avg90,
      discovery_query: product.discovery_query || null,
      discovery_rank: product.discovery_rank || null,
      reason: product.reason || null,
      source_payload: {
        duplicate_asins: product.duplicate_asins,
        variant_count: product.variant_count,
        classification: product.classification,
        source_payload: product.source_payload || null,
      },
    }
  })
}

async function writeCompetitors(sb: any, importId: string, entryId: string, runId: string, products: KeepaProduct[]) {
  await sb.from('category_atlas_competitors').delete().eq('entry_id', entryId)
  const rows = competitorRows(importId, entryId, runId, products.slice(0, 80))
  if (!rows.length) return
  const { error } = await sb.from('category_atlas_competitors').insert(rows)
  if (error) throw error
}

function qualityGate(entry: CategoryEntry, keyword: string, keywordMarket: KeywordMarket, enrichment: KeepaAggregate, products: KeepaProduct[]) {
  const failures: string[] = []
  const warnings: string[] = []
  const strictLane = hasStrictModifiedLane(entry)
  const queryPacket = enrichment.query_packet || []
  const included = products.filter(product => product.bucket === 'included')
  const adjacent = products.filter(product => product.bucket === 'adjacent')
  const excluded = products.filter(product => product.bucket === 'excluded')

  if (keywordMarket.source !== 'datarova') failures.push('keyword_market_not_datarova')
  if (keywordMarket.error) failures.push(`keyword_market_error:${keywordMarket.error}`)
  if (!Array.isArray(keywordMarket.keywords) || !keywordMarket.keywords.length) failures.push('empty_keyword_market_packet')
  if (!Array.isArray(queryPacket) || !queryPacket.length) failures.push('empty_competitor_query_packet')
  if (!enrichment.result_quality || enrichment.result_quality.scoring_basis !== 'hybrid_apify_discovery_keepa_enrichment') failures.push('wrong_competitor_scoring_basis')
  if (n(enrichment.result_quality?.included_count) !== included.length) failures.push('included_count_mismatch')
  if (n(enrichment.result_quality?.excluded_count) !== excluded.length) warnings.push('excluded_count_mismatch')
  if (n(enrichment.result_quality?.adjacent_count) !== adjacent.length) warnings.push('adjacent_count_mismatch')
  if (!included.length) failures.push('no_direct_competitors_after_classification')

  if (strictLane) {
    const badDemandKeywords = (keywordMarket.keywords || [])
      .filter(value => !strictKeywordCandidateAllowed(entry, keyword, value))
    const badQueryKeywords = (queryPacket || [])
      .filter(value => !strictKeywordCandidateAllowed(entry, keyword, value))
    const badIncluded = included
      .filter(product => !['exact_modified_niche', 'hero_modified_lead', 'hero_complex'].includes(product.lane_fit || ''))
      .map(product => `${product.asin}:${product.lane_fit || 'missing_lane_fit'}`)

    if (!strictKeywordCandidateAllowed(entry, keyword, keyword)) failures.push(`primary_keyword_not_strict_niche:${keyword}`)
    if (badDemandKeywords.length) failures.push(`parent_or_sibling_keyword_leakage:${badDemandKeywords.slice(0, 5).join('|')}`)
    if (badQueryKeywords.length) failures.push(`competitor_query_leakage:${badQueryKeywords.slice(0, 5).join('|')}`)
    if (badIncluded.length) failures.push(`included_competitor_failed_strict_lane:${badIncluded.slice(0, 5).join('|')}`)
  }

  const pass = failures.length === 0
  return {
    status: pass ? 'passed' : 'failed',
    checked_at: new Date().toISOString(),
    scoring_version: SCORING_VERSION,
    strict_modified_lane: strictLane,
    checks: {
      demand_source: keywordMarket.source,
      demand_keyword_count: keywordMarket.keywords?.length || 0,
      competitor_query_count: queryPacket?.length || 0,
      included_count: included.length,
      adjacent_count: adjacent.length,
      excluded_count: excluded.length,
      result_scoring_basis: enrichment.result_quality?.scoring_basis || null,
    },
    failures,
    warnings,
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  const sb = svcClient()
  const started = Date.now()
  let runId: string | null = null
  try {
    const body = await req.json().catch(() => ({}))
    const limit = Math.max(1, Math.min(25, Number(body.limit || 5)))
    const force = Boolean(body.force)
    const keepAsins = Math.max(8, Math.min(50, Number(body.keep_asins || DEFAULT_KEEP_ASINS)))
    const tokenWaitMs = Math.max(0, Math.min(130_000, Number(body.keepa_token_wait_ms || 45_000)))
    const keepaKey = await loadKeepaKey(sb)
    const apifyToken = await loadApifyToken(sb)
    const datarovaKey = await loadDatarovaKey(sb)

    let importId = body.import_id
    if (!importId) {
      const { data, error } = await sb.from('category_atlas_imports').select('id').eq('status', 'completed').order('generated_at', { ascending: false }).limit(1).single()
      if (error || !data) throw new Error(`No completed Category Atlas import found: ${error?.message || 'empty'}`)
      importId = data.id
    }

    let query = sb.from('category_atlas_entries')
      .select('*')
      .eq('import_id', importId)
      .eq('atlas_role', 'scored_niche')
      .order('latest_clicks', { ascending: false, nullsFirst: false })
      .limit(limit)

    if (Array.isArray(body.entry_ids) && body.entry_ids.length) query = query.in('id', body.entry_ids)
    else if (!force) query = query.in('score_status', ['pending_hybrid', 'failed', 'audit_failed'])

    const { data: entries, error: entriesError } = await query
    if (entriesError) throw entriesError

    const { data: run, error: runError } = await sb.from('category_atlas_score_runs').insert({
      import_id: importId,
      scoring_version: SCORING_VERSION,
      status: 'running',
      requested_entry_count: entries?.length || 0,
    }).select('id').single()
    if (runError) throw runError
    runId = run.id

    let scored = 0
    let failed = 0
    let deferred = 0
    let keepaTokens = 0
    const results: any[] = []

    for (const entry of (entries || []) as CategoryEntry[]) {
      const keyword = primaryKeyword(entry)
      await sb.from('category_atlas_entries').update({ score_status: 'hybrid_scoring', primary_keyword: keyword, score_run_id: runId }).eq('id', entry.id)
      try {
        const keywordMarket = await runKeywordMarket(sb, datarovaKey, entry, keyword)
        const scoreInput = {
          ...entry,
          latest_clicks: keywordMarket.total_clicks ?? entry.latest_clicks,
          latest_sales: keywordMarket.total_sales ?? entry.latest_sales,
          weighted_conversion_pct: keywordMarket.weighted_conversion_pct ?? entry.weighted_conversion_pct,
          best_keyword: keywordMarket.primary_keyword || entry.best_keyword,
          best_keyword_clicks: keywordMarket.primary_keyword_clicks ?? (entry as any).best_keyword_clicks,
          best_keyword_sales: keywordMarket.primary_keyword_sales ?? (entry as any).best_keyword_sales,
          best_keyword_growth: keywordMarket.market_growth_pct ?? entry.best_keyword_growth,
        }
        const enrichment = await runHybridQuery(entry, apifyToken, keepaKey, keyword, keepAsins, tokenWaitMs)
        keepaTokens += enrichment.tokens_consumed || 0
        const scoredEntry = scoreEntry(scoreInput, keyword, enrichment)
        const auditProducts = enrichment.audit_products || enrichment.top_results || []
        await writeCompetitors(sb, importId, entry.id, runId, auditProducts)
        const quality = qualityGate(entry, keyword, keywordMarket, enrichment, auditProducts)
        const competitive_snapshot = {
          keyword_market: keywordMarket,
          quality_gate: quality,
          hybrid: {
            query: keyword,
            query_packet: enrichment.query_packet || discoveryQueries(entry, keyword),
            source: 'apify_axesso_discovery_plus_keepa_product',
            source_version: SCORING_VERSION,
            review_p50: enrichment.review_p50,
            review_p90: enrichment.review_p90,
            review_max: enrichment.review_max,
            rating_p50: enrichment.rating_p50,
            price_p50: enrichment.price_p50,
            sales_top3_share: enrichment.sales_top3_share,
            distinct_brands: enrichment.distinct_brands,
            result_count: enrichment.result_count,
            confidence: enrichment.confidence,
            monthly_sold_coverage: enrichment.monthly_sold_coverage,
            bsr_best: enrichment.bsr_best,
            bsr_p50: enrichment.bsr_p50,
            bsr_p90: enrichment.bsr_p90,
            result_quality: enrichment.result_quality,
            top_products: enrichment.top_results.slice(0, 12).map(product => ({
              asin: product.asin,
              parent_asin: product.parent_asin,
              duplicate_asins: product.duplicate_asins,
              variant_count: product.variant_count,
              bucket: product.bucket,
              lane_fit: product.lane_fit,
              brand: product.brand,
              title: product.title,
              reviews: product.reviews,
              rating: product.rating,
              price: product.price,
              monthly_sold_badge: product.monthly_sold,
              bsr_current: product.bsr_current,
              bsr_avg30: product.bsr_avg30,
              classification: product.classification,
              missing_query_tokens: product.missing_query_tokens,
              other_ingredient_hits: product.other_ingredient_hits,
              reason: product.reason,
            })),
            adjacent_products: auditProducts.filter(product => product.bucket === 'adjacent').slice(0, 8).map(product => ({
              asin: product.asin,
              brand: product.brand,
              title: product.title,
              reviews: product.reviews,
              monthly_sold_badge: product.monthly_sold,
              bsr_current: product.bsr_current,
              bsr_avg30: product.bsr_avg30,
              lane_fit: product.lane_fit,
              reason: product.reason,
            })),
            excluded_sample: auditProducts.filter(product => product.bucket === 'excluded').slice(0, 8).map(product => ({
              asin: product.asin,
              brand: product.brand,
              title: product.title,
              reason: product.reason,
            })),
          },
          keepa: {
            source: 'apify_axesso_discovery_plus_keepa_product',
            source_version: SCORING_VERSION,
            result_quality: enrichment.result_quality,
            top_products: enrichment.top_results.slice(0, 12),
          },
          guardrail: 'Hybrid discovery only; included competitors drive scoring, adjacent/excluded products stay available for audit.',
        }
        const computed_signals = {
          scoring_version: SCORING_VERSION,
          primary_keyword: keyword,
          deterministic_score: scoredEntry.composite_score,
          quality_gate: quality,
          keyword_market: {
            source: keywordMarket.source,
            tracked_keyword_count: keywordMarket.tracked_keyword_count,
            latest_month: keywordMarket.latest_month,
            baseline_month: keywordMarket.baseline_month,
            total_clicks: keywordMarket.total_clicks,
            total_sales: keywordMarket.total_sales,
            market_growth_pct: keywordMarket.market_growth_pct,
            growth_3m_pct: keywordMarket.growth_3m_pct,
            keywords: keywordMarket.keywords,
            error: keywordMarket.error || null,
          },
          ...scoredEntry.metrics,
          max_recommendation: scoredEntry.gate.max_recommendation,
        }
        if (quality.status !== 'passed') {
          const qualityMessage = `quality_gate_failed:${quality.failures.join(',')}`.slice(0, 500)
          const { error: qualityUpdateError } = await sb.from('category_atlas_entries').update({
            primary_keyword: keyword,
            score_status: 'audit_failed',
            score_run_id: runId,
            strategic_score: null,
            recommendation_label: null,
            score_confidence: 'low',
            pillar_scores: {},
            computed_signals,
            scoring_notes: `Quality gate failed after ${SCORING_VERSION}; score was not published.`,
            latest_clicks: scoreInput.latest_clicks,
            latest_sales: scoreInput.latest_sales,
            weighted_conversion_pct: scoreInput.weighted_conversion_pct,
            best_keyword: scoreInput.best_keyword,
            best_keyword_clicks: (scoreInput as any).best_keyword_clicks,
            best_keyword_sales: (scoreInput as any).best_keyword_sales,
            best_keyword_growth: scoreInput.best_keyword_growth,
            attackability: null,
            review_moat: null,
            result_quality: resultQualityScore(enrichment),
            best_bsr: enrichment.bsr_best,
            review_p50: enrichment.review_p50,
            exact_competitor_count: enrichment.result_quality?.exact_count || 0,
            competition_gate: scoredEntry.gate,
            competitive_snapshot,
            filter_drops: scoredEntry.filter_drops,
            lens: scoredEntry.lens,
            score_error: qualityMessage,
            scored_at: null,
          }).eq('id', entry.id)
          if (qualityUpdateError) throw qualityUpdateError
          failed += 1
          results.push({ id: entry.id, name: entry.name, primary_keyword: keyword, quality_gate: 'failed', error: qualityMessage })
          continue
        }
        const update = {
          primary_keyword: keyword,
          score_status: 'hybrid_scored',
          score_run_id: runId,
          strategic_score: scoredEntry.composite_score,
          recommendation_label: scoredEntry.recommendation_label,
          score_confidence: enrichment.confidence === 'high' && !enrichment.error ? 'high' : 'low',
          pillar_scores: pillarScores(scoredEntry, keyword, scoreInput, enrichment, keywordMarket),
          computed_signals,
          scoring_notes: `Scored through ${SCORING_VERSION} using hybrid competitors for "${keyword}" and a Datarova keyword market packet for demand/timing.`,
          latest_clicks: scoreInput.latest_clicks,
          latest_sales: scoreInput.latest_sales,
          weighted_conversion_pct: scoreInput.weighted_conversion_pct,
          best_keyword: scoreInput.best_keyword,
          best_keyword_clicks: (scoreInput as any).best_keyword_clicks,
          best_keyword_sales: (scoreInput as any).best_keyword_sales,
          best_keyword_growth: scoreInput.best_keyword_growth,
          attackability: scoredEntry.metrics.attackability,
          review_moat: scoredEntry.metrics.review_moat,
          result_quality: resultQualityScore(enrichment),
          best_bsr: enrichment.bsr_best,
          review_p50: enrichment.review_p50,
          exact_competitor_count: enrichment.result_quality?.exact_count || 0,
          competition_gate: scoredEntry.gate,
          competitive_snapshot,
          filter_drops: scoredEntry.filter_drops,
          lens: scoredEntry.lens,
          score_error: enrichment.error || null,
          scored_at: new Date().toISOString(),
        }
        const { error: updateError } = await sb.from('category_atlas_entries').update(update).eq('id', entry.id)
        if (updateError) throw updateError
        scored += 1
        results.push({ id: entry.id, name: entry.name, primary_keyword: keyword, score: scoredEntry.composite_score, attackability: scoredEntry.metrics.attackability, review_moat: scoredEntry.metrics.review_moat })
      } catch (error) {
        const message = error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500)
        if (message.startsWith('not_enough_keepa_tokens_retry_later')) {
          deferred += 1
          await sb.from('category_atlas_entries').update({ score_status: 'pending_hybrid', score_error: message, score_run_id: runId, primary_keyword: keyword }).eq('id', entry.id)
          results.push({ id: entry.id, name: entry.name, primary_keyword: keyword, deferred: 'keepa_tokens', error: message })
          break
        }
        failed += 1
        await sb.from('category_atlas_entries').update({ score_status: 'audit_failed', score_error: message, score_run_id: runId, primary_keyword: keyword }).eq('id', entry.id)
        results.push({ id: entry.id, name: entry.name, primary_keyword: keyword, error: message })
      }
      if (Date.now() - started > 120_000) break
    }

    await sb.from('category_atlas_score_runs').update({
      status: failed > 0 && scored === 0 ? 'failed' : 'completed',
      scored_entry_count: scored,
      failed_entry_count: failed,
      keepa_tokens_consumed: keepaTokens,
      completed_at: new Date().toISOString(),
    }).eq('id', runId)

    return new Response(JSON.stringify({ ok: true, run_id: runId, scored, failed, deferred, keepa_tokens_consumed: keepaTokens, results }), {
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (runId) {
      await sb.from('category_atlas_score_runs').update({ status: 'failed', error: message, completed_at: new Date().toISOString() }).eq('id', runId)
    }
    return new Response(JSON.stringify({ ok: false, error: message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
  })
}

// parseInteger, parsePrice, apifyAsin, apifyTitle, extractBrandFromTitle,
// normalizeApifyProduct, runApifyDiscovery, enrichApifyProductsWithKeepa —
// all imported from _shared/hybrid_scoring.ts as of 2026-05-21.

function discoveryQueries(entry: CategoryEntry, keyword: string) {
  const packet = Array.isArray(entry.query_packet) ? entry.query_packet : []
  const strictAlternates = hasStrictModifiedLane(entry)
    ? heroTermsForEntry(entry, keyword).flatMap(hero =>
      strictQualifierFamily(entry, keyword).flatMap(qualifier => [
        `${hero} ${qualifier}`,
        `${qualifier} ${hero}`,
      ])
    )
    : []
  const values = [
    keyword,
    `${keyword} supplement`,
    ...packet,
    ...strictAlternates,
  ]
    .map(value => String(value || '').trim())
    .filter(Boolean)
    .filter(value => strictKeywordCandidateAllowed(entry, keyword, value))
  return [...new Set(values)].slice(0, 4)
}

function phraseHit(text: string, term: string) {
  const value = normalize(term)
  if (!value || value.length < 2) return false
  const aliases = TERM_ALIASES[value]
  if (aliases?.some(alias => phraseHit(text, alias))) return true
  if (value.includes(' ')) return text.includes(value)
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(^|\\s)${escaped}(\\s|$)`).test(text)
}

function phraseStart(text: string, term: string) {
  const value = normalize(term)
  if (!value || value.length < 2) return -1
  const aliases = TERM_ALIASES[value]
  if (aliases?.length) {
    const starts = aliases.map(alias => phraseStart(text, alias)).filter(index => index >= 0)
    return starts.length ? Math.min(...starts) : -1
  }
  if (value.includes(' ')) return text.indexOf(value)
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = text.match(new RegExp(`(^|\\s)${escaped}(\\s|$)`))
  return match ? (match.index || 0) + (match[1] ? match[1].length : 0) : -1
}

function meaningfulTerms(terms: unknown[]) {
  return terms
    .map(term => normalize(String(term || '')))
    .filter(term => term && !GENERIC_NICHE_TERMS.has(term))
}

function firstIngredientStart(text: string, heroTerms: string[], qualifierTerms: string[]) {
  const ignored = new Set([
    ...heroTerms.flatMap(term => term.split(/\s+/)),
    ...qualifierTerms.flatMap(term => term.split(/\s+/)),
  ].filter(Boolean))
  const starts = [...INGREDIENT_WORDS]
    .filter(term => !ignored.has(term))
    .map(term => phraseStart(text, term))
    .filter(index => index >= 0)
  return starts.length ? Math.min(...starts) : -1
}

function strictModifiedProductFit(entry: CategoryEntry, product: KeepaProduct, keyword: string) {
  if (!hasStrictModifiedLane(entry)) return null

  const titleText = normalize(product.title || '')
  const paddedTitle = ` ${titleText} `
  const qualifierTerms = strictQualifierFamily(entry, keyword)
  const heroTerms = heroTermsForEntry(entry, keyword)
  let heroHits = heroTerms.map(term => phraseStart(titleText, term)).filter(index => index >= 0)
  const qualifierHits = qualifierTerms.map(term => phraseStart(titleText, term)).filter(index => index >= 0)
  const qualifierImpliesHero = qualifierTerms.some(qualifier =>
    heroTerms.some(hero => qualifier.includes(hero) || hero.includes(qualifier))
  )
  if (!heroHits.length && qualifierImpliesHero) heroHits = qualifierHits

  if (!heroHits.length) {
    return { ok: false, lane_fit: 'wrong_ingredient', reason: `Missing hero ingredient: ${heroTerms.slice(0, 3).join(', ')}` }
  }
  if (!qualifierHits.length) {
    return { ok: false, lane_fit: 'sibling_or_parent_market', reason: `Missing niche qualifier: ${qualifierTerms.slice(0, 4).join(', ')}` }
  }

  const firstHero = Math.min(...heroHits)
  const firstQualifier = Math.min(...qualifierHits)
  const firstOtherIngredient = firstIngredientStart(titleText, heroTerms, qualifierTerms)
  const earlierOtherIngredient = firstOtherIngredient >= 0 && firstOtherIngredient < Math.min(firstHero, firstQualifier)
  const directPhrase = heroTerms.some(hero => qualifierTerms.some(qualifier =>
    phraseHit(paddedTitle, `${qualifier} ${hero}`) || phraseHit(paddedTitle, `${hero} ${qualifier}`)
  ))
  if (directPhrase && !earlierOtherIngredient) {
    return { ok: true, lane_fit: 'exact_modified_niche', reason: 'Hero ingredient and delivery/form qualifier appear as the product lead.' }
  }

  const heroIsLead = firstHero <= 80 && (firstOtherIngredient < 0 || firstHero <= firstOtherIngredient)
  const qualifierIsClose = Math.abs(firstHero - firstQualifier) <= 90

  if (heroIsLead && qualifierIsClose) {
    return { ok: true, lane_fit: 'hero_modified_lead', reason: 'Hero ingredient leads the title and the delivery/form qualifier is close enough to score as direct.' }
  }

  return { ok: false, lane_fit: 'cofactor_in_another_formula', reason: 'Hero ingredient appears as a cofactor inside another delivery/form product.' }
}

function classifyHybridProduct(entry: CategoryEntry, product: KeepaProduct, keyword: string) {
  const frame = entry.competitive_frame || {}
  const text = ` ${normalize(`${product.brand || ''} ${product.title || ''}`)} `
  const keywordTerms = meaningfulTerms(queryTokens(keyword).filter(token => token.length >= 3))
  const frameIncludeTerms = meaningfulTerms(Array.isArray(frame.include) ? frame.include : [])
  const includeTerms = [...new Set([...frameIncludeTerms, ...keywordTerms])]
  const requireTerms = meaningfulTerms(Array.isArray(frame.require_any) ? frame.require_any : [])
  const excludeTerms = meaningfulTerms(Array.isArray(frame.exclude) ? frame.exclude : PRODUCT_NOISE_PATTERNS)
  const stackTerms = meaningfulTerms(Array.isArray(frame.stack_terms) ? frame.stack_terms : [])

  const excludedHits = excludeTerms.filter(term => phraseHit(text, term))
  if (excludedHits.length) {
    return { bucket: 'excluded' as const, classification: 'noise' as const, lane_fit: 'noise', reason: `Excluded term: ${excludedHits.slice(0, 3).join(', ')}` }
  }

  const includeHits = includeTerms.filter(term => phraseHit(text, term))
  if (includeTerms.length && !includeHits.length) {
    return { bucket: 'excluded' as const, classification: 'noise' as const, lane_fit: 'wrong_ingredient', reason: `Missing hero ingredient: ${includeTerms.slice(0, 3).join(', ')}` }
  }

  const requireHits = requireTerms.filter(term => phraseHit(text, term))
  if (requireTerms.length && !requireHits.length) {
    return { bucket: 'adjacent' as const, classification: 'adjacent' as const, lane_fit: 'sibling_or_parent_market', reason: `Missing niche qualifier: ${requireTerms.slice(0, 4).join(', ')}` }
  }

  const strictFit = strictModifiedProductFit(entry, product, keyword)
  if (strictFit && !strictFit.ok) {
    return { bucket: 'adjacent' as const, classification: 'adjacent' as const, lane_fit: strictFit.lane_fit, reason: strictFit.reason }
  }

  const stackHits = stackTerms.filter(term => phraseHit(text, term))
  const hasStackMarker = STACK_MARKERS.some(marker => text.includes(marker))
  const heroWindow = text.slice(0, 150)
  const heroInLead = includeHits.some(term => phraseHit(heroWindow, term))
  if ((stackHits.length >= 2 || (hasStackMarker && stackHits.length >= 1)) && !heroInLead) {
    return { bucket: 'adjacent' as const, classification: 'adjacent' as const, lane_fit: 'condition_stack', reason: `Hero appears inside broader stack: ${stackHits.slice(0, 4).join(', ')}` }
  }

  const laneFit = stackHits.length
    ? 'hero_complex'
    : strictFit?.lane_fit
      ? strictFit.lane_fit
    : requireHits.length
      ? 'exact_niche'
      : 'hero_single'
  const reason = stackHits.length
    ? `Hero ingredient is primary; cofactor complex retained: ${stackHits.slice(0, 4).join(', ')}`
    : strictFit?.reason
      ? strictFit.reason
    : 'Matches hero ingredient and niche qualifier.'
  return { bucket: 'included' as const, classification: 'exact' as const, lane_fit: laneFit, reason }
}

function applyHybridClassification(entry: CategoryEntry, keyword: string, products: KeepaProduct[]) {
  return products.map(product => {
    const classified = classifyHybridProduct(entry, product, keyword)
    return {
      ...product,
      bucket: classified.bucket,
      classification: classified.classification,
      lane_fit: classified.lane_fit,
      reason: classified.reason,
    }
  }).sort((a, b) => {
    const bucketOrder = { included: 0, adjacent: 1, excluded: 2 }
    const aBucket = bucketOrder[a.bucket || 'excluded']
    const bBucket = bucketOrder[b.bucket || 'excluded']
    const aRank = a.bsr_current || a.bsr_avg30 || a.discovery_rank || 999_999_999
    const bRank = b.bsr_current || b.bsr_avg30 || b.discovery_rank || 999_999_999
    return aBucket - bBucket || aRank - bRank || (b.reviews - a.reviews)
  })
}

async function runHybridQuery(entry: CategoryEntry, apifyToken: string, keepaKey: string, keyword: string, keepAsins: number, tokenWaitMs: number): Promise<KeepaAggregate> {
  const queries = discoveryQueries(entry, keyword)
  const discovered = await runApifyDiscovery(apifyToken, queries)
  if (!discovered.length) {
    return {
      ...emptyAggregate('no_apify_discovery_results', 0, null),
      query_packet: queries,
      audit_products: [],
    }
  }

  const enriched = await enrichApifyProductsWithKeepa(keepaKey, discovered, keepAsins, tokenWaitMs)
  const classified = applyHybridClassification(entry, keyword, enriched.products)
  const auditProducts = dedupeProductFamilies(classified)
  const aggregate = computeAggregates(classified)
  const included = auditProducts.filter(product => product.bucket === 'included')
  const adjacent = auditProducts.filter(product => product.bucket === 'adjacent')
  const excluded = auditProducts.filter(product => product.bucket === 'excluded')
  return {
    ...aggregate,
    query_packet: queries,
    audit_products: auditProducts,
    result_quality: {
      ...aggregate.result_quality,
      scoring_basis: 'hybrid_apify_discovery_keepa_enrichment',
      discovery_result_count: discovered.length,
      included_count: included.length,
      adjacent_count: adjacent.length,
      excluded_count: excluded.length,
      query_count: queries.length,
      duplicate_variant_count: aggregate.result_quality?.duplicate_variant_count || 0,
    },
    tokens_consumed: enriched.tokens_consumed,
    refill_rate: enriched.refill_rate,
  }
}
})
