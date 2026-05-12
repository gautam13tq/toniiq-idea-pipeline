const ROOT_TERMS = [
  'magnesium', 'creatine', 'collagen', 'fiber', 'protein', 'multivitamin',
  'vitamin d', 'vitamin c', 'omega', 'fish oil', 'probiotic', 'prebiotic',
  'ashwagandha', 'turmeric', 'berberine', 'melatonin', 'electrolyte',
  'greens', 'beet root', 'sea moss', 'nmn', 'nad', 'coq10', 'iron',
  'zinc', 'calcium', 'mushroom', 'hair growth', 'weight loss',
]

const WEDGE_TERMS = [
  'for men', 'for women', 'women', 'men', 'kids', 'sleep', 'powder',
  'capsules', 'capsule', 'gummies', 'gummy', 'liposomal', 'phytosome',
  'creapure', 'hmb', 'sac', 'aged garlic', 'urolithin', 'ergothioneine',
  'akkermansia', 'postbiotic', 'butyrate', 'tributyrin', 'spermidine',
  'saffron', 'apigenin', 'taurine', 'shilajit', 'methylene blue',
  'bromelain', 'serrapeptase', 'nattokinase', 'phgg', 'sunfiber',
  'lactoferrin', 'colostrum', 'astaxanthin', 'quercetin', 'sulforaphane',
  'glp', 'glp-1', 'cortisol', 'blood sugar', 'methylated', 'mitochondria',
  'mitochondrial', 'longevity', 'senolytic', 'prenatal', 'radiation',
  'iodide', 'diosmin', 'pycnogenol', 'glutathione', 'black seed',
  'oregano', 'cacao', 'flavanols', 'wound healing',
]

const BRANDED_ACTIVE_TERMS = [
  'creapure', 'sunfiber', 'pycnogenol', 'aged garlic', 'sac',
  'astaxanthin', 'sulforaphane', 'quercetin', 'apigenin', 'nattokinase',
  'bromelain', 'liposomal', 'phgg', 'glutathione', 'hmb',
]

const BRAND_TERMS = [
  'ryze', 'mary ruth', 'thorne', 'force factor', 'colon broom', 'happy liver',
  'happy v', 'lemme', 'leefar', 'ella ola', 'sports research', 'organic india',
  'nature made', 'naturewise', 'pure encapsulations', 'vital proteins',
  'olly', 'nutricost', 'codeage', 'ancient nutrition', 'gaia',
  'garden of life', "nature's bounty",
]

