/**
 * Hybrid competitive-scoring engine — shared between Category Atlas v5 scoring
 * and Phase B v5 concept evaluation.
 *
 * The engine takes a HybridFrame (hero ingredient + optional delivery modifier
 * + inclusion/exclusion rules + query packet) and produces a classified
 * competitor set: included / adjacent / excluded, with Keepa enrichment for
 * BSR, reviews, monthly-sold badge, price, rating.
 *
 * Pipeline:
 *   1. Apify Axesso search-scrape across queries → candidate ASIN universe
 *   2. Keepa /product enrichment in batches of 20 → BSR + reviews + price
 *   3. Frame-driven classification → included | adjacent | excluded
 *   4. Family dedupe (parent ASIN + canonical title) → top results
 *
 * Callers compose pillar scores on top of this — the shared module is the data
 * layer (discovery + enrichment + classification + percentiles). Pillar
 * weighting and gating live in each caller because they differ.
 *
 * Source-locked. No data is fabricated. If discovery is empty, the result
 * carries `error='no_apify_discovery_results'` and the caller must decide
 * whether to fail the quality gate.
 *
 * Extracted 2026-05-21 from category-atlas-score-run/index.ts which had grown
 * to 1770 lines and embedded both the engine and the Category-Atlas-specific
 * scoring. Phase B v5 reuses the engine via this module.
 */

import { apifyRunSync } from './clients.ts'

// ── Public types ─────────────────────────────────────────────────────────

/**
 * Frame describing what the competitive set should look like.
 *
 * Phase B builds this from an LLM frame-inference step; Category Atlas builds
 * it from category_atlas_entries.competitive_frame. The hybrid engine doesn't
 * care which — it just enforces the rules.
 */
export interface HybridFrame {
  /** 'broad_hero' | 'strict_modifier' — Phase B 2-frame system. */
  frame: 'broad_hero' | 'strict_modifier'
  /** The hero ingredient (e.g. 'cayenne', 'astaxanthin', 'quercetin'). */
  hero_ingredient: string
  /** Delivery / form qualifier when frame === 'strict_modifier' (e.g. 'liposomal', 'phytosome'). */
  delivery_modifier?: string
  /** Buyer-style search queries used for Apify discovery (typically 4-8). */
  query_packet: string[]
  /** Tokens that MUST appear in title for product to be 'included'. Defaults to [hero_ingredient]. */
  include_terms?: string[]
  /** Tokens that MUST appear in title for strict_modifier frames (typically [delivery_modifier]). */
  require_any?: string[]
  /** Tokens that disqualify a product (pets, topical, food, etc.). */
  exclude_terms?: string[]
  /** Optional stack markers; presence + 2+ other ingredient hits → 'adjacent' (hero buried in stack). */
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

// ── Constants ────────────────────────────────────────────────────────────

export const APIFY_SEARCH_ACTOR = 'axesso_data/amazon-search-scraper'
export const KEEPA_BASE = 'https://api.keepa.com'
export const KEEPA_DOMAIN_US = 1
export const ASIN_RE = /^[A-Z0-9]{10}$/

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

export const STACK_MARKERS = [
  ' with ', ' plus ', '+', 'complex', 'blend', 'stack', 'multi', 'all-in-one',
  'formula',
]

export const PRODUCT_NOISE_PATTERNS = [
  'for dogs', 'for cats', ' cat ', ' dog ', ' pet ', 'skin care', 'skincare',
  'serum', 'face cream', 'topical', 'lotion', 'essential oil', 'diffuser',
]

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
    const aRank = a.bsr_current || a.bsr_avg30 || 999_999_999
    const bRank = b.bsr_current || b.bsr_avg30 || 999_999_999
    return aRank - bRank || (b.monthly_sold - a.monthly_sold) || (b.reviews - a.reviews)
  })
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
  return products
}

