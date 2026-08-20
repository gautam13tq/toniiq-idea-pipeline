/**
 * Hybrid competitive-scoring engine — shared between Category Atlas v5 scoring
 * and Phase B v5 concept evaluation.
 *
 * Deterministic classification, aggregates, and demand-gate logic live in
 * scoring_core.ts (also used by the Node golden-set replay harness).
 * This module adds Apify/Keepa discovery + enrichment (network I/O).
 */

import { apifyRunSync } from './clients.ts'
import {
  type HybridFrame,
  type HybridProduct,
  type HybridAggregate,
  type DemandRowLite,
  ASIN_RE,
  KEEPA_ENRICH_CAP,
  KEEPA_INCLUDED_COVERAGE_TARGET,
  normalize,
  nullableNumber,
  n,
  finiteNumber,
  statValue,
  priceFromCents,
  applyHybridClassification,
  compareHybridProducts,
  computeAggregates,
  dedupeProductFamilies,
  emptyAggregate,
  mergeKeepaIntoClassifiedProducts,
  selectKeepaEnrichmentTargets,
} from './scoring_core.ts'

export type { HybridFrame, HybridProduct, HybridAggregate, DemandRowLite } from './scoring_core.ts'
export {
  ASIN_RE,
  STACK_MARKERS,
  PRODUCT_NOISE_PATTERNS,
  KEEPA_ENRICH_CAP,
  KEEPA_INCLUDED_COVERAGE_TARGET,
  DEMAND_MIN_PRIMARY_CLICKS,
  DEMAND_MIN_ROWS_WITH_DATA,
  DEMAND_STRONG_PRIMARY_CLICKS,
  DEMAND_STRONG_PRIMARY_MIN_ROWS,
  DEMAND_FRAME_CLICKS_ALT_THRESHOLD,
  n,
  nullableNumber,
  clamp,
  normalize,
  percentile,
  finiteNumber,
  statValue,
  priceFromCents,
  queryTokens,
  phraseHit,
  titleTextForClassification,
  compareHybridProducts,
  selectKeepaEnrichmentTargets,
  classifyHybridProduct,
  applyHybridClassification,
  emptyAggregate,
  computeAggregates,
  dedupeProductFamilies,
  mergeKeepaIntoClassifiedProducts,
  scoreKeywordFrameRelevance,
  selectFrameRelevantDemandPrimary,
  evaluateDemandQualityGate,
} from './scoring_core.ts'

export const APIFY_SEARCH_ACTOR = 'axesso_data/amazon-search-scraper'
export const KEEPA_BASE = 'https://api.keepa.com'
export const KEEPA_DOMAIN_US = 1

export const QUERY_STOPWORDS = new Set([
  'supplement', 'supplements', 'capsule', 'capsules', 'powder', 'powders',
  'tablet', 'tablets', 'softgel', 'softgels', 'liquid', 'drops', 'gummy',
  'gummies', 'organic', 'pure', 'natural', 'extra', 'maximum', 'strength',
  'high', 'potency', 'for', 'with', 'and', 'plus', 'mg', 'serving',
])

export const INGREDIENT_WORDS = new Set([
  'berberine', 'cinnamon', 'ceylon', 'bitter', 'melon', 'gymnema', 'chromium',
  'turmeric', 'curcumin', 'ashwagandha', 'magnesium', 'creatine', 'hmb',
  'resveratrol', 'quercetin', 'fisetin', 'spermidine', 'nmn', 'nmnh', 'nad',
  'ergothioneine',
  'glutathione', 'dihydromyricetin', 'dhm', 'milk', 'thistle', 'alpha',
  'lipoic', 'ala', 'vitamin', 'electrolytes', 'willow', 'bark', 'pqq',
  'coq10', 'nac', 'cysteine', 'selenium', 'choline', 'dandelion', 'beetroot',
  'artichoke', 'zinc', 'copper', 'calcium', 'iron', 'iodine', 'manganese',
  'boron', 'molybdenum',
  'probiotic', 'akkermansia', 'lactobacillus', 'bifidobacterium', 'boulardii', 'saccharomyces',
  'garlic', 'pomegranate', 'moringa', 'astaxanthin', 'apigenin',
  'collagen', 'hyaluronic', 'lutein', 'lycopene',
  'cayenne', 'capsaicin', 'mct', 'caprylic', 'capric', 'l-carnitine', 'carnitine',
])

const FAMILY_NORMALIZATION_PATTERNS: Array<[RegExp, string]> = [
  [/\bpack\s+of\s+\d+\b/g, ' '],
  [/\b\d+\s*[- ]?\s*pack\b/g, ' '],
  [/\b\d+\s*[- ]?\s*day\s+supply\b/g, ' '],
  [/\b\d+\s*(count|ct|capsules?|caps|softgels?|tablets?|tabs|servings?|fl\.?\s*oz|oz|ml|milliliters?)\b/g, ' '],
  [/\b\d+(\.\d+)?\s*(mg|mcg|g|gram|grams)\b/g, ' '],
  [/\b\d+\s*in\s*1\b/g, ' '],
]

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

