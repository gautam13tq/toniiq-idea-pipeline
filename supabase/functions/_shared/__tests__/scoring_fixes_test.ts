/**
 * Pure-function tests for Phase B scoring fixes.
 * Run: deno test supabase/functions/_shared/__tests__/scoring_fixes_test.ts --allow-read
 * Node fallback: node supabase/functions/_shared/__tests__/scoring_fixes_test.mjs
 */

import {
  classifyHybridProduct,
  selectFrameRelevantDemandPrimary,
  evaluateDemandQualityGate,
  selectKeepaEnrichmentTargets,
  type HybridFrame,
  type HybridProduct,
  DEMAND_FRAME_CLICKS_ALT_THRESHOLD,
} from '../hybrid_scoring.ts'

function product(title: string, asin = 'B000000001'): HybridProduct {
  return {
    asin,
    parent_asin: null,
    product_key: asin,
    duplicate_asins: [asin],
    variant_count: 1,
    discovery_rank: 1,
    title,
    brand: 'Nutricost',
    price: 19.99,
    rating: 4.5,
    reviews: 1200,
    monthly_sold: 500,
    bsr_current: 5000,
    bsr_avg30: 5200,
    bsr_avg90: 5400,
    classification: 'adjacent',
    missing_query_tokens: [],
    other_ingredient_hits: [],
  }
}

const glucomannanFrame: HybridFrame = {
  frame: 'broad_hero',
  hero_ingredient: 'glucomannan',
  query_packet: ['glucomannan supplement', 'glucomannan capsules'],
  include_terms: ['glucomannan'],
  exclude_terms: ['pet', 'dog', 'cat'],
}

const clearProteinFrame: HybridFrame = {
  frame: 'broad_hero',
  hero_ingredient: 'clear protein',
  query_packet: ['clear protein powder', 'clear whey protein'],
  include_terms: ['clear protein', 'clear whey'],
}

const thymoquinoneFrame: HybridFrame = {
  frame: 'broad_hero',
  hero_ingredient: 'black seed oil',
  query_packet: ['black seed oil supplement', 'thymoquinone black seed oil'],
  include_terms: ['black seed oil', 'thymoquinone'],
  require_any: ['thymoquinone', 'oregano'],
}

Deno.test('glucomannan single-ingredient title is included (not adjacent)', () => {
  const result = classifyHybridProduct(glucomannanFrame, product('Nutricost Glucomannan 180 Capsules 6650mg per Serving'))
  if (result.bucket !== 'included') {
    throw new Error(`expected included, got ${result.bucket}: ${result.reason}`)
  }
})

Deno.test('glucomannan title with vitamin cofactor is included when hero leads', () => {
  const result = classifyHybridProduct(
    glucomannanFrame,
    product('Glucomannan Capsules with Vitamin B6 Fiber Supplement'),
  )
  if (result.bucket !== 'included') {
    throw new Error(`expected included despite vitamin cofactor, got ${result.bucket}: ${result.reason}`)
  }
})

Deno.test('clear protein isolate title is included', () => {
  const result = classifyHybridProduct(clearProteinFrame, product('Clear Whey Protein Isolate Powder Unflavored'))
  if (result.bucket !== 'included') {
    throw new Error(`expected included, got ${result.bucket}: ${result.reason}`)
  }
})

Deno.test('combo lane demotes bare single-ingredient hero without co-active', () => {
  const result = classifyHybridProduct(thymoquinoneFrame, product('Organic Black Seed Oil Cold Pressed 16oz'))
  if (result.bucket !== 'adjacent') {
    throw new Error(`expected adjacent for combo lane parent market, got ${result.bucket}`)
  }
})

Deno.test('combo lane includes product carrying co-active signal', () => {
  const result = classifyHybridProduct(
    thymoquinoneFrame,
    product('Oil of Oregano with Black Seed Oil and Thymoquinone Softgels'),
  )
  if (result.bucket !== 'included') {
    throw new Error(`expected included combo competitor, got ${result.bucket}: ${result.reason}`)
  }
})

Deno.test('selectKeepaEnrichmentTargets prioritizes included ASINs', () => {
  const classified = [
    { ...product('Adjacent Only', 'B000000002'), bucket: 'adjacent' as const, discovery_rank: 1 },
    { ...product('Included Hero', 'B000000003'), bucket: 'included' as const, discovery_rank: 99 },
  ]
  const targets = selectKeepaEnrichmentTargets(classified, 1)
  if (targets.length !== 1 || targets[0].asin !== 'B000000003') {
    throw new Error(`expected included ASIN first, got ${targets.map(t => t.asin).join(',')}`)
  }
})

Deno.test('demand primary prefers frame-relevant keyword over raw max clicks', () => {
  const rows = [
    { keyword: 'black seed oil', latest_clicks: 302 },
    { keyword: 'oil of oregano with black seed oil', latest_clicks: 133_000 },
    { keyword: 'random unrelated term', latest_clicks: 999_999 },
  ]
  const selection = selectFrameRelevantDemandPrimary(rows, thymoquinoneFrame)
  if (selection.primary?.keyword !== 'oil of oregano with black seed oil') {
    throw new Error(`expected frame-relevant combo keyword, got ${selection.primary?.keyword}`)
  }
  if (selection.frameRelevantClicks < DEMAND_FRAME_CLICKS_ALT_THRESHOLD) {
    throw new Error(`expected frame aggregate ≥ ${DEMAND_FRAME_CLICKS_ALT_THRESHOLD}, got ${selection.frameRelevantClicks}`)
  }
})

Deno.test('demand gate frame_clicks path passes combo lane with sparse rows', () => {
  const gate = evaluateDemandQualityGate({
    source: 'datarova',
    demandRowsWithData: 2,
    primaryKeywordClicks: 500,
    frameRelevantClicks: 133_302,
    frameRelevantRowCount: 2,
    primaryKeyword: 'oil of oregano with black seed oil',
  })
  if (!gate.passes || gate.path !== 'frame_clicks') {
    throw new Error(`expected frame_clicks pass, got passes=${gate.passes} path=${gate.path}`)
  }
})

Deno.test('demand gate still fails thin primary below 100 clicks', () => {
  const gate = evaluateDemandQualityGate({
    source: 'datarova',
    demandRowsWithData: 10,
    primaryKeywordClicks: 50,
    frameRelevantClicks: 50_000,
    frameRelevantRowCount: 5,
    primaryKeyword: 'thin term',
  })
  if (gate.passes) {
    throw new Error('expected demand gate failure for primary < 100 clicks')
  }
})