export async function enrichApifyProductsWithKeepa(
  apiKey: string,
  discovered: HybridProduct[],
  keepAsins: number,
  tokenWaitMs: number,
) {
  const asins = discovered.map(product => product.asin).filter(Boolean).slice(0, keepAsins)
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
  const merged = discovered.slice(0, keepAsins).map(product => {
    const keepa = keepaByAsin.get(product.asin)
    if (!keepa) return product
    return {
      ...keepa,
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

// ── Frame-based classification ───────────────────────────────────────────

function meaningfulTerms(terms: unknown[]) {
  return terms
    .map(term => normalize(String(term || '')))
    .filter(term => term && term.length >= 2)
}

function firstIngredientStart(text: string, heroTerms: string[]) {
  const ignored = new Set(heroTerms.flatMap(term => term.split(/\s+/)).filter(Boolean))
  const starts = [...INGREDIENT_WORDS]
    .filter(term => !ignored.has(term))
    .map(term => {
      if (term.includes(' ')) return text.indexOf(term)
      const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const match = text.match(new RegExp(`(^|\\s)${escaped}(\\s|$)`))
      return match ? (match.index || 0) + (match[1] ? match[1].length : 0) : -1
    })
    .filter(index => index >= 0)
  return starts.length ? Math.min(...starts) : -1
}

function phraseStart(text: string, term: string) {
  const value = normalize(term)
  if (!value || value.length < 2) return -1
  if (value.includes(' ')) return text.indexOf(value)
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = text.match(new RegExp(`(^|\\s)${escaped}(\\s|$)`))
  return match ? (match.index || 0) + (match[1] ? match[1].length : 0) : -1
}

/**
 * Classify a single product against the frame.
 *
 * Rules:
 *  - broad_hero:
 *      - excluded: noise terms (pets/topical) or hero ingredient absent.
 *      - adjacent: hero present but buried (other ingredient leads, or 2+ stack markers).
 *      - included: hero leads or is the only meaningful ingredient.
 *  - strict_modifier:
 *      - included only if BOTH hero AND modifier appear in title AND
 *        modifier is close to hero (within 90 chars).
 *      - everything else: adjacent or excluded.
 */
export function classifyHybridProduct(frame: HybridFrame, product: HybridProduct) {
  const text = ` ${normalize(`${product.brand || ''} ${product.title || ''}`)} `

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

  // Excluded — noise / wrong category
  const excludedHits = excludeTerms.filter(term => phraseHit(text, term))
  if (excludedHits.length) {
    return { bucket: 'excluded' as const, classification: 'noise' as const, lane_fit: 'noise', reason: `Excluded term: ${excludedHits.slice(0, 3).join(', ')}` }
  }

  // Hero missing — excluded
  const heroHits = heroTerms.map(term => phraseStart(text, term)).filter(index => index >= 0)
  if (!heroHits.length) {
    return { bucket: 'excluded' as const, classification: 'noise' as const, lane_fit: 'wrong_ingredient', reason: `Missing hero ingredient: ${heroTerms.slice(0, 3).join(', ')}` }
  }

  // Strict-modifier requires delivery qualifier in title
  if (frame.frame === 'strict_modifier' && requireTerms.length > 0) {
    const reqHits = requireTerms.map(term => phraseStart(text, term)).filter(index => index >= 0)
    if (!reqHits.length) {
      return { bucket: 'adjacent' as const, classification: 'adjacent' as const, lane_fit: 'sibling_or_parent_market', reason: `Missing ${frame.delivery_modifier || requireTerms[0]} qualifier; appears to be the non-modified hero.` }
    }
    // Qualifier must be within proximity of hero
    const firstHero = Math.min(...heroHits)
    const firstQualifier = Math.min(...reqHits)
    const qualifierIsClose = Math.abs(firstHero - firstQualifier) <= 90
    if (!qualifierIsClose) {
      return { bucket: 'adjacent' as const, classification: 'adjacent' as const, lane_fit: 'cofactor_in_another_formula', reason: 'Hero and modifier appear in title but are far apart — likely a stack where hero is a cofactor.' }
    }
    return { bucket: 'included' as const, classification: 'exact' as const, lane_fit: 'exact_modified_niche', reason: 'Hero + delivery modifier both in title and lead the product positioning.' }
  }

  // broad_hero: included only if hero leads OR no other ingredient outranks it
  const firstHero = Math.min(...heroHits)
  const firstOtherIngredient = firstIngredientStart(text, heroTerms)
  const earlierOtherIngredient = firstOtherIngredient >= 0 && firstOtherIngredient < firstHero

  const stackHits = stackTerms.filter(term => phraseHit(text, term))
  const hasStackMarker = STACK_MARKERS.some(marker => text.includes(marker))
  const heroWindow = text.slice(0, 150)
  const heroInLead = heroTerms.some(term => phraseHit(heroWindow, term))

  // Hero buried under another ingredient — adjacent
  if (earlierOtherIngredient && !heroInLead) {
    return { bucket: 'adjacent' as const, classification: 'adjacent' as const, lane_fit: 'condition_stack', reason: 'Hero ingredient appears but is preceded by another named ingredient — hero is not the undisputed lead.' }
  }

  // Big stack with hero buried — adjacent
  if ((stackHits.length >= 2 || (hasStackMarker && stackHits.length >= 1)) && !heroInLead) {
    return { bucket: 'adjacent' as const, classification: 'adjacent' as const, lane_fit: 'condition_stack', reason: `Hero appears inside broader stack: ${stackHits.slice(0, 4).join(', ')}` }
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
  }).sort((a, b) => {
    const bucketOrder = { included: 0, adjacent: 1, excluded: 2 }
    const aBucket = bucketOrder[a.bucket || 'excluded']
    const bBucket = bucketOrder[b.bucket || 'excluded']
    const aRank = a.bsr_current || a.bsr_avg30 || a.discovery_rank || 999_999_999
    const bRank = b.bsr_current || b.bsr_avg30 || b.discovery_rank || 999_999_999
    return aBucket - bBucket || aRank - bRank || (b.reviews - a.reviews)
  })
}

// ── Aggregates ───────────────────────────────────────────────────────────

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

// ── Main entry: runHybridQuery ───────────────────────────────────────────

/**
 * Discovery + Keepa enrichment + frame-driven classification for a single
 * concept / category entry. Returns an aggregate plus the full classified
 * product set (audit_products) so the caller can compute its own pillar
 * sub-signals.
 */
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

  const enriched = await enrichApifyProductsWithKeepa(keepaKey, discovered, keepAsins, tokenWaitMs)
  const classified = applyHybridClassification(frame, enriched.products)
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
