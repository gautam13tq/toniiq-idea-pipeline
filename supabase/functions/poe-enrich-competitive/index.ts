/**
 * poe-enrich-competitive — Stage A competitive enrichment for Niche Curation v4.
 *
 * Keepa replaced the previous Axesso path after calibration showed Axesso
 * `salesVolume` is Amazon badge noise and search-result discovery misses
 * current market leaders. This function now:
 *   - uses Keepa Product Finder to discover ASINs by current sales rank,
 *   - enriches those ASINs with BSR/review/rating/price/monthlySold badge data,
 *   - classifies single-ingredient vs stack/noise so broad queries do not
 *     silently poison review moat and attackability primitives.
 *
 * Output: one poe_competitive_enrichments row per (poe_snapshot_id, query_type).
 */

import { corsHeaders } from '../_shared/cors.ts'
import { svcClient } from '../_shared/clients.ts'

const KEEPA_BASE = 'https://api.keepa.com'
const KEEPA_DOMAIN_US = 1
const DEFAULT_KEEP_ASINS = 20
const ASIN_RE = /^[A-Z0-9]{10}$/

// Noise filter — skip enriching obvious junk rows. Brand-led terms are handled
// at query level so a valid row is not skipped just because one top term names
// a competitor.
const NOISE_PATTERNS = [
  'viagra', 'dildo', 'vibrator',
  'sex toy', 'sex toys', 'lube', 'for dogs', 'for cats', 'pet', 'kids vitamins',
  'massager', 'machine', 'device', 'tool', 'roller', 'patch', 'patches',
  'protein bar', 'protein bars',
]

const PRODUCT_NOISE_PATTERNS = [
  'for dogs', 'for cats', ' cat ', ' dog ', 'pet ', 'pets ', 'cat treats',
  'dog treats', 'lickable', 'topper', 'purée', 'puree',
  'skin care', 'skincare', 'toner', 'toner pad', 'serum', 'face cream',
  'facial', 'acrylic paint', 'phone case', 'iphone', 'magsafe',
  'topical', 'lotion', 'body oil', 'hair oil', 'cup sleeve', 'neoprene',
  'essential oil', 'diffuser', 'aromatherapy',
]

const BRAND_PATTERNS = [
  'ryze', 'mary ruth', 'ritual', 'garden of life', 'nature made', 'olly',
  'smarty pants', 'centrum', 'thorne', 'pure encapsulations', 'sports research',
  'nutricost', 'now foods', 'force factor', 'leefar', 'nuora', 'alpha fuel',
  'calm drink', 'elare', 'kos', 'barebells',
]

const GENERIC_EXACT = new Set([
  'vitamins', 'supplements', 'weight loss', 'sleep aid', 'energy', 'detox',
  'cleanse', 'diet', 'protein', 'probiotic', 'probiotics', 'multivitamin',
  'gummy', 'gummies',
])

const QUERY_STOPWORDS = new Set([
  'supplement', 'supplements', 'capsule', 'capsules', 'powder', 'powders',
  'tablet', 'tablets', 'softgel', 'softgels', 'liquid', 'drops', 'gummy',
  'gummies', 'organic', 'pure', 'natural', 'extra', 'maximum', 'strength',
  'high', 'potency', 'for', 'with', 'and', 'plus', 'mg', 'serving',
])

const INGREDIENT_WORDS = new Set([
  'berberine', 'cinnamon', 'ceylon', 'bitter', 'melon', 'gymnema', 'chromium',
  'turmeric', 'cayenne', 'vinegar', 'ginseng', 'glucomannan', 'thistle',
  'garlic', 'pumpkin', 'oregano', 'soursop', 'probiotic', 'akkermansia',
  'magnesium', 'glycinate', 'threonate', 'malate', 'citrate', 'theanine',
  'valerian', 'melatonin', 'reishi', 'gaba', 'ashwagandha', 'apigenin',
  'creatine', 'hmb', 'monohydrate', 'bcaa', 'arginine', 'citrulline',
  'tongkat', 'electrolytes', 'collagen', 'mushroom', 'coffee', 'yerba',
  'mate', 'chromium', 'pomegranate', 'glutamine', 'resveratrol', 'quercetin',
  'moringa', 'zinc', 'copper', 'lutein', 'zeaxanthin', 'taurine',
])

