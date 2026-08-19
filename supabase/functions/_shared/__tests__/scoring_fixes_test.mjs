/**
 * Node fallback runner mirroring scoring_fixes_test.ts pure assertions.
 * Run: node supabase/functions/_shared/__tests__/scoring_fixes_test.mjs
 */

const DEMAND_FRAME_CLICKS_ALT_THRESHOLD = 5000
const DEMAND_MIN_PRIMARY_CLICKS = 100
const DEMAND_MIN_ROWS_WITH_DATA = 5
const DEMAND_STRONG_PRIMARY_CLICKS = 1000
const DEMAND_STRONG_PRIMARY_MIN_ROWS = 2

function normalize(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9+\s-]/g, ' ').replace(/\s+/g, ' ').trim()
}

function phraseHit(text, term) {
  const value = normalize(term)
  if (!value || value.length < 2) return false
  if (value.includes(' ')) return text.includes(value)
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(^|\\s)${escaped}(\\s|$)`).test(text)
}

function phraseStart(text, term) {
  const value = normalize(term)
  if (!value || value.length < 2) return -1
  if (value.includes(' ')) return text.indexOf(value)
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = text.match(new RegExp(`(^|\\s)${escaped}(\\s|$)`))
  return match ? (match.index || 0) + (match[1] ? match[1].length : 0) : -1
}

function classifyHybridProduct(frame, product) {
  const text = ` ${normalize(`${product.brand || ''} ${product.title || ''}`)} `
  const titleText = ` ${normalize(product.title || '')} `
  const heroTerms = (frame.include_terms?.length ? frame.include_terms : [frame.hero_ingredient]).map(normalize).filter(t => t.length >= 2)
  const requireTerms = (frame.require_any || []).map(normalize).filter(t => t.length >= 2)
  const heroHits = heroTerms.map(term => phraseStart(text, term)).filter(i => i >= 0)
  if (!heroHits.length) return { bucket: 'excluded' }
  const titleHeroHits = heroTerms.map(term => phraseStart(titleText, term)).filter(i => i >= 0)
  const firstTitleHero = titleHeroHits.length ? Math.min(...titleHeroHits) : Math.min(...heroHits)
  const heroInLead = heroTerms.some(term => phraseHit(titleText.slice(0, 220), term))
  if (requireTerms.length > 0) {
    const coactiveLead = Math.min(...requireTerms.map(t => phraseStart(titleText, t)).filter(i => i >= 0), Infinity)
    if (Number.isFinite(coactiveLead) && coactiveLead < firstTitleHero && !heroInLead) return { bucket: 'adjacent' }
    const comboHits = requireTerms.filter(term => phraseHit(text, term))
    if (!comboHits.length) return { bucket: 'adjacent' }
  }
  return { bucket: 'included' }
}

function scoreKeywordFrameRelevance(keyword, frame) {
  const kw = normalize(keyword)
  if (!kw) return 0
  let score = 0
  const hero = normalize(frame.hero_ingredient)
  if (hero && (kw.includes(hero) || hero.split(/\s+/).every(part => part.length >= 3 && kw.includes(part)))) score += 10
  for (const term of frame.include_terms || []) if (normalize(term) && kw.includes(normalize(term))) score += 4
  for (const term of frame.require_any || []) if (normalize(term) && kw.includes(normalize(term))) score += 3
  for (const query of frame.query_packet || []) {
    const q = normalize(query)
    if (q && (kw.includes(q) || q.includes(kw))) score += 2
  }
  return score
}

function selectFrameRelevantDemandPrimary(rows, frame) {
  const withData = rows.filter(r => r.latest_clicks > 0)
  const ranked = withData.map(row => ({ row, relevance: scoreKeywordFrameRelevance(row.keyword, frame) }))
    .filter(e => e.relevance > 0)
    .sort((a, b) => b.relevance - a.relevance || b.row.latest_clicks - a.row.latest_clicks || a.row.keyword.localeCompare(b.row.keyword))
  const frameRelevantRows = ranked.map(e => e.row)
  return {
    primary: ranked[0]?.row || null,
    frameRelevantClicks: frameRelevantRows.reduce((s, r) => s + r.latest_clicks, 0),
    frameRelevantRowCount: frameRelevantRows.length,
  }
}

function evaluateDemandQualityGate(input) {
  if (input.source !== 'datarova') return { passes: false, path: 'failed' }
  if (input.primaryKeywordClicks < DEMAND_MIN_PRIMARY_CLICKS) return { passes: false, path: 'failed' }
  if (input.demandRowsWithData >= DEMAND_MIN_ROWS_WITH_DATA) return { passes: true, path: 'default' }
  if (input.primaryKeywordClicks >= DEMAND_STRONG_PRIMARY_CLICKS && input.demandRowsWithData >= DEMAND_STRONG_PRIMARY_MIN_ROWS) return { passes: true, path: 'strong_primary' }
  if (input.frameRelevantClicks >= DEMAND_FRAME_CLICKS_ALT_THRESHOLD && input.frameRelevantRowCount >= DEMAND_STRONG_PRIMARY_MIN_ROWS) return { passes: true, path: 'frame_clicks' }
  return { passes: false, path: 'failed' }
}

const tests = [
  ['glucomannan included', () => classifyHybridProduct({ hero_ingredient: 'glucomannan', include_terms: ['glucomannan'] }, { title: 'Nutricost Glucomannan 180 Capsules', brand: 'Nutricost' }).bucket === 'included'],
  ['clear protein included', () => classifyHybridProduct({ hero_ingredient: 'clear protein', include_terms: ['clear protein', 'clear whey'] }, { title: 'Clear Whey Protein Isolate Powder', brand: 'Brand' }).bucket === 'included'],
  ['frame-relevant primary', () => selectFrameRelevantDemandPrimary([
    { keyword: 'black seed oil', latest_clicks: 302 },
    { keyword: 'oil of oregano with black seed oil', latest_clicks: 133000 },
  ], { hero_ingredient: 'black seed oil', include_terms: ['black seed oil', 'thymoquinone'], require_any: ['thymoquinone', 'oregano'] }).primary.keyword === 'oil of oregano with black seed oil'],
  ['frame_clicks gate', () => {
    const g = evaluateDemandQualityGate({ source: 'datarova', demandRowsWithData: 2, primaryKeywordClicks: 500, frameRelevantClicks: 133302, frameRelevantRowCount: 2, primaryKeyword: 'oil of oregano with black seed oil' })
    return g.passes && g.path === 'frame_clicks'
  }],
]

let failed = 0
for (const [name, fn] of tests) {
  try {
    if (!fn()) throw new Error('assertion false')
    console.log(`ok - ${name}`)
  } catch (err) {
    failed += 1
    console.error(`FAIL - ${name}: ${err.message}`)
  }
}
if (failed > 0) {
  process.exit(1)
}
console.log(`\n${tests.length} passed`)
