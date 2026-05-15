/**
 * category-atlas-score-run — exact-query Category Atlas v4 scoring.
 *
 * This is deliberately parallel to Market Atlas v4, but it starts from
 * category-atlas entries instead of POE rows. A Category Atlas row is not scored
 * until Keepa Stage A has been run against that row's exact primary keyword
 * (for example, "liposomal berberine", not parent "berberine").
 */

import { corsHeaders } from '../_shared/cors.ts'
import { svcClient } from '../_shared/clients.ts'

const SCORING_VERSION = 'category-atlas-v4-keepa-stage-a'
const KEEPA_BASE = 'https://api.keepa.com'
const KEEPA_DOMAIN_US = 1
const DEFAULT_KEEP_ASINS = 50
const ASIN_RE = /^[A-Z0-9]{10}$/

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
  missing_query_tokens: string[]
  other_ingredient_hits: string[]
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
}

const QUERY_STOPWORDS = new Set([
  'supplement', 'supplements', 'capsule', 'capsules', 'powder', 'powders',
  'tablet', 'tablets', 'softgel', 'softgels', 'liquid', 'drops', 'gummy',
  'gummies', 'organic', 'pure', 'natural', 'extra', 'maximum', 'strength',
  'high', 'potency', 'for', 'with', 'and', 'plus', 'mg', 'serving',
])

const INGREDIENT_WORDS = new Set([
  'berberine', 'cinnamon', 'ceylon', 'bitter', 'melon', 'gymnema', 'chromium',
  'turmeric', 'curcumin', 'ashwagandha', 'magnesium', 'creatine', 'hmb',
  'resveratrol', 'quercetin', 'fisetin', 'spermidine', 'nmn', 'nad',
  'glutathione', 'dihydromyricetin', 'dhm', 'milk', 'thistle', 'alpha',
  'lipoic', 'ala', 'vitamin', 'electrolytes', 'willow', 'bark', 'pqq',
  'coq10', 'nac', 'cysteine', 'selenium', 'choline', 'dandelion', 'beetroot',
  'artichoke',
  'probiotic', 'akkermansia', 'lactobacillus', 'bifidobacterium',
  'garlic', 'pomegranate', 'moringa', 'astaxanthin', 'apigenin',
])

const STACK_MARKERS = [
  ' with ', ' plus ', '+', 'complex', 'blend', 'stack', 'multi', 'all-in-one',
  'formula',
]

const FAMILY_NORMALIZATION_PATTERNS: Array<[RegExp, string]> = [
  [/\bpack\s+of\s+\d+\b/g, ' '],
  [/\b\d+\s*[- ]?\s*pack\b/g, ' '],
  [/\b\d+\s*[- ]?\s*day\s+supply\b/g, ' '],
  [/\b\d+\s*(count|ct|capsules?|caps|softgels?|tablets?|tabs|servings?|fl\.?\s*oz|oz|ml|milliliters?)\b/g, ' '],
  [/\b\d+(\.\d+)?\s*(mg|mcg|g|gram|grams)\b/g, ' '],
  [/\b\d+\s*in\s*1\b/g, ' '],
]

const PRODUCT_NOISE_PATTERNS = [
  'for dogs', 'for cats', ' cat ', ' dog ', 'pet ', 'skin care', 'skincare',
  'serum', 'face cream', 'topical', 'lotion', 'essential oil', 'diffuser',
]