const STACK_MARKERS = [
  ' with ', ' plus ', '+', 'complex', 'blend', 'stack', 'multi', '14-in-1',
  '15-in-1', 'all-in-one', 'formula', 'support +',
]

interface PoeRow {
  id: string
  candidate_id: string | null
  customer_need: string
  ingredient_name?: string
  top_search_term_1: string | null
  top_search_term_2: string | null
  top_search_term_3: string | null
  import_date: string
}

interface QueryJob {
  query: string
  query_type: 'customer_need' | 'top_term_1' | 'top_term_2' | 'top_term_3'
  skip_reason?: string
}

interface KeepaProduct {
  asin: string
  title: string
  brand: string
  price: number | null
  rating: number | null
  reviews: number
  sales: number
  monthly_sold: number
  bsr_current: number | null
  bsr_avg30: number | null
  bsr_avg90: number | null
  classification: 'single_ingredient' | 'stack' | 'adjacent' | 'noise'
  other_ingredient_hits: string[]
  sales_signal_source: 'keepa_monthlySold_badge' | 'keepa_bsr_only'
}

interface KeepaResult {
  products: KeepaProduct[]
  raw_count: number
  tokens_consumed: number
  refill_rate: number | null
  error?: string
}

function normalize(value: string) {
  return String(value || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9+\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function queryTokens(query: string) {
  const tokens = normalize(query).split(/\s+/)
  const hasVitamin = tokens.includes('vitamin')
  return tokens
    .map(token => token.replace(/^-+|-+$/g, ''))
    .filter(token => {
      if (QUERY_STOPWORDS.has(token)) return false
      if (token.length >= 3) return true
      return hasVitamin && /^(a|b|c|d|e|k|d3|k2)$/.test(token)
    })
}

function isNoise(row: PoeRow): boolean {
  const text = [
    row.customer_need, row.ingredient_name,
    row.top_search_term_1, row.top_search_term_2, row.top_search_term_3,
  ].filter(Boolean).join(' ').toLowerCase()
  const candidate = (row.ingredient_name || row.customer_need || '').toLowerCase().trim()
  if (GENERIC_EXACT.has(candidate)) return true
  return NOISE_PATTERNS.some(p => text.includes(p))
}

function isBrandLedQuery(query: string): boolean {
  const text = normalize(query)
  const padded = ` ${text} `
  const matchedBrands = BRAND_PATTERNS.filter(pattern => padded.includes(` ${pattern} `))
  if (matchedBrands.length === 0) return false

  const tokens = queryTokens(query)
  const brandTokens = new Set(matchedBrands.flatMap(pattern => pattern.split(/\s+/)))
  const nonBrandTokens = tokens.filter(token =>
    !brandTokens.has(token),
  )
  return nonBrandTokens.length <= 2
}

function buildQueryJobs(row: PoeRow): QueryJob[] {
  const jobs: QueryJob[] = []

  const pushJob = (query: string | null, query_type: QueryJob['query_type']) => {
    const cleaned = query?.trim()
    if (!cleaned) return
    if (queryTokens(cleaned).length === 0) {
      jobs.push({ query: cleaned, query_type, skip_reason: 'skipped_invalid_query_too_short' })
      return
    }
    if (isBrandLedQuery(cleaned)) {
      jobs.push({ query: cleaned, query_type, skip_reason: 'skipped_brand_led_query' })
      return
    }
    jobs.push({ query: cleaned, query_type })
  }

  pushJob(row.customer_need, 'customer_need')
  pushJob(row.top_search_term_1, 'top_term_1')
  pushJob(row.top_search_term_2, 'top_term_2')
  pushJob(row.top_search_term_3, 'top_term_3')
  return jobs
}

function keepaSearchTitle(query: string) {
  const text = normalize(query)
  if (/\b(supplement|supplements|capsule|capsules|powder|powders|softgel|softgels|tablet|tablets|drops|gummy|gummies)\b/.test(text)) {
    return query
  }
  if (text.startsWith('vitamin ')) return `${query} supplement`
  if (text === 'oregano oil') return 'oregano oil capsules'
  if (text === 'mushroom coffee') return 'mushroom coffee supplement'
  return query
}

function percentile(values: number[], p: number): number | null {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const idx = Math.floor((sorted.length - 1) * p)
  return sorted[idx]
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
  other_ingredient_hits: string[]
} {
  const text = ` ${normalize(title)} `
  if (PRODUCT_NOISE_PATTERNS.some(pattern => text.includes(pattern))) {
    return { classification: 'noise', other_ingredient_hits: [] }
  }

  const tokens = queryTokens(query)
  const matched = tokens.filter(token => {
    if (token.length <= 2) return text.includes(` ${token} `) || text.includes(` ${token}3 `) || text.includes(` ${token}2 `)
    return text.includes(` ${token} `) || text.includes(token)
  })
  if (tokens.length > 0 && matched.length < tokens.length) {
    return { classification: 'adjacent', other_ingredient_hits: [] }
  }

  const queryTokenSet = new Set(tokens)
  const otherIngredientHits = [...INGREDIENT_WORDS]
    .filter(token => !queryTokenSet.has(token) && (text.includes(` ${token} `) || text.includes(token)))
    .slice(0, 12)

  const hasStackMarker = STACK_MARKERS.some(marker => text.includes(marker))
  if (hasStackMarker && otherIngredientHits.length >= 1) {
    return { classification: 'stack', other_ingredient_hits: otherIngredientHits }
  }
  if (otherIngredientHits.length >= 3) {
    return { classification: 'stack', other_ingredient_hits: otherIngredientHits }
  }
  if (tokens.length === 0) {
    return { classification: 'noise', other_ingredient_hits: otherIngredientHits }
  }
  return { classification: 'single_ingredient', other_ingredient_hits: otherIngredientHits }
}

async function loadKeepaKey(sb: any): Promise<string> {
  const envKey = Deno.env.get('KEEPA_API_KEY')
  if (envKey) return envKey

  const { data, error } = await sb
    .from('system_config')
    .select('value')
    .eq('key', 'keepa_api_key')
    .maybeSingle()
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

async function keepaTokenStatus(apiKey: string) {
  return keepaGet('/token', {}, apiKey)
}

async function waitForKeepaTokens(apiKey: string, maxWaitMs: number, minTokens = 1) {
  const started = Date.now()
  while (true) {
    const status = await keepaTokenStatus(apiKey)
    if (Number(status.tokensLeft || 0) >= minTokens) return status
    const refillMs = Math.max(5_000, Number(status.refillIn || 30_000) + 1_000)
    const elapsed = Date.now() - started
    if (elapsed + refillMs > maxWaitMs) {
      throw new Error(`not_enough_keepa_tokens_retry_later tokensLeft=${status.tokensLeft} minTokens=${minTokens} refillIn=${status.refillIn}`)
    }
    await new Promise(resolve => setTimeout(resolve, refillMs))
  }
}

function normalizeKeepaProduct(query: string, raw: any): KeepaProduct | null {
  const asin = String(raw.asin || '').toUpperCase()
  if (!ASIN_RE.test(asin)) return null

  const title = String(raw.title || '').slice(0, 300).trim()
  if (!title) return null

  const stats = raw.stats || {}
  const price = priceFromCents(
    statValue(stats, 'current', 18) ||
    statValue(stats, 'current', 1) ||
    statValue(stats, 'avg30', 18) ||
    statValue(stats, 'avg30', 1),
  )
  const ratingRaw = statValue(stats, 'current', 16)
  const reviews = statValue(stats, 'current', 17) || 0
  const monthlySold = finiteNumber(raw.monthlySold) || 0
  const classified = classifyProduct(query, title)

  return {
    asin,
    title,
    brand: String(raw.brand || raw.manufacturer || '').slice(0, 120),
    price,
    rating: ratingRaw === null ? null : Math.round(ratingRaw) / 10,
    reviews,
    sales: monthlySold,
    monthly_sold: monthlySold,
    bsr_current: statValue(stats, 'current', 3),
    bsr_avg30: statValue(stats, 'avg30', 3),
    bsr_avg90: statValue(stats, 'avg90', 3),
    classification: classified.classification,
    other_ingredient_hits: classified.other_ingredient_hits,
    sales_signal_source: monthlySold > 0 ? 'keepa_monthlySold_badge' : 'keepa_bsr_only',
  }
}

async function runKeepaQuery(apiKey: string, query: string, opts: {
  keepAsins: number
  tokenWaitMs: number
}): Promise<KeepaResult> {
  const selection = {
    title: keepaSearchTitle(query),
    current_SALES_gte: 1,
    sort: ['current_SALES', 'asc'],
    page: 0,
    perPage: 50,
  }

  await waitForKeepaTokens(apiKey, opts.tokenWaitMs, opts.keepAsins + 10)
  const finder = await keepaGet('/query/', {
    domain: KEEPA_DOMAIN_US,
    selection: JSON.stringify(selection),
  }, apiKey)

  const asinList = (finder.asinList || [])
    .map((asin: string) => String(asin || '').toUpperCase())
    .filter((asin: string) => ASIN_RE.test(asin))
    .slice(0, opts.keepAsins)

  if (asinList.length === 0) {
    return {
      products: [],
      raw_count: Number(finder.totalResults || 0),
      tokens_consumed: Number(finder.tokensConsumed || 0),
      refill_rate: finiteNumber(finder.refillRate),
      error: 'no_keepa_finder_results',
    }
  }

  await waitForKeepaTokens(apiKey, opts.tokenWaitMs, opts.keepAsins)
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
    products,
    raw_count: Number(finder.totalResults || 0),
    tokens_consumed: Number(finder.tokensConsumed || 0) + Number(enriched.tokensConsumed || 0),
    refill_rate: finiteNumber(enriched.refillRate) || finiteNumber(finder.refillRate),
  }
}

function computeAggregates(products: KeepaProduct[]) {
  const nonNoise = products.filter(p => p.classification !== 'noise' && p.classification !== 'adjacent')
  const singleIngredient = nonNoise.filter(p => p.classification === 'single_ingredient')
  const scoringProducts = singleIngredient.length >= 5 ? singleIngredient : nonNoise
  const top10 = scoringProducts.slice(0, 10)
  const withMonthlySold = top10.filter(p => p.monthly_sold > 0)

  const reviews = top10.map(p => p.reviews).filter(r => r > 0)
  const ratings = top10.map(p => p.rating).filter((r): r is number => Number.isFinite(r || NaN) && (r || 0) > 0)
  const prices = top10.map(p => p.price).filter((p): p is number => Number.isFinite(p || NaN) && (p || 0) > 0)
  const brands = new Set(top10.map(p => p.brand.toLowerCase()).filter(Boolean))
  const bsrValues = top10.map(p => p.bsr_current || p.bsr_avg30 || 0).filter(r => r > 0)

  const totalBadgeSales = withMonthlySold.reduce((sum, product) => sum + product.monthly_sold, 0)
  const top3BadgeSales = withMonthlySold.slice(0, 3).reduce((sum, product) => sum + product.monthly_sold, 0)
  const salesTop3Share = totalBadgeSales > 0 ? top3BadgeSales / totalBadgeSales : null

  const quality = {
    scored_count: top10.length,
    single_ingredient_count: singleIngredient.length,
    stack_count: products.filter(p => p.classification === 'stack').length,
    adjacent_count: products.filter(p => p.classification === 'adjacent').length,
    monthly_sold_coverage: withMonthlySold.length,
    raw_result_count: products.length,
    scoring_basis: singleIngredient.length >= 5 ? 'single_ingredient' : 'non_noise',
  }

  return {
    review_p50: percentile(reviews, 0.50),
    review_p90: percentile(reviews, 0.90),
    review_max: reviews.length ? Math.max(...reviews) : null,
    rating_p50: percentile(ratings, 0.50),
    rating_p90: percentile(ratings, 0.90),
    price_p50: percentile(prices, 0.50),
    sales_top3_share: salesTop3Share,
    distinct_brands: brands.size || null,
    result_count: top10.length,
    confidence: (top10.length >= 10 && withMonthlySold.length >= 5) ? 'high' : 'low',
    monthly_sold_coverage: withMonthlySold.length,
    bsr_best: bsrValues.length ? Math.min(...bsrValues) : null,
    bsr_p50: percentile(bsrValues, 0.50),
    bsr_p90: percentile(bsrValues, 0.90),
    result_quality: quality,
  }
}

async function enrichRow(sb: any, keepaKey: string, row: PoeRow, opts: {
  skipExisting: boolean
  keepAsins: number
  tokenWaitMs: number
  queryTypes: Set<QueryJob['query_type']> | null
}) {
  const jobs = buildQueryJobs(row).filter(job => !opts.queryTypes || opts.queryTypes.has(job.query_type))
  if (jobs.length === 0) return { written: 0, errors: [`POE row ${row.id} has no usable queries`] }

  let toProcess = jobs
  if (opts.skipExisting) {
    const { data: existing } = await sb.from('poe_competitive_enrichments')
      .select('query_type, source, error')
      .eq('poe_snapshot_id', row.id)
    const existingTypes = new Set((existing || [])
      .filter((r: any) => String(r.source || '').startsWith('keepa') && !r.error)
      .map((r: any) => r.query_type))
    toProcess = jobs.filter(j => !existingTypes.has(j.query_type))
    if (toProcess.length === 0) return { written: 0, errors: [], skipped: jobs.length }
  }

  const rows: any[] = []
  const errors: string[] = []
  const keepaCache = new Map<string, KeepaResult>()

  for (const job of toProcess) {
    try {
      if (job.skip_reason) {
        rows.push({
          poe_snapshot_id: row.id,
          query: job.query,
          query_type: job.query_type,
          top_results: [],
          result_count: 0,
          confidence: 'low',
          result_quality: {
            scored_count: 0,
            single_ingredient_count: 0,
            stack_count: 0,
            adjacent_count: 0,
            monthly_sold_coverage: 0,
            raw_result_count: 0,
            scoring_basis: 'skipped',
          },
          monthly_sold_coverage: 0,
          source: 'keepa_product_finder',
          source_version: 'keepa-stage-a-v1',
          error: job.skip_reason,
        })
        continue
      }

      const queryKey = normalize(job.query)
      let keepaResult = keepaCache.get(queryKey)
      if (!keepaResult) {
        keepaResult = await runKeepaQuery(keepaKey, job.query, {
          keepAsins: opts.keepAsins,
          tokenWaitMs: opts.tokenWaitMs,
        })
        keepaCache.set(queryKey, keepaResult)
      }
      const aggregates = computeAggregates(keepaResult.products)
      rows.push({
        poe_snapshot_id: row.id,
        query: job.query,
        query_type: job.query_type,
        top_results: keepaResult.products.slice(0, 30),
        ...aggregates,
        source: 'keepa_product_finder',
        source_version: 'keepa-stage-a-v1',
        keepa_tokens_consumed: keepaResult.tokens_consumed,
        keepa_refill_rate: keepaResult.refill_rate,
        sales_signal_source: 'keepa_bsr_monthlySold_badge',
        apify_cost_usd: null,
        apify_run_id: null,
        error: keepaResult.error || (keepaResult.products.length === 0 ? 'no_results_returned' : null),
      })
    } catch (err) {
      const message = err instanceof Error ? err.message.slice(0, 500) : String(err).slice(0, 500)
      if (message.startsWith('not_enough_keepa_tokens_retry_later')) {
        errors.push(`${job.query_type}:${message}`)
        continue
      }
      rows.push({
        poe_snapshot_id: row.id,
        query: job.query,
        query_type: job.query_type,
        top_results: [],
        result_count: 0,
        confidence: 'low',
        result_quality: {
          scored_count: 0,
          single_ingredient_count: 0,
          stack_count: 0,
          adjacent_count: 0,
          monthly_sold_coverage: 0,
          raw_result_count: 0,
          scoring_basis: 'error',
        },
        monthly_sold_coverage: 0,
        source: 'keepa_product_finder',
        source_version: 'keepa-stage-a-v1',
        error: message,
      })
      errors.push(`${job.query_type}:${message}`)
    }
  }

  if (rows.length > 0) {
    const { error: upErr } = await sb.from('poe_competitive_enrichments').upsert(rows, {
      onConflict: 'poe_snapshot_id,query_type',
    })
    if (upErr) errors.push(`Upsert failed for ${row.id}: ${upErr.message}`)
  }
  return { written: rows.length, errors }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  const sb = svcClient()
  const tStart = Date.now()

  try {
    const body = await req.json().catch(() => ({}))
    const keepaKey = await loadKeepaKey(sb)

    const skipNoise = body.skip_noise !== false
    const skipExisting = body.skip_existing !== false
    const batchSize = Math.max(1, Math.min(5, Number(body.batch_size || 1)))
    const batchOffset = Math.max(0, Number(body.batch_offset || 0))
    const keepAsins = Math.max(5, Math.min(50, Number(body.keep_asins || DEFAULT_KEEP_ASINS)))
    const tokenWaitMs = Math.max(0, Math.min(130_000, Number(body.keepa_token_wait_ms || 45_000)))

    let rows: PoeRow[]

    if (Array.isArray(body.poe_snapshot_ids) && body.poe_snapshot_ids.length > 0) {
      const { data, error } = await sb
        .from('poe_snapshots')
        .select('id, candidate_id, customer_need, top_search_term_1, top_search_term_2, top_search_term_3, import_date')
        .in('id', body.poe_snapshot_ids)
      if (error) throw new Error(`Smoke fetch failed: ${error.message}`)
      rows = data || []
    } else {
      let importDate = body.import_date
      if (!importDate) {
        const { data } = await sb.from('poe_snapshots')
          .select('import_date').order('import_date', { ascending: false }).limit(1).single()
        importDate = data?.import_date
        if (!importDate) throw new Error('No POE imports found')
      }
      const { data, error } = await sb
        .from('poe_snapshots')
        .select('id, candidate_id, customer_need, top_search_term_1, top_search_term_2, top_search_term_3, import_date')
        .eq('import_date', importDate)
        .order('search_volume_90d', { ascending: false, nullsFirst: false })
        .range(batchOffset, batchOffset + batchSize - 1)
      if (error) throw new Error(`Batch fetch failed: ${error.message}`)
      rows = data || []
    }

    if (rows.length > 0) {
      const ids = [...new Set(rows.map(r => r.candidate_id).filter(Boolean))] as string[]
      if (ids.length > 0) {
        const { data: cands } = await sb.from('idea_candidates').select('id, ingredient_name').in('id', ids)
        const nameMap = new Map((cands || []).map((c: any) => [c.id, c.ingredient_name]))
        rows.forEach(r => { (r as any).ingredient_name = nameMap.get(r.candidate_id || '') || '' })
      }
    }

    const filtered = skipNoise ? rows.filter(r => !isNoise(r)) : rows
    const skippedNoise = rows.length - filtered.length

    let totalWritten = 0
    const errors: string[] = []
    const processed: string[] = []
    for (const row of filtered) {
      const result = await enrichRow(sb, keepaKey, row, {
        skipExisting,
        keepAsins,
        tokenWaitMs,
        queryTypes: Array.isArray(body.query_types) && body.query_types.length
          ? new Set(body.query_types.filter((value: string) => ['customer_need', 'top_term_1', 'top_term_2', 'top_term_3'].includes(value)))
          : null,
      })
      totalWritten += result.written
      processed.push(row.id)
      if (result.errors.length > 0) errors.push(...result.errors)

      if (Date.now() - tStart > 120_000) {
        return new Response(JSON.stringify({
          ok: true,
          partial: true,
          source: 'keepa_product_finder',
          processed: processed.length,
          written: totalWritten,
          skipped_noise: skippedNoise,
          errors,
          batch_offset: batchOffset,
          next_batch_offset: batchOffset + processed.length,
          elapsed_ms: Date.now() - tStart,
        }), { headers: { 'Content-Type': 'application/json', ...corsHeaders } })
      }
    }

    return new Response(JSON.stringify({
      ok: true,
      source: 'keepa_product_finder',
      processed: processed.length,
      processed_ids: processed,
      written: totalWritten,
      skipped_noise: skippedNoise,
      errors,
      batch_offset: batchOffset,
      next_batch_offset: batchOffset + rows.length,
      done: rows.length < batchSize,
      keep_asins: keepAsins,
      elapsed_ms: Date.now() - tStart,
    }), { headers: { 'Content-Type': 'application/json', ...corsHeaders } })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return new Response(JSON.stringify({
      ok: false,
      error: message,
      elapsed_ms: Date.now() - tStart,
    }), { status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders } })
  }
})
