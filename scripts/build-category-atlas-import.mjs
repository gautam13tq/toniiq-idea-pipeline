import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const APP_ROOT = path.resolve(__dirname, '..')
const PRODUCT_DEV_ROOT = process.env.PRODUCT_DEV_ROOT
  || '/Users/gautam/Library/Mobile Documents/iCloud~md~obsidian/Documents/Documents/Toniiq/Product Development'

const QUERY_DATE = '2026-05-16'
const IMPORT_KEY = 'category-atlas-core-four-v2-2026-05-16'
const SOURCE_VERSION = 'category-atlas-core-four-v2-niche-specific'
const SCORING_VERSION = 'category-atlas-v5-hybrid-competitive'
const IMPORT_ID = uuidFromString(IMPORT_KEY)

const CATEGORY_CONFIG = [
  {
    id: 'liposomal',
    label: 'Liposomal',
    description: 'Enhanced delivery and bioavailability opportunities.',
    sort_order: 10,
    folder: 'Category Breakdowns/Liposomal Category Breakdown',
    dataFile: 'liposomal_ingredient_universe_v3_data.json',
  },
  {
    id: 'probiotics',
    label: 'Probiotics',
    description: 'Specialized probiotic strains, use cases, and next-gen microbiome opportunities.',
    sort_order: 20,
    folder: 'Category Breakdowns/Specialized Probiotics Category Breakdown',
    dataFile: 'specialized_probiotics_universe_data.json',
  },
  {
    id: 'longevity',
    label: 'Longevity',
    description: 'Market-native longevity ingredients and mechanism lanes.',
    sort_order: 30,
    folder: 'Category Breakdowns/Longevity Ingredients Category Breakdown',
    dataFile: 'longevity_ingredients_universe_data.json',
  },
  {
    id: 'botanical_extracts',
    label: 'Botanical Extracts',
    description: 'Marker-led botanical extract and standardization opportunities.',
    sort_order: 40,
    folder: 'Category Breakdowns/Botanical Extracts Category Breakdown',
    dataFile: 'botanical_extracts_universe_data.json',
  },
]

function readJson(category) {
  const fullPath = path.join(PRODUCT_DEV_ROOT, category.folder, category.dataFile)
  return JSON.parse(fs.readFileSync(fullPath, 'utf8'))
}

function uuidFromString(value) {
  const hash = crypto.createHash('md5').update(value).digest('hex')
  return [
    hash.slice(0, 8),
    hash.slice(8, 12),
    `5${hash.slice(13, 16)}`,
    ((parseInt(hash.slice(16, 18), 16) & 0x3f) | 0x80).toString(16).padStart(2, '0') + hash.slice(18, 20),
    hash.slice(20, 32),
  ].join('-')
}

function slugify(value) {
  return String(value || 'untitled')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120) || 'untitled'
}