const RECOMMENDATION_ORDER: Record<RecommendationLabel, number> = {
  pass: 0,
  watchlist: 1,
  strong_candidate: 2,
  launch_priority: 3,
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
    .replace(/\s+/g, ' ')
    .trim()
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

function productFamilyKey(brand: string, title: string, parentAsin: string | null, asin: string, reviews = 0, rank: number | null = null) {
  const normalizedBrand = normalize(brand) || 'unknown-brand'
  if (rank && rank > 0) return `${normalizedBrand}|rank-family:${Math.round(rank / 25)}`
  if (parentAsin && ASIN_RE.test(parentAsin) && parentAsin !== asin) return `parent:${parentAsin}`
  if (reviews >= 50) return `${normalizedBrand}|review-family:${reviews}`
  return `${normalizedBrand}|${canonicalFamilyTitle(title)}`
}

function queryTokens(query: string) {
  return normalize(query).split(/\s+/)
    .map(token => token.replace(/^-+|-+$/g, ''))
    .filter(token => token.length >= 3 && !QUERY_STOPWORDS.has(token))
}

function primaryKeyword(entry: CategoryEntry) {
  const existing = String(entry.primary_keyword || '').trim()
  if (existing) return existing
  const best = String(entry.best_keyword || '').trim()
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

function percentile(values: number[], p: number): number | null {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor((sorted.length - 1) * p)]
}

function finiteNumber(value: unknown): number | null {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function statValue(stats: any, key: 'current' | 'avg30' | 'avg90', idx: number): number | null {
  const arr = stats?.[key]
  if (!Array.isArray(arr)) return null
  const value = arr[idx]
  if (value === -1 || value === -2 || value === 0 || value === null || value === undefined) return null
  return Number.isFinite(Number(value)) ? Number(value) : null
}

function priceFromCents(value: number | null): number | null {
  return value === null ? null : Math.round(value) / 100
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

async function keepaGet(path: string, params: Record<string, string | number>, apiKey: string) {
  const url = new URL(`${KEEPA_BASE}${path}`)
  url.searchParams.set('key', apiKey)
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value))
  const res = await fetch(url.toString())
  const json = await res.json().catch(() => ({}))
  if (!res.ok) {
    const detail = json?.error?.message || json?.error?.type || JSON.stringify(json).slice(0, 300)
    throw new Error(`Keepa ${path} ${res.status}: ${detail}`)
  }
  return json
}

async function waitForKeepaTokens(apiKey: string, maxWaitMs: number, minTokens = 1) {
  const started = Date.now()
  while (true) {
    const status = await keepaGet('/token', {}, apiKey)
    if (Number(status.tokensLeft || 0) >= minTokens) return status
    const refillMs = Math.max(5_000, Number(status.refillIn || 30_000) + 1_000)
    if (Date.now() - started + refillMs > maxWaitMs) {
      throw new Error(`not_enough_keepa_tokens_retry_later tokensLeft=${status.tokensLeft} minTokens=${minTokens} refillIn=${status.refillIn}`)
    }
    await new Promise(resolve => setTimeout(resolve, refillMs))
  }
}

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

function titleLooksLikeVariant(title: string) {
  const text = normalize(title)
  return /\b(pack\s+of\s+\d+|\d+\s*[- ]?\s*pack|\d+\s*[- ]?\s*day\s+supply)\b/.test(text)
}

function mergeProductFamily(existing: KeepaProduct, incoming: KeepaProduct) {
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

function dedupeProductFamilies(products: KeepaProduct[]) {
  const families = new Map<string, KeepaProduct>()
  for (const product of products) {
    const existing = families.get(product.product_key)
    if (existing) mergeProductFamily(existing, { ...product, duplicate_asins: [...product.duplicate_asins] })
    else families.set(product.product_key, { ...product, duplicate_asins: [...product.duplicate_asins] })
  }
  return [...families.values()].sort((a, b) => {
    const aRank = a.bsr_current || a.bsr_avg30 || 999_999_999
    const bRank = b.bsr_current || b.bsr_avg30 || 999_999_999
    return aRank - bRank || (b.monthly_sold - a.monthly_sold) || (b.reviews - a.reviews)
  })
}

async function runKeepaQuery(apiKey: string, query: string, keepAsins: number, tokenWaitMs: number): Promise<KeepaAggregate> {
  await waitForKeepaTokens(apiKey, tokenWaitMs, keepAsins + 10)
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

function scoreEntry(entry: CategoryEntry, keyword: string, enrichment: KeepaAggregate) {
  const quality = resultQualityScore(enrichment)
  const salesConcentration = nullableNumber(enrichment.sales_top3_share) ?? 0.55
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

function pillarScores(score: ReturnType<typeof scoreEntry>, keyword: string, entry: CategoryEntry, enrichment: KeepaAggregate) {
  return {
    market_size_intent: {
      score: Number(score.metrics.market_size_intent.toFixed(1)),
      weight: 0.20,
      reason: `Exact keyword ${keyword}; category demand ${n(entry.latest_clicks).toLocaleString()} clicks / ${n(entry.latest_sales).toLocaleString()} sales; Keepa result quality ${score.metrics.demand_quality.toFixed(2)}.`,
    },
    early_market_access: {
      score: Number(score.metrics.early_market_access.toFixed(1)),
      weight: 0.25,
      reason: `Attackability ${score.metrics.attackability.toFixed(3)}, review moat ${score.metrics.review_moat.toFixed(3)}, review p50 ${n(enrichment.review_p50).toLocaleString()}, best BSR ${n(enrichment.bsr_best).toLocaleString()}.`,
    },
    growth_timing: {
      score: Number(score.metrics.growth_timing.toFixed(1)),
      weight: 0.20,
      reason: `Source keyword growth ${entry.best_keyword_growth ?? 'n/a'}%.`,
    },
    differentiation_proxy: {
      score: Number(score.metrics.differentiation_proxy.toFixed(1)),
      weight: 0.35,
      reason: `Exact keyword specificity ${score.metrics.specificity.toFixed(2)}; no parent-market fallback used.`,
    },
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

    let importId = body.import_id
    if (!importId) {
      const { data, error } = await sb.from('category_atlas_imports').select('id').eq('status', 'completed').order('generated_at', { ascending: false }).limit(1).single()
      if (error || !data) throw new Error(`No completed Category Atlas import found: ${error?.message || 'empty'}`)
      importId = data.id
    }

    let query = sb.from('category_atlas_entries')
      .select('*')
      .eq('import_id', importId)
      .order('latest_clicks', { ascending: false, nullsFirst: false })
      .limit(limit)

    if (Array.isArray(body.entry_ids) && body.entry_ids.length) query = query.in('id', body.entry_ids)
    else if (!force) query = query.in('score_status', ['pending_v4', 'failed'])

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
      await sb.from('category_atlas_entries').update({ score_status: 'scoring', primary_keyword: keyword, score_run_id: runId }).eq('id', entry.id)
      try {
        const enrichment = await runKeepaQuery(keepaKey, keyword, keepAsins, tokenWaitMs)
        keepaTokens += enrichment.tokens_consumed || 0
        const scoredEntry = scoreEntry(entry, keyword, enrichment)
        const competitive_snapshot = {
          keepa: {
            query: keyword,
            source: 'keepa_product_finder',
            source_version: 'keepa-stage-a-v1',
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
            })),
          },
          guardrail: 'Exact primary_keyword competitive set only; parent-market fallback is not allowed.',
        }
        const computed_signals = {
          scoring_version: SCORING_VERSION,
          primary_keyword: keyword,
          deterministic_score: scoredEntry.composite_score,
          ...scoredEntry.metrics,
          max_recommendation: scoredEntry.gate.max_recommendation,
        }
        const update = {
          primary_keyword: keyword,
          score_status: 'scored',
          score_run_id: runId,
          strategic_score: scoredEntry.composite_score,
          recommendation_label: scoredEntry.recommendation_label,
          score_confidence: enrichment.confidence === 'high' && !enrichment.error ? 'high' : 'low',
          pillar_scores: pillarScores(scoredEntry, keyword, entry, enrichment),
          computed_signals,
          scoring_notes: `Scored through ${SCORING_VERSION} using exact Keepa query "${keyword}". Parent-market fallback was not used.`,
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
          await sb.from('category_atlas_entries').update({ score_status: 'pending_v4', score_error: message, score_run_id: runId, primary_keyword: keyword }).eq('id', entry.id)
          results.push({ id: entry.id, name: entry.name, primary_keyword: keyword, deferred: 'keepa_tokens', error: message })
          break
        }
        failed += 1
        await sb.from('category_atlas_entries').update({ score_status: 'failed', score_error: message, score_run_id: runId, primary_keyword: keyword }).eq('id', entry.id)
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
})