// ── Keepa ────────────────────────────────────────────────────────────────

export async function keepaGet(path: string, params: Record<string, string | number>, apiKey: string) {
  const url = new URL(`${KEEPA_BASE}${path}`)
  url.searchParams.set('key', apiKey)
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value))
  const res = await fetch(url.toString())
  const json = await res.json().catch(() => ({}))
  if (!res.ok) {
    if (res.status === 429) {
      throw new Error(`not_enough_keepa_tokens_retry_later tokensLeft=${json?.tokensLeft ?? 'n/a'} refillIn=${json?.refillIn ?? 'n/a'} path=${path}`)
    }
    const detail = json?.error?.message || json?.error?.type || JSON.stringify(json).slice(0, 300)
    throw new Error(`Keepa ${path} ${res.status}: ${detail}`)
  }
  return json
}

export async function waitForKeepaTokens(apiKey: string, maxWaitMs: number, minTokens = 1) {
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

export function normalizeKeepaProduct(query: string, raw: any): HybridProduct | null {
  const asin = String(raw.asin || '').toUpperCase()
  if (!ASIN_RE.test(asin)) return null
  const parentAsin = String(raw.parentAsin || '').toUpperCase()
  const parent_asin = ASIN_RE.test(parentAsin) ? parentAsin : null
  const title = String(raw.title || '').slice(0, 300).trim()
  if (!title) return null
  const stats = raw.stats || {}
  const price = priceFromCents(statValue(stats, 'current', 18) || statValue(stats, 'current', 1) || statValue(stats, 'avg30', 18) || statValue(stats, 'avg30', 1))
  const ratingRaw = statValue(stats, 'current', 16)
  const brand = String(raw.brand || raw.manufacturer || '').slice(0, 120)
  const reviews = statValue(stats, 'current', 17) || 0
  const bsr_current = statValue(stats, 'current', 3)
  const bsr_avg30 = statValue(stats, 'avg30', 3)
  return {
    asin,
    parent_asin,
    product_key: productFamilyKey(brand, title, parent_asin, asin, reviews),
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
    classification: 'adjacent',
    missing_query_tokens: [],
    other_ingredient_hits: [],
  }
}

// ── Apify discovery ──────────────────────────────────────────────────────

function parseInteger(value: unknown) {
  const parsed = Number(String(value || '').replace(/[^\d.-]/g, ''))
  return Number.isFinite(parsed) ? Math.round(parsed) : 0
}

function parsePrice(value: unknown) {
  const parsed = Number(String(value || '').replace(/[^0-9.]/g, ''))
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function apifyAsin(raw: any) {
  return String(raw?.asin || raw?.ASIN || raw?.productAsin || '').toUpperCase()
}

function apifyTitle(raw: any) {
  return String(raw?.productDescription || raw?.title || raw?.name || '').slice(0, 320).trim()
}

function extractBrandFromTitle(title: string) {
  const lead = title.split(/[-|:,]/)[0]?.trim()
  return lead && lead.length <= 60 ? lead : ''
}

function normalizeApifyProduct(raw: any, fallbackQuery: string, rank: number): HybridProduct | null {
  const asin = apifyAsin(raw)
  if (!ASIN_RE.test(asin)) return null
  const title = apifyTitle(raw)
  if (!title) return null
  const brand = String(raw?.brand || raw?.byLineInfo || extractBrandFromTitle(title) || '').slice(0, 120)
  const reviews = parseInteger(raw?.countReview ?? raw?.numberOfReviews ?? raw?.reviews)
  const rating = nullableNumber(raw?.productRating ?? raw?.rating)
  const price = parsePrice(raw?.price ?? raw?.priceValue)
  const monthlySold = parseInteger(raw?.salesVolume ?? raw?.monthlySales ?? raw?.boughtInPastMonth)
  const discoveryQuery = String(raw?.searchKeyword || raw?.keyword || raw?.input?.keyword || fallbackQuery || '').trim()
  return {
    asin,
    parent_asin: null,
    product_key: productFamilyKey(brand, title, null, asin, reviews),
    duplicate_asins: [asin],
    variant_count: 1,
    discovery_query: discoveryQuery,
    discovery_rank: rank,
    amazon_url: raw?.url || raw?.productUrl || `https://www.amazon.com/dp/${asin}`,
    title,
    brand,
    price,
    rating,
    reviews,
    monthly_sold: monthlySold,
    bsr_current: null,
    bsr_avg30: null,
    bsr_avg90: null,
    classification: 'adjacent',
    missing_query_tokens: [],
    other_ingredient_hits: [],
    source_payload: raw,
  }
}

export async function runApifyDiscovery(apifyToken: string, queries: string[], timeoutMs = 120_000): Promise<HybridProduct[]> {
  const cleanQueries = queries.filter(q => q && q.trim().length > 0).slice(0, 8)
  if (!cleanQueries.length) return []
  const rawResults = await apifyRunSync(apifyToken, APIFY_SEARCH_ACTOR, {
    input: cleanQueries.map(keyword => ({
      keyword,
      domainCode: 'com',
      sortBy: 'relevanceblender',
      maxPages: 2,
      category: 'aps',
    })),
  }, timeoutMs)

  const seen = new Set<string>()
  const products: HybridProduct[] = []
  for (const [index, raw] of (rawResults || []).entries()) {
    const product = normalizeApifyProduct(raw, cleanQueries[0], index + 1)
    if (!product || seen.has(product.asin)) continue
    seen.add(product.asin)
    products.push(product)
  }
  return products.sort((a, b) => (a.discovery_rank || 0) - (b.discovery_rank || 0) || a.asin.localeCompare(b.asin))
}

export async function enrichApifyProductsWithKeepa(
  apiKey: string,
  discovered: HybridProduct[],
  keepAsins: number,
  tokenWaitMs: number,
) {
  const targets = discovered.slice(0, keepAsins)
  const asins = targets.map(product => product.asin).filter(Boolean)
  if (!asins.length) return { products: discovered, tokens_consumed: 0, refill_rate: null as number | null }
  await waitForKeepaTokens(apiKey, tokenWaitMs, Math.min(keepAsins, asins.length) + 5)

  const enrichedProducts: HybridProduct[] = []
  let tokensConsumed = 0
  let refillRate: number | null = null
  for (let i = 0; i < asins.length; i += 20) {
    const chunk = asins.slice(i, i + 20)
    const enriched = await keepaGet('/product', {
      domain: KEEPA_DOMAIN_US,
      asin: chunk.join(','),
      stats: 90,
      history: 0,
      rating: 1,
    }, apiKey)
    tokensConsumed += Number(enriched.tokensConsumed || 0)
    refillRate = finiteNumber(enriched.refillRate) || refillRate
    enrichedProducts.push(...((enriched.products || [])
      .map((raw: any) => normalizeKeepaProduct('', raw))
      .filter(Boolean) as HybridProduct[]))
  }

  const keepaByAsin = new Map(enrichedProducts.map(product => [product.asin, product]))
  const merged = targets.map(product => {
    const keepa = keepaByAsin.get(product.asin)
    if (!keepa) return product
    return {
      ...keepa,
      bucket: product.bucket,
      classification: product.classification,
      lane_fit: product.lane_fit,
      reason: product.reason,
      discovery_query: product.discovery_query,
      discovery_rank: product.discovery_rank,
      amazon_url: product.amazon_url || `https://www.amazon.com/dp/${product.asin}`,
      title: keepa.title || product.title,
      brand: keepa.brand || product.brand,
      price: keepa.price || product.price,
      rating: keepa.rating || product.rating,
      reviews: keepa.reviews || product.reviews,
      monthly_sold: keepa.monthly_sold || product.monthly_sold,
      source_payload: product.source_payload,
    }
  })

  return { products: merged, tokens_consumed: tokensConsumed, refill_rate: refillRate }
}

export async function runHybridQuery(
  frame: HybridFrame,
  apifyToken: string,
  keepaKey: string,
  keepAsins: number,
  tokenWaitMs: number,
): Promise<HybridAggregate> {
  const queries = [...new Set((frame.query_packet || []).map(q => String(q || '').trim()).filter(Boolean))].slice(0, 8)
  if (!queries.length) {
    return emptyAggregate('empty_query_packet', 0, null, queries)
  }

  const discovered = await runApifyDiscovery(apifyToken, queries)
  if (!discovered.length) {
    return emptyAggregate('no_apify_discovery_results', 0, null, queries)
  }

  const classifiedAll = applyHybridClassification(frame, discovered)
  const preAuditIncluded = dedupeProductFamilies(classifiedAll).filter(product => product.bucket === 'included').length
  const enrichCap = Math.min(
    KEEPA_ENRICH_CAP,
    Math.max(keepAsins, Math.ceil(preAuditIncluded * KEEPA_INCLUDED_COVERAGE_TARGET)),
  )
  const enrichTargets = selectKeepaEnrichmentTargets(classifiedAll, enrichCap)
  const enriched = await enrichApifyProductsWithKeepa(keepaKey, enrichTargets, enrichTargets.length, tokenWaitMs)
  const classified = mergeKeepaIntoClassifiedProducts(classifiedAll, enriched.products)
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