function normalizeName(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function num(value) {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function firstNonEmpty(...values) {
  for (const value of values) {
    if (value !== null && value !== undefined && value !== '') return value
  }
  return null
}

function riskFromText(...parts) {
  const text = parts.filter(Boolean).join(' ').toLowerCase()
  if (/(avoid|exclude|red|high risk|compliance.*high|pharma|regulatory block|auto-kill)/.test(text)) return 'high'
  if (/(watch|amber|medium|hype|claim|compliance|pending|gated|risk)/.test(text)) return 'medium'
  return 'low'
}

function primaryKeywordFor(entry) {
  const existing = String(entry.primary_keyword || '').trim()
  if (existing) return existing
  const best = String(entry.best_keyword || '').trim()
  const name = String(entry.name || '').trim()
  const category = String(entry.category_id || '')
  const lowerBest = best.toLowerCase()
  if (category === 'liposomal') {
    if (lowerBest.includes('liposomal')) return best
    return `liposomal ${name}`.trim()
  }
  if (best) return best
  return name
}

function markPendingV4(entry) {
  return markPending(entry)
}

function formatMetric(value) {
  if (value === null || value === undefined || value === '') return '0'
  return Number(value).toLocaleString('en-US')
}

function actionFromTier(tier, fallback = '') {
  const text = String(tier || '').toLowerCase()
  if (text.includes('tier 1a') || text.includes('attack') || text.includes('winner')) return 'Add to Opportunities for Phase A or Phase-B-lite review.'
  if (text.includes('tier 1')) return 'Review in Opportunities and decide whether to run Phase A.'
  if (text.includes('tier 2')) return 'Watch or queue only if the strategic wedge is compelling.'
  if (text.includes('watch')) return 'Keep on watchlist until missing evidence is resolved.'
  if (text.includes('avoid') || text.includes('exclude')) return 'Do not promote without a new strategic reason.'
  return fallback || 'Review and decide whether this belongs in Opportunities.'
}

const COMMON_COMPETITIVE_EXCLUDE = [
  'kids', 'children', 'child', 'toddler', 'pet', 'dog', 'cat',
  'cream', 'soap', 'serum', 'skin care', 'skincare', 'topical',
  'spice', 'seasoning', 'culinary', 'grocery',
]

const STACK_TERMS_BY_FAMILY = {
  berberine: ['cinnamon', 'chromium', 'bitter melon', 'milk thistle', 'citrus bergamot', 'banaba', 'apple cider'],
  quercetin: ['bromelain', 'vitamin c', 'zinc', 'nettle', 'resveratrol'],
  curcumin: ['turmeric', 'ginger', 'boswellia', 'black pepper', 'bioperine'],
  magnesium: ['glycinate', 'citrate', 'malate', 'taurate', 'threonate'],
  iron: ['vitamin c', 'b12', 'folate'],
  coq10: ['ubiquinol', 'pqq', 'resveratrol'],
  saffron: ['ashwagandha', 'rhodiola', 'magnesium', 'theanine', 'gaba'],
  glutathione: ['nac', 'milk thistle', 'vitamin c', 'alpha lipoic', 'selenium'],
}

function cleanFamily(value) {
  return String(value || '')
    .replace(/\s*\([^)]*\)\s*/g, ' ')
    .replace(/\s+\/\s+/g, ' / ')
    .replace(/\s+/g, ' ')
    .trim()
}

function primaryFamilyToken(value) {
  const text = normalizeName(value)
  if (text.includes('berberine')) return 'berberine'
  if (text.includes('quercetin')) return 'quercetin'
  if (text.includes('curcumin') || text.includes('turmeric')) return 'curcumin'
  if (text.includes('magnesium')) return 'magnesium'
  if (text.includes('iron')) return 'iron'
  if (text.includes('coq10') || text.includes('ubiquinol')) return 'coq10'
  if (text.includes('saffron')) return 'saffron'
  if (text.includes('glutathione')) return 'glutathione'
  return text.split(' ')[0] || 'ingredient'
}

function displayBaseName(value) {
  const family = cleanFamily(value)
  if (/berberine/i.test(family)) return 'Berberine'
  if (/quercetin/i.test(family)) return 'Quercetin'
  if (/curcumin|turmeric/i.test(family)) return 'Curcumin'
  if (/milk thistle|silymarin|silibin/i.test(family)) return 'Milk Thistle'
  if (/green tea|egcg/i.test(family)) return 'Green Tea'
  if (/coq10|ubiquinol/i.test(family)) return 'CoQ10 / Ubiquinol'
  if (/fisetin/i.test(family)) return 'Fisetin'
  if (/apigenin/i.test(family)) return 'Apigenin'
  if (/\bnmn\b/i.test(family)) return 'NMN'
  if (/urolithin/i.test(family)) return 'Urolithin A'
  if (/alpha lipoic/i.test(family)) return 'Alpha Lipoic Acid'
  if (/\bnad\+?\b/i.test(family)) return 'NAD'
  return family.split(' / ')[0]
}

function keywordGroup(keyword, familyName = '') {
  const key = normalizeName(keyword)
  const family = primaryFamilyToken(`${familyName} ${keyword}`)
  if (/\b(dihydroberberine|dihydro berberine|glucovantage)\b/.test(key)) {
    return {
      key: 'dihydroberberine-glucovantage',
      name: 'Dihydroberberine / GlucoVantage',
      type: 'ingredient_form',
      requireAny: ['dihydroberberine', 'dihydro berberine', 'glucovantage'],
      include: ['berberine', 'dihydroberberine', 'dihydro berberine', 'glucovantage'],
    }
  }
  if (/\b(berbevis|phytosome|phospholipid)\b/.test(key)) {
    const base = displayBaseName(familyName || keyword)
    const special = family === 'berberine' ? 'Berberine Phytosome / Berbevis'
      : family === 'quercetin' ? 'Quercetin Phytosome / Quercefit'
        : family === 'curcumin' ? 'Curcumin Phytosome / Meriva'
          : /milk thistle|silybin|silymarin|siliphos/i.test(`${familyName} ${keyword}`) ? 'Milk Thistle Phytosome / Siliphos'
            : `${base} Phytosome`
    return {
      key: `${slugify(base)}-phytosome`,
      name: special,
      type: 'delivery_technology',
      requireAny: ['phytosome', 'phospholipid', 'berbevis', 'quercefit', 'meriva', 'siliphos', 'greenselect'],
      include: [family, base.toLowerCase()],
    }
  }
  if (/\b(sucrosomial|sideral)\b/.test(key)) {
    const base = displayBaseName(familyName || keyword)
    return {
      key: `${slugify(base)}-sucrosomial`,
      name: `Sucrosomial ${base}`,
      type: 'delivery_technology',
      requireAny: ['sucrosomial', 'sideral'],
      include: [family, base.toLowerCase()],
    }
  }
  if (/\b(liposomal|liposome|lipoavail)\b/.test(key)) {
    const base = displayBaseName(familyName || keyword)
    return {
      key: `liposomal-${slugify(base)}`,
      name: `Liposomal ${base}`,
      type: 'delivery_technology',
      requireAny: ['liposomal', 'liposome', 'lipoavail'],
      include: [family, base.toLowerCase()],
    }
  }
  if (/\b(micellar)\b/.test(key)) {
    const base = displayBaseName(familyName || keyword)
    return {
      key: `micellar-${slugify(base)}`,
      name: `Micellar ${base}`,
      type: 'delivery_technology',
      requireAny: ['micellar'],
      include: [family, base.toLowerCase()],
    }
  }
  if (/\b(nacet|nac ethyl ester)\b/.test(key)) {
    return {
      key: 'nac-ethyl-ester',
      name: 'NACET / NAC Ethyl Ester',
      type: 'ingredient_form',
      requireAny: ['nacet', 'nac ethyl ester'],
      include: ['nac', 'nacet', 'cysteine'],
    }
  }
  return null
}

function weightedConversion(rows) {
  const clicks = rows.reduce((sum, row) => sum + (num(row.clicks ?? row.latest_clicks) || 0), 0)
  const sales = rows.reduce((sum, row) => sum + (num(row.sales ?? row.latest_sales) || 0), 0)
  return clicks > 0 ? Number(((sales / clicks) * 100).toFixed(1)) : null
}

function scoredStatusForRole(role) {
  return role === 'scored_niche' ? 'pending_hybrid' : 'not_scored'
}

function competitiveFrameFor(entry, group) {
  const family = primaryFamilyToken(entry.parent_family || entry.name)
  const include = [...new Set([...(group.include || []), family].filter(Boolean))]
  return {
    include,
    require_any: group.requireAny || [],
    exclude: COMMON_COMPETITIVE_EXCLUDE,
    stack_terms: STACK_TERMS_BY_FAMILY[family] || [],
    hero_rule: 'include hero-ingredient complexes; keep broad condition stacks adjacent',
    sibling_markets: siblingMarketsFor(group.key),
  }
}

function defaultCompetitiveFrameFor(entry, primaryKeyword) {
  const family = primaryFamilyToken(`${entry.parent_family || ''} ${entry.name} ${primaryKeyword}`)
  const keywordTokens = normalizeName(primaryKeyword)
    .split(/\s+/)
    .filter(token => token.length >= 4 && !['extract', 'supplement', 'capsule', 'capsules', 'powder'].includes(token))
  return {
    include: [...new Set([family, ...keywordTokens].filter(Boolean))],
    require_any: [],
    exclude: COMMON_COMPETITIVE_EXCLUDE,
    stack_terms: STACK_TERMS_BY_FAMILY[family] || [],
    hero_rule: 'include hero-ingredient complexes; keep broad condition stacks adjacent',
    sibling_markets: [],
  }
}

function siblingMarketsFor(groupKey) {
  if (/berberine/.test(groupKey)) return ['liposomal berberine', 'dihydroberberine', 'berberine phytosome', 'regular berberine']
  if (/quercetin/.test(groupKey)) return ['liposomal quercetin', 'quercetin phytosome', 'regular quercetin']
  if (/curcumin/.test(groupKey)) return ['liposomal curcumin', 'curcumin phytosome', 'regular turmeric/curcumin']
  return []
}

function queryPacketFor(primaryKeyword, rows = []) {
  const extras = rows
    .map(row => String(row.keyword || '').trim())
    .filter(Boolean)
  const packet = [
    primaryKeyword,
    `${primaryKeyword} supplement`,
    ...extras,
  ]
  return [...new Set(packet.filter(Boolean))].slice(0, 5)
}

function markPending(entry) {
  const primaryKeyword = primaryKeywordFor(entry)
  const role = entry.atlas_role || 'scored_niche'
  const scoreStatus = scoredStatusForRole(role)
  const isScoredNiche = role === 'scored_niche'
  return {
    ...entry,
    parent_family: entry.parent_family || entry.name,
    atlas_role: role,
    niche_type: entry.niche_type || (isScoredNiche ? 'market_niche' : 'family_context'),
    source_entry_key: entry.source_entry_key || entry.entry_key,
    source_categories: entry.source_categories || [entry.category_id],
    query_packet: entry.query_packet || queryPacketFor(primaryKeyword),
    competitive_frame: entry.competitive_frame || defaultCompetitiveFrameFor(entry, primaryKeyword),
    scoring_method: isScoredNiche ? SCORING_VERSION : 'not_scored_parent_family',
    primary_keyword: primaryKeyword,
    score_status: scoreStatus,
    strategic_score: null,
    recommendation_label: null,
    score_confidence: null,
    pillar_scores: {},
    computed_signals: {
      scoring_version: SCORING_VERSION,
      score_status: scoreStatus,
      atlas_role: role,
      primary_keyword: primaryKeyword,
      source_category_score: entry.source_payload?.strategic_score ?? null,
      source_tier: entry.tier || null,
    },
    scoring_notes: isScoredNiche
      ? `Pending ${SCORING_VERSION}. This row is not scored until hybrid Apify discovery + Keepa ASIN enrichment runs on the exact niche: ${primaryKeyword}.`
      : 'Parent-family context row only. This row is not scored or promoted; score the child launch/search niches instead.',
  }
}

function normalizeLiposomal(data) {
  const entries = data.rows.map(row => {
    const risk = riskFromText(row.tier, row.science, row.bio_issue, row.tier_logic)
    return markPendingV4({
      category_id: 'liposomal',
      entry_key: slugify(row.ingredient),
      name: row.ingredient,
      normalized_name: normalizeName(row.ingredient),
      tier: row.tier,
      mechanism_lane: row.family,
      route_or_format: 'Liposomal / enhanced delivery',
      latest_clicks: num(row.direct_clicks) || 0,
      latest_sales: num(row.direct_sales) || 0,
      weighted_conversion_pct: num(row.best_direct_cvr),
      best_keyword: row.best_direct_keyword || null,
      best_keyword_clicks: num(row.best_direct_clicks),
      best_keyword_sales: num(row.best_direct_sales),
      best_keyword_cvr: num(row.best_direct_cvr),
      best_keyword_growth: num(row.best_direct_growth),
      toniiq_status: row.toniiq || null,
      supplier_status: row.supplier_count ? `${row.supplier_count} supplier quote/source matches` : 'No supplier match in source atlas',
      risk_level: risk,
      risk_notes: [row.science, row.bio_issue].filter(Boolean).join(' '),
      strategic_read: row.tier_logic || row.bio_issue || null,
      next_action: actionFromTier(row.tier),
      supplier_count: num(row.supplier_count) || 0,
      source_payload: row,
    })
  })

  const evidence = (data.raw_terms || []).map(row => ({
    category_id: 'liposomal',
    entry_key: slugify(row.ingredient),
    keyword: row.keyword,
    term_type: row.term_type,
    latest_month: data.latest_month || null,
    clicks: num(row.clicks) || 0,
    sales: num(row.sales) || 0,
    conversion_rate_pct: num(row.conversion_rate),
    growth_pct: num(row.growth_since_2025_10_pct),
    has_data: Boolean(row.has_data),
    source_payload: row,
  }))
  return { entries, evidence }
}

function normalizeProbiotics(data) {
  const entries = data.opportunities.map(row => {
    const risk = riskFromText(row.tier, row.interpretation, row.toniiq_status)
    return markPendingV4({
      category_id: 'probiotics',
      entry_key: slugify(row.name),
      name: row.name,
      normalized_name: normalizeName(row.name),
      tier: row.tier,
      mechanism_lane: row.type,
      route_or_format: 'Capsules / powders / probiotic formats',
      latest_clicks: num(row.latest_clicks) || 0,
      latest_sales: num(row.latest_sales) || 0,
      weighted_conversion_pct: num(row.weighted_conversion_pct),
      best_keyword: row.best_keyword || null,
      best_keyword_clicks: num(row.best_keyword_clicks),
      best_keyword_sales: num(row.best_keyword_sales),
      best_keyword_cvr: num(row.best_keyword_cvr),
      best_keyword_growth: num(row.best_keyword_growth),
      toniiq_status: row.toniiq_status || null,
      supplier_status: row.supplier_match_count ? `${row.supplier_match_count} supplier matches` : 'No supplier match in source atlas',
      risk_level: risk,
      risk_notes: row.interpretation || null,
      strategic_read: row.interpretation || null,
      next_action: actionFromTier(row.tier),
      supplier_match_count: num(row.supplier_match_count) || 0,
      product_match_count: num(row.product_match_count) || 0,
      source_payload: row,
    })
  })

  const evidence = (data.evidence_rows || []).map(row => ({
    category_id: 'probiotics',
    entry_key: slugify(row.opportunity),
    keyword: row.keyword,
    term_type: firstNonEmpty(row.term_type_label, row.term_type),
    latest_month: data.metadata?.latest_month || null,
    clicks: num(row.latest_clicks) || 0,
    sales: num(row.latest_sales) || 0,
    conversion_rate_pct: num(row.conversion_rate_pct),
    growth_pct: num(row.growth_since_2025_10_pct),
    has_data: Boolean(row.has_data),
    source_payload: row,
  }))
  return { entries, evidence }
}

function normalizeLongevity(data) {
  const entries = data.matrix.map(row => {
    const risk = riskFromText(row.tier, row.hype_risk, row.compliance_risk, row.boundary_read, row.strategic_read)
    return markPendingV4({
      category_id: 'longevity',
      entry_key: slugify(row.name),
      name: row.name,
      normalized_name: normalizeName(row.name),
      tier: row.tier,
      mechanism_lane: row.mechanism_lane,
      route_or_format: row.longevity_identity,
      latest_clicks: num(row.latest_clicks) || 0,
      latest_sales: num(row.latest_sales) || 0,
      weighted_conversion_pct: num(row.weighted_conversion_pct),
      best_keyword: row.best_keyword || null,
      best_keyword_clicks: num(row.best_keyword_clicks),
      best_keyword_sales: num(row.best_keyword_sales),
      best_keyword_cvr: num(row.best_keyword_cvr),
      best_keyword_growth: num(row.best_keyword_growth),
      toniiq_status: row.toniiq_read || null,
      supplier_status: supplierRead(row),
      risk_level: risk,
      risk_notes: `Hype risk: ${row.hype_risk || 'unknown'}; compliance risk: ${row.compliance_risk || 'unknown'}.`,
      strategic_read: row.strategic_read || row.boundary_read || null,
      next_action: actionFromTier(row.tier),
      supplier_match_count: (num(row.primary_supplier_match_count) || 0) + (num(row.secondary_supplier_match_count) || 0),
      product_match_count: (num(row.primary_product_match_count) || 0) + (num(row.secondary_product_match_count) || 0),
      source_payload: row,
    })
  })

  const evidence = (data.evidence_rows || []).map(row => ({
    category_id: 'longevity',
    entry_key: slugify(row.ingredient),
    keyword: row.keyword,
    term_type: row.term_type,
    latest_month: row.latest_month || null,
    clicks: num(row.clicks) || 0,
    sales: num(row.sales) || 0,
    conversion_rate_pct: num(row.conversion_rate),
    growth_pct: num(row.growth_pct),
    has_data: Boolean(row.has_data),
    source_payload: row,
  }))
  return { entries, evidence }
}

function normalizeBotanical(data) {
  const entries = data.opportunities.map(row => {
    const risk = riskFromText(row.tier, row.interpretation, row.science_specificity)
    return markPendingV4({
      category_id: 'botanical_extracts',
      entry_key: slugify(row.name),
      name: row.name,
      normalized_name: normalizeName(row.name),
      tier: row.tier,
      mechanism_lane: row.marker_system,
      route_or_format: row.botanical,
      latest_clicks: num(row.latest_clicks) || 0,
      latest_sales: num(row.latest_sales) || 0,
      weighted_conversion_pct: num(row.weighted_conversion_pct),
      best_keyword: row.best_keyword || null,
      best_keyword_clicks: num(row.best_keyword_clicks),
      best_keyword_sales: num(row.best_keyword_sales),
      best_keyword_cvr: num(row.best_keyword_cvr),
      best_keyword_growth: num(row.best_keyword_growth),
      toniiq_status: row.toniiq_status || null,
      supplier_status: row.supplier_match_count ? `${row.supplier_match_count} supplier matches; ${row.supplier_doc_hit_count || 0} doc hits` : 'No supplier match in source atlas',
      risk_level: risk,
      risk_notes: row.science_specificity || null,
      strategic_read: row.interpretation || row.active_wedge || null,
      next_action: actionFromTier(row.tier),
      supplier_match_count: num(row.supplier_match_count) || 0,
      product_match_count: num(row.product_match_count) || 0,
      source_payload: row,
    })
  })

  const evidence = (data.evidence_rows || []).map(row => ({
    category_id: 'botanical_extracts',
    entry_key: slugify(row.opportunity),
    keyword: row.keyword,
    term_type: firstNonEmpty(row.term_type_label, row.term_type),
    latest_month: data.metadata?.latest_month || null,
    clicks: num(row.latest_clicks) || 0,
    sales: num(row.latest_sales) || 0,
    conversion_rate_pct: num(row.conversion_rate_pct),
    growth_pct: num(row.growth_since_2025_10_pct),
    has_data: Boolean(row.has_data),
    source_payload: row,
  }))
  return { entries, evidence }
}

function supplierRead(row) {
  const count = (num(row.primary_supplier_match_count) || 0) + (num(row.secondary_supplier_match_count) || 0)
  const price = row.price_min || row.price_max
    ? `price range ${row.price_min || '?'}-${row.price_max || '?'}`
    : 'no price range'
  return count ? `${count} supplier matches; ${price}` : 'No supplier match in source atlas'
}

function evidenceNumber(row, field) {
  if (field === 'clicks') return num(row.clicks ?? row.latest_clicks) || 0
  if (field === 'sales') return num(row.sales ?? row.latest_sales) || 0
  if (field === 'cvr') return num(row.conversion_rate_pct ?? row.conversion_rate) || null
  if (field === 'growth') return num(row.growth_pct ?? row.growth_since_2025_10_pct) || null
  return null
}

function evidenceHasSignal(row) {
  return Boolean(row.has_data) && (evidenceNumber(row, 'clicks') > 0 || evidenceNumber(row, 'sales') > 0)
}

function buildNicheGroups(entry, rows) {
  const groups = new Map()
  for (const row of rows) {
    if (!evidenceHasSignal(row)) continue
    const group = keywordGroup(row.keyword, entry.name)
    if (!group) continue
    const current = groups.get(group.key) || { ...group, rows: [] }
    current.rows.push(row)
    groups.set(group.key, current)
  }
  return [...groups.values()].map(group => {
    const sorted = [...group.rows].sort((a, b) => evidenceNumber(b, 'clicks') - evidenceNumber(a, 'clicks'))
    const clicks = group.rows.reduce((sum, row) => sum + evidenceNumber(row, 'clicks'), 0)
    const sales = group.rows.reduce((sum, row) => sum + evidenceNumber(row, 'sales'), 0)
    return {
      ...group,
      rows: sorted,
      bestRow: sorted[0],
      clicks,
      sales,
      cvr: weightedConversion(group.rows),
      growth: evidenceNumber(sorted[0], 'growth'),
    }
  }).filter(group => group.clicks >= 25 || group.sales >= 5)
}

function withEvidenceEntryKey(row, entryKey, extraPayload = {}) {
  return {
    ...row,
    entry_key: entryKey,
    source_payload: {
      ...(row.source_payload || {}),
      ...extraPayload,
      original_entry_key: row.entry_key,
    },
  }
}

function parentFamilyEntry(entry, groups) {
  const base = displayBaseName(entry.name)
  return markPending({
    ...entry,
    entry_key: `${entry.entry_key}-family`,
    name: `${base} family`,
    normalized_name: normalizeName(`${base} family`),
    atlas_role: 'parent_family',
    niche_type: 'family_context',
    parent_family: `${base} family`,
    primary_keyword: entry.best_keyword || base,
    query_packet: [],
    competitive_frame: { child_niches: groups.map(group => group.name) },
    scoring_method: 'not_scored_parent_family',
    next_action: 'Use the child niche rows for scoring and promotion.',
    specificity_notes: `Split into ${groups.map(group => group.name).join(', ')} so each launch/search lane can be scored separately.`,
  })
}

function childEntryFromGroup(entry, group) {
  const primaryKeyword = group.bestRow.keyword
  const base = displayBaseName(entry.name)
  return markPending({
    ...entry,
    entry_key: group.key,
    name: group.name,
    normalized_name: normalizeName(group.name),
    atlas_role: 'scored_niche',
    niche_type: group.type,
    parent_family: `${base} family`,
    source_entry_key: entry.source_entry_key || entry.entry_key,
    latest_clicks: group.clicks,
    latest_sales: group.sales,
    weighted_conversion_pct: group.cvr,
    best_keyword: primaryKeyword,
    best_keyword_clicks: evidenceNumber(group.bestRow, 'clicks'),
    best_keyword_sales: evidenceNumber(group.bestRow, 'sales'),
    best_keyword_cvr: evidenceNumber(group.bestRow, 'cvr'),
    best_keyword_growth: group.growth,
    primary_keyword: primaryKeyword,
    query_packet: queryPacketFor(primaryKeyword, group.rows),
    competitive_frame: competitiveFrameFor(entry, group),
    specificity_notes: `Niche-specific child row split from ${entry.name}; sibling technologies stay adjacent, not exact competitors.`,
    source_payload: {
      ...(entry.source_payload || {}),
      niche_specificity: {
        source_entry_key: entry.entry_key,
        parent_family: `${base} family`,
        group_key: group.key,
        group_name: group.name,
        evidence_keywords: group.rows.map(row => row.keyword),
      },
    },
  })
}

function defaultSpecificEntry(entry) {
  if (entry.category_id !== 'liposomal') return markPending(entry)
  const base = displayBaseName(entry.name)
  const primaryKeyword = entry.best_keyword || `liposomal ${base}`
  return markPending({
    ...entry,
    entry_key: `liposomal-${slugify(base)}`,
    name: `Liposomal ${base}`,
    normalized_name: normalizeName(`Liposomal ${base}`),
    atlas_role: 'scored_niche',
    niche_type: 'delivery_technology',
    parent_family: `${base} family`,
    primary_keyword: primaryKeyword,
    query_packet: queryPacketFor(primaryKeyword),
    competitive_frame: competitiveFrameFor(entry, {
      key: `liposomal-${slugify(base)}`,
      include: [primaryFamilyToken(base), base.toLowerCase()],
      requireAny: ['liposomal', 'liposome'],
    }),
    specificity_notes: 'Default liposomal child row generated from the liposomal category atlas.',
  })
}

function shouldSplitEntry(entry, groups) {
  if (!groups.length) return false
  if (entry.category_id === 'liposomal') return groups.length > 1
  return /berberine|quercetin|curcumin|turmeric|nmn|glutathione|spermidine|urolithin|fisetin|apigenin|coq10|alpha lipoic|milk thistle/i.test(entry.name)
}

function expandNicheSpecificity(entries, evidence) {
  const evidenceByEntry = new Map()
  for (const row of evidence) {
    const key = `${row.category_id}:${row.entry_key}`
    if (!evidenceByEntry.has(key)) evidenceByEntry.set(key, [])
    evidenceByEntry.get(key).push(row)
  }

  const expandedEntries = []
  const expandedEvidence = []

  for (const entry of entries) {
    const rows = evidenceByEntry.get(`${entry.category_id}:${entry.entry_key}`) || []
    const groups = buildNicheGroups(entry, rows)

    if (shouldSplitEntry(entry, groups)) {
      const parent = parentFamilyEntry(entry, groups)
      expandedEntries.push(parent)
      expandedEvidence.push(...rows.map(row => withEvidenceEntryKey(row, parent.entry_key, { atlas_role: 'parent_family' })))
      for (const group of groups) {
        const child = childEntryFromGroup(entry, group)
        expandedEntries.push(child)
        expandedEvidence.push(...group.rows.map(row => withEvidenceEntryKey(row, child.entry_key, { atlas_role: 'scored_niche', group_key: group.key })))
      }
    } else {
      const specific = defaultSpecificEntry(entry)
      expandedEntries.push(specific)
      expandedEvidence.push(...rows.map(row => withEvidenceEntryKey(row, specific.entry_key, { atlas_role: specific.atlas_role || 'scored_niche' })))
    }
  }

  return { entries: expandedEntries, evidence: expandedEvidence }
}

function sqlString(value) {
  if (value === null || value === undefined) return 'null'
  return `'${String(value).replace(/'/g, "''")}'`
}

function sqlNumber(value) {
  const parsed = num(value)
  return parsed === null ? 'null' : String(parsed)
}

function sqlJson(value) {
  return `${sqlString(JSON.stringify(value ?? {}))}::jsonb`
}

function sqlBool(value) {
  return value ? 'true' : 'false'
}

function sqlTextArray(values) {
  const list = Array.isArray(values) ? values : []
  if (!list.length) return "'{}'::text[]"
  return `array[${list.map(value => sqlString(value)).join(', ')}]::text[]`
}

function arrayUnion(...lists) {
  const out = []
  for (const list of lists) {
    for (const value of Array.isArray(list) ? list : []) {
      if (value && !out.includes(value)) out.push(value)
    }
  }
  return out
}

function mergeFrame(...frames) {
  const merged = {}
  for (const frame of frames) {
    if (!frame || typeof frame !== 'object') continue
    for (const [key, value] of Object.entries(frame)) {
      if (Array.isArray(value)) {
        merged[key] = arrayUnion(merged[key], value)
      } else if (value !== null && value !== undefined && merged[key] === undefined) {
        merged[key] = value
      }
    }
  }
  return merged
}

function primaryCategoryFor(entries) {
  const categories = arrayUnion(...entries.map(entry => [entry.category_id, ...(entry.source_categories || [])]))
  const name = normalizeName(entries[0]?.name)
  if (name.includes('liposomal') && categories.includes('liposomal')) return 'liposomal'
  if ((name.includes('phytosome') || name.includes('sucrosomial') || name.includes('micellar')) && categories.includes('liposomal')) return 'liposomal'
  if ((name.includes('probiotic') || name.includes('strain')) && categories.includes('probiotics')) return 'probiotics'
  return [...entries].sort((a, b) => (b.latest_clicks || 0) - (a.latest_clicks || 0))[0]?.category_id || categories[0] || 'liposomal'
}

function dedupeKeyForEntry(entry) {
  const role = entry.atlas_role || 'scored_niche'
  if (role !== 'scored_niche') return `${role}:${normalizeName(entry.name)}`
  return `${role}:${normalizeName(entry.name)}:${normalizeName(entry.primary_keyword)}`
}

function canonicalEntryKey(entry) {
  if ((entry.atlas_role || 'scored_niche') !== 'scored_niche') return slugify(entry.name)
  return entry.entry_key
}

function mergeEntryGroup(group) {
  const primaryCategory = primaryCategoryFor(group)
  const demandLeader = [...group].sort((a, b) => (b.latest_clicks || 0) - (a.latest_clicks || 0))[0]
  const base = group.find(entry => entry.category_id === primaryCategory) || demandLeader || group[0]
  const sourceCategories = arrayUnion(...group.map(entry => [entry.category_id, ...(entry.source_categories || [])]))
  const queryPacket = arrayUnion(...group.map(entry => entry.query_packet || []))
  const sourceRows = group.map(entry => ({
    category_id: entry.category_id,
    source_categories: entry.source_categories || [entry.category_id],
    source_entry_key: entry.source_entry_key || entry.entry_key,
    name: entry.name,
    primary_keyword: entry.primary_keyword,
    latest_clicks: entry.latest_clicks,
    latest_sales: entry.latest_sales,
    best_keyword_growth: entry.best_keyword_growth,
  }))
  const scoringStatus = scoredStatusForRole(base.atlas_role || 'scored_niche')
  const merged = {
    ...base,
    category_id: primaryCategory,
    entry_key: canonicalEntryKey(base),
    source_categories: sourceCategories,
    latest_clicks: Math.max(...group.map(entry => num(entry.latest_clicks) || 0)),
    latest_sales: Math.max(...group.map(entry => num(entry.latest_sales) || 0)),
    best_keyword: demandLeader.best_keyword,
    best_keyword_clicks: demandLeader.best_keyword_clicks,
    best_keyword_sales: demandLeader.best_keyword_sales,
    best_keyword_cvr: demandLeader.best_keyword_cvr,
    best_keyword_growth: demandLeader.best_keyword_growth,
    weighted_conversion_pct: demandLeader.weighted_conversion_pct,
    query_packet: queryPacket.length ? queryPacket.slice(0, 8) : base.query_packet,
    competitive_frame: mergeFrame(...group.map(entry => entry.competitive_frame)),
    score_status: scoringStatus,
    computed_signals: {
      ...(base.computed_signals || {}),
      scoring_version: SCORING_VERSION,
      score_status: scoringStatus,
      source_categories: sourceCategories,
      merged_source_count: group.length,
    },
    source_payload: {
      ...(base.source_payload || {}),
      merged_sources: sourceRows,
    },
  }

  if (group.length > 1) {
    merged.specificity_notes = [
      base.specificity_notes,
      `Merged from ${sourceCategories.join(', ')} source atlases to keep this as one launchable/searchable niche.`,
    ].filter(Boolean).join(' ')
  }

  if ((merged.atlas_role || 'scored_niche') === 'scored_niche') {
    merged.scoring_notes = `Pending ${SCORING_VERSION}. This row is not scored until hybrid Apify discovery + Keepa ASIN enrichment runs on the exact niche: ${merged.primary_keyword}.`
  }

  return merged
}

function dedupeExpanded(entries, evidence) {
  const groups = new Map()
  for (const entry of entries) {
    const key = dedupeKeyForEntry(entry)
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(entry)
  }

  const mergedEntries = []
  const oldToNew = new Map()
  for (const group of groups.values()) {
    const merged = mergeEntryGroup(group)
    mergedEntries.push(merged)
    for (const entry of group) {
      oldToNew.set(`${entry.category_id}:${entry.entry_key}`, {
        category_id: merged.category_id,
        entry_key: merged.entry_key,
      })
    }
  }

  const evidenceSeen = new Set()
  const mergedEvidence = []
  for (const row of evidence) {
    const target = oldToNew.get(`${row.category_id}:${row.entry_key}`)
    if (!target) continue
    const dedupeKey = [
      target.category_id,
      target.entry_key,
      normalizeName(row.keyword),
      row.term_type || '',
      row.clicks ?? '',
      row.sales ?? '',
      row.growth_pct ?? '',
    ].join('|')
    if (evidenceSeen.has(dedupeKey)) continue
    evidenceSeen.add(dedupeKey)
    mergedEvidence.push({
      ...row,
      category_id: target.category_id,
      entry_key: target.entry_key,
      source_payload: {
        ...(row.source_payload || {}),
        original_category_id: row.source_payload?.original_category_id || row.category_id,
        original_entry_key: row.source_payload?.original_entry_key || row.entry_key,
      },
    })
  }

  return { entries: mergedEntries, evidence: mergedEvidence }
}

function buildSql(categories, entries, evidence) {
  const sourcePaths = Object.fromEntries(categories.map(category => [
    category.id,
    path.join(category.folder, category.dataFile),
  ]))

  const out = []
  out.push('-- Generated by scripts/build-category-atlas-import.mjs')
  out.push(`-- Generated at ${new Date().toISOString()}`)
  out.push('set search_path = public;')
  out.push('')
  out.push('begin;')
  out.push('')
  out.push(`insert into category_atlas_imports (id, import_key, source_version, scoring_version, source_paths, category_count, entry_count, evidence_count, status, notes, generated_at) values (${sqlString(IMPORT_ID)}::uuid, ${sqlString(IMPORT_KEY)}, ${sqlString(SOURCE_VERSION)}, ${sqlString(SCORING_VERSION)}, ${sqlJson(sourcePaths)}, ${categories.length}, ${entries.length}, ${evidence.length}, 'completed', 'Core four category atlas import generated from local category breakdown outputs.', now()) on conflict (import_key) do update set source_version = excluded.source_version, scoring_version = excluded.scoring_version, source_paths = excluded.source_paths, category_count = excluded.category_count, entry_count = excluded.entry_count, evidence_count = excluded.evidence_count, status = excluded.status, notes = excluded.notes, generated_at = excluded.generated_at, updated_at = now();`)
  out.push('')

  out.push('insert into category_atlas_categories (id, label, description, source_folder, sort_order, status) values')
  out.push(categories.map(category => `  (${sqlString(category.id)}, ${sqlString(category.label)}, ${sqlString(category.description)}, ${sqlString(category.folder)}, ${category.sort_order}, 'active')`).join(',\n') + '\non conflict (id) do update set label = excluded.label, description = excluded.description, source_folder = excluded.source_folder, sort_order = excluded.sort_order, status = excluded.status, updated_at = now();')
  out.push('')

  out.push('delete from category_atlas_keyword_evidence where import_id = ' + sqlString(IMPORT_ID) + '::uuid;')
  out.push('')

  out.push('insert into category_atlas_entries (id, import_id, category_id, entry_key, name, normalized_name, tier, mechanism_lane, route_or_format, latest_clicks, latest_sales, weighted_conversion_pct, best_keyword, best_keyword_clicks, best_keyword_sales, best_keyword_cvr, best_keyword_growth, primary_keyword, parent_family, atlas_role, niche_type, query_packet, competitive_frame, scoring_method, specificity_notes, source_entry_key, source_categories, score_status, strategic_score, recommendation_label, score_confidence, pillar_scores, computed_signals, scoring_notes, toniiq_status, supplier_status, risk_level, risk_notes, strategic_read, next_action, source_payload) values')
  out.push(entries.map(entry => {
    const id = entry.id
    return `  (${sqlString(id)}::uuid, ${sqlString(IMPORT_ID)}::uuid, ${sqlString(entry.category_id)}, ${sqlString(entry.entry_key)}, ${sqlString(entry.name)}, ${sqlString(entry.normalized_name)}, ${sqlString(entry.tier)}, ${sqlString(entry.mechanism_lane)}, ${sqlString(entry.route_or_format)}, ${sqlNumber(entry.latest_clicks)}, ${sqlNumber(entry.latest_sales)}, ${sqlNumber(entry.weighted_conversion_pct)}, ${sqlString(entry.best_keyword)}, ${sqlNumber(entry.best_keyword_clicks)}, ${sqlNumber(entry.best_keyword_sales)}, ${sqlNumber(entry.best_keyword_cvr)}, ${sqlNumber(entry.best_keyword_growth)}, ${sqlString(entry.primary_keyword)}, ${sqlString(entry.parent_family)}, ${sqlString(entry.atlas_role)}, ${sqlString(entry.niche_type)}, ${sqlJson(entry.query_packet || [])}, ${sqlJson(entry.competitive_frame || {})}, ${sqlString(entry.scoring_method)}, ${sqlString(entry.specificity_notes)}, ${sqlString(entry.source_entry_key)}, ${sqlTextArray(entry.source_categories)}, ${sqlString(entry.score_status)}, ${sqlNumber(entry.strategic_score)}, ${sqlString(entry.recommendation_label)}, ${sqlString(entry.score_confidence)}, ${sqlJson(entry.pillar_scores)}, ${sqlJson(entry.computed_signals)}, ${sqlString(entry.scoring_notes)}, ${sqlString(entry.toniiq_status)}, ${sqlString(entry.supplier_status)}, ${sqlString(entry.risk_level)}, ${sqlString(entry.risk_notes)}, ${sqlString(entry.strategic_read)}, ${sqlString(entry.next_action)}, ${sqlJson(entry.source_payload)})`
  }).join(',\n') + `\non conflict (import_id, category_id, entry_key) do update set name = excluded.name, normalized_name = excluded.normalized_name, tier = excluded.tier, mechanism_lane = excluded.mechanism_lane, route_or_format = excluded.route_or_format, latest_clicks = excluded.latest_clicks, latest_sales = excluded.latest_sales, weighted_conversion_pct = excluded.weighted_conversion_pct, best_keyword = excluded.best_keyword, best_keyword_clicks = excluded.best_keyword_clicks, best_keyword_sales = excluded.best_keyword_sales, best_keyword_cvr = excluded.best_keyword_cvr, best_keyword_growth = excluded.best_keyword_growth, primary_keyword = excluded.primary_keyword, parent_family = excluded.parent_family, atlas_role = excluded.atlas_role, niche_type = excluded.niche_type, query_packet = excluded.query_packet, competitive_frame = excluded.competitive_frame, scoring_method = excluded.scoring_method, specificity_notes = excluded.specificity_notes, source_entry_key = excluded.source_entry_key, source_categories = excluded.source_categories, score_status = case when category_atlas_entries.score_status in ('scored', 'hybrid_scored') then category_atlas_entries.score_status else excluded.score_status end, strategic_score = case when category_atlas_entries.score_status in ('scored', 'hybrid_scored') then category_atlas_entries.strategic_score else excluded.strategic_score end, recommendation_label = case when category_atlas_entries.score_status in ('scored', 'hybrid_scored') then category_atlas_entries.recommendation_label else excluded.recommendation_label end, score_confidence = case when category_atlas_entries.score_status in ('scored', 'hybrid_scored') then category_atlas_entries.score_confidence else excluded.score_confidence end, pillar_scores = case when category_atlas_entries.score_status in ('scored', 'hybrid_scored') then category_atlas_entries.pillar_scores else excluded.pillar_scores end, computed_signals = case when category_atlas_entries.score_status in ('scored', 'hybrid_scored') then category_atlas_entries.computed_signals else excluded.computed_signals end, scoring_notes = case when category_atlas_entries.score_status in ('scored', 'hybrid_scored') then category_atlas_entries.scoring_notes else excluded.scoring_notes end, toniiq_status = excluded.toniiq_status, supplier_status = excluded.supplier_status, risk_level = excluded.risk_level, risk_notes = excluded.risk_notes, strategic_read = excluded.strategic_read, next_action = excluded.next_action, source_payload = excluded.source_payload, updated_at = now();`)
  out.push('')

  if (evidence.length) {
    out.push('insert into category_atlas_keyword_evidence (id, import_id, entry_id, category_id, entry_key, keyword, term_type, latest_month, clicks, sales, conversion_rate_pct, growth_pct, has_data, source_payload) values')
    out.push(evidence.map((row, evidenceIndex) => {
      const entryId = uuidFromString(`${IMPORT_KEY}:${row.category_id}:${row.entry_key}`)
      const id = uuidFromString(`${IMPORT_KEY}:${row.category_id}:${row.entry_key}:${row.keyword}:${row.term_type || ''}:${evidenceIndex}`)
      return `  (${sqlString(id)}::uuid, ${sqlString(IMPORT_ID)}::uuid, ${sqlString(entryId)}::uuid, ${sqlString(row.category_id)}, ${sqlString(row.entry_key)}, ${sqlString(row.keyword)}, ${sqlString(row.term_type)}, ${row.latest_month ? `${sqlString(row.latest_month)}::date` : 'null'}, ${sqlNumber(row.clicks)}, ${sqlNumber(row.sales)}, ${sqlNumber(row.conversion_rate_pct)}, ${sqlNumber(row.growth_pct)}, ${sqlBool(row.has_data)}, ${sqlJson(row.source_payload)})`
    }).join(',\n') + ';')
  }

  out.push('')
  out.push('commit;')
  out.push('')
  return out.join('\n')
}

function main() {
  const categories = CATEGORY_CONFIG
  const allEntries = []
  const allEvidence = []

  for (const category of categories) {
    const data = readJson(category)
    const normalized = category.id === 'liposomal' ? normalizeLiposomal(data)
      : category.id === 'probiotics' ? normalizeProbiotics(data)
        : category.id === 'longevity' ? normalizeLongevity(data)
          : normalizeBotanical(data)

    allEntries.push(...normalized.entries)
    allEvidence.push(...normalized.evidence.filter(row => row.keyword && row.entry_key))
  }

  const split = expandNicheSpecificity(allEntries, allEvidence)
  const expanded = dedupeExpanded(split.entries, split.evidence)
  allEntries.length = 0
  allEvidence.length = 0
  allEntries.push(...expanded.entries)
  allEvidence.push(...expanded.evidence.filter(row => row.keyword && row.entry_key))

  for (const entry of allEntries) {
    entry.id = uuidFromString(`${IMPORT_KEY}:${entry.category_id}:${entry.entry_key}`)
  }

  allEntries.sort((a, b) => {
    const scoreDelta = (b.strategic_score || -1) - (a.strategic_score || -1)
    if (scoreDelta) return scoreDelta
    const demandDelta = (b.latest_clicks || 0) - (a.latest_clicks || 0)
    if (demandDelta) return demandDelta
    return a.name.localeCompare(b.name)
  })

  const sql = buildSql(categories, allEntries, allEvidence)
  fs.writeFileSync(path.join(APP_ROOT, 'supabase', 'seed_category_atlas.sql'), sql)

  const preview = {
    metadata: {
      query_date: QUERY_DATE,
      import_key: IMPORT_KEY,
      import_id: IMPORT_ID,
      source_version: SOURCE_VERSION,
      scoring_version: SCORING_VERSION,
      category_count: categories.length,
      entry_count: allEntries.length,
      evidence_count: allEvidence.length,
    },
    categories,
    entries: allEntries,
  }
  fs.mkdirSync(path.join(APP_ROOT, 'src', 'data'), { recursive: true })
  fs.writeFileSync(path.join(APP_ROOT, 'src', 'data', 'categoryAtlasPreview.json'), `${JSON.stringify(preview, null, 2)}\n`)

  console.log(`Category Atlas import generated: ${allEntries.length} entries, ${allEvidence.length} evidence rows`)
  for (const category of categories) {
    const count = allEntries.filter(entry => entry.category_id === category.id).length
    console.log(`- ${category.id}: ${count}`)
  }
}

main()