const PRIORITY_ORDER = { urgent: 0, high: 1, medium: 2, low: 3 }

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function normalizeIdeaName(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\b(supplements?|capsules?|powders?|gumm(y|ies)|tablets?|softgels?|liquid|organic|pure|natural|for women|for men|for kids)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function marketText(snapshot = {}) {
  return [
    snapshot.customer_need,
    snapshot.top_search_term_1,
    snapshot.top_search_term_2,
    snapshot.top_search_term_3,
  ].filter(Boolean).join(' ').toLowerCase()
}

export function hasPhrase(text, phrase) {
  return new RegExp(`(^|[^a-z0-9])${escapeRegex(phrase.toLowerCase())}([^a-z0-9]|$)`).test(text)
}

export function getMarketSignals(snapshot = {}) {
  const text = marketText(snapshot)
  const rootHits = ROOT_TERMS.filter(term => hasPhrase(text, term))
  const wedgeHits = WEDGE_TERMS.filter(term => hasPhrase(text, term))
  const brandHits = BRAND_TERMS.filter(term => hasPhrase(text, term))
  const activeHits = BRANDED_ACTIVE_TERMS.filter(term => hasPhrase(text, term))
  const g90 = Number(snapshot.search_volume_growth_90d ?? 0)
  const g180 = Number(snapshot.search_volume_growth_180d ?? 0)
  const vol90 = Number(snapshot.search_volume_90d ?? 0)

  let signalType = 'market row'
  if (activeHits.length) signalType = activeHits.some(hit => ['creapure', 'sunfiber', 'pycnogenol'].includes(hit)) ? 'branded ingredient' : 'active-standard wedge'
  else if (rootHits.length && wedgeHits.length) signalType = 'root-category wedge'
  else if (g90 >= 0.2 || g180 >= 0.5) signalType = 'breakout trend'
  else if (rootHits.length && vol90 > 1_000_000) signalType = 'root category'
  else if (wedgeHits.length) signalType = 'niche wedge'

  return {
    rootHits,
    wedgeHits,
    brandHits,
    activeHits,
    signalType,
    isRootNoise: rootHits.length > 0 && wedgeHits.length === 0 && vol90 > 1_000_000,
    isBrandLike: brandHits.length > 0,
  }
}

export function scoreOpportunity(snapshot = {}) {
  const { wedgeHits, brandHits, isRootNoise } = getMarketSignals(snapshot)
  const vol90 = Number(snapshot.search_volume_90d ?? 0)
  const g90 = Number(snapshot.search_volume_growth_90d ?? -99)
  const g180 = Number(snapshot.search_volume_growth_180d ?? -99)
  const price = Number(snapshot.avg_price_usd ?? 0)

  const nicheScore = vol90 < 75_000 ? 1 : vol90 < 250_000 ? 0.85 : vol90 < 1_000_000 ? 0.6 : 0.3
  const growth = Math.max(g90, g180)
  const growthScore = growth === -99 ? 0 : Math.max(0, Math.min(1, (growth + 0.05) / 0.65))
  const priceScore = Math.max(0, Math.min(1, (price - 18) / 22))
  const wedgeScore = Math.min(1, wedgeHits.length / 2)
  const brandPenalty = brandHits.length && wedgeHits.length === 0 ? 0.12 : 0
  const rootPenalty = isRootNoise ? 0.25 : 0
  const score = 100 * (0.35 * growthScore + 0.25 * nicheScore + 0.2 * priceScore + 0.2 * wedgeScore - brandPenalty - rootPenalty)

  return Math.max(0, Math.min(100, Math.round(score)))
}

export function priorityForScore(score) {
  if (score >= 82) return 'urgent'
  if (score >= 70) return 'high'
  if (score >= 55) return 'medium'
  return 'low'
}

export function confidenceForScore(score) {
  if (score >= 78) return 'high'
  if (score >= 58) return 'medium'
  return 'low'
}

export function sortByPriorityThenScore(a, b) {
  const pa = PRIORITY_ORDER[a.priority] ?? 9
  const pb = PRIORITY_ORDER[b.priority] ?? 9
  if (pa !== pb) return pa - pb
  return (b.toniiq_fit_score || b.score || 0) - (a.toniiq_fit_score || a.score || 0)
}

export function formatNumber(value) {
  const n = Number(value || 0)
  if (!n) return '-'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`
  return n.toLocaleString()
}

export function formatGrowth(value) {
  if (value === null || value === undefined) return '-'
  const pct = Number(value) * 100
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(Math.abs(pct) >= 100 ? 0 : 1)}%`
}

export function formatUsd(value) {
  if (value === null || value === undefined) return '-'
  return `$${Number(value).toFixed(2)}`
}

export function buildReviewDraft(snapshot, candidate) {
  const score = scoreOpportunity(snapshot)
  const signals = getMarketSignals(snapshot)
  const tags = [...new Set([...signals.activeHits, ...signals.wedgeHits])].slice(0, 8)
  const importDate = snapshot.import_date || 'latest POE import'
  const growth = [formatGrowth(snapshot.search_volume_growth_90d), formatGrowth(snapshot.search_volume_growth_180d)].join(' / ')
  const context = `POE ${importDate}: ${formatNumber(snapshot.search_volume_90d)} 90d searches, growth ${growth}, avg price ${formatUsd(snapshot.avg_price_usd)}, top terms: ${[snapshot.top_search_term_1, snapshot.top_search_term_2, snapshot.top_search_term_3].filter(Boolean).join(', ')}.`

  return {
    candidate_id: candidate?.id || snapshot.candidate_id,
    source: 'poe',
    status: 'new',
    priority: priorityForScore(score),
    signal_type: signals.signalType,
    signal_tags: tags,
    toniiq_fit_score: score,
    confidence: confidenceForScore(score),
    source_context: context,
    rationale: `${snapshot.customer_need} looks like a ${signals.signalType}. The useful question is whether Toniiq can turn the market signal into a premium active-ingredient, branded-ingredient, or formulation wedge rather than chasing a generic root category.`,
    next_action: 'Review the opportunity brief and decide whether to run Phase A research.',
  }
}

export function buildOpportunityPrompt({ candidate, snapshot, review }) {
  return [
    `Review this Toniiq product opportunity: ${candidate?.ingredient_name || snapshot?.customer_need || 'Untitled idea'}.`,
    '',
    'Start ritual:',
    '1. Read CLAUDE.md in Product Development.',
    '2. Treat POE/Datarova/Amazon numbers as Tier 1 source-backed data. Do not invent missing market numbers.',
    '3. Use the app/Supabase context first, then local files only if this moves into development.',
    '',
    `Current review status: ${review?.status || 'suggested from Market Atlas'}`,
    `Priority: ${review?.priority || priorityForScore(scoreOpportunity(snapshot))}`,
    `Toniiq fit score: ${review?.toniiq_fit_score ?? scoreOpportunity(snapshot)}/100`,
    `Signal type: ${review?.signal_type || getMarketSignals(snapshot).signalType}`,
    `Signal tags: ${(review?.signal_tags || getMarketSignals(snapshot).wedgeHits || []).join(', ') || 'none'}`,
    '',
    'POE context:',
    `- Customer need: ${snapshot?.customer_need || candidate?.ingredient_name || 'n/a'}`,
    `- Top terms: ${[snapshot?.top_search_term_1, snapshot?.top_search_term_2, snapshot?.top_search_term_3].filter(Boolean).join(', ') || 'n/a'}`,
    `- 90d search volume: ${formatNumber(snapshot?.search_volume_90d)}`,
    `- 90d growth: ${formatGrowth(snapshot?.search_volume_growth_90d)}`,
    `- 180d growth: ${formatGrowth(snapshot?.search_volume_growth_180d)}`,
    `- Avg price: ${formatUsd(snapshot?.avg_price_usd)}`,
    `- POE import date: ${snapshot?.import_date || 'n/a'}`,
    '',
    'Strategic question:',
    review?.next_action || 'Is there a real Toniiq wedge here, or is this just noisy market movement?',
    '',
    'Output wanted:',
    '- Clear go / watch / reject recommendation',
    '- The Toniiq product thesis if there is one',
    '- The exact next research action',
    '- Any missing evidence marked as pending',
  ].join('\n')
}
