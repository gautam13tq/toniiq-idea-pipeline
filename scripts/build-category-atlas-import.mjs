import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const APP_ROOT = path.resolve(__dirname, '..')
const PRODUCT_DEV_ROOT = process.env.PRODUCT_DEV_ROOT
  || '/Users/gautam/Library/Mobile Documents/iCloud~md~obsidian/Documents/Documents/Toniiq/Product Development'

const QUERY_DATE = '2026-05-15'
const IMPORT_KEY = 'category-atlas-core-four-2026-05-15'
const SOURCE_VERSION = 'category-atlas-core-four-v1'
const SCORING_VERSION = 'category-atlas-market-scoring-v1'
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

function tierBase(tier) {
  const text = String(tier || '').toLowerCase()
  if (text.includes('tier 1a')) return 8.5
  if (text.includes('tier 1')) return 8
  if (text.includes('tier 2')) return 6.5
  if (text.includes('tier 3')) return 4.5
  if (text.includes('watch')) return 3.5
  if (text.includes('avoid') || text.includes('exclude')) return 1.5
  return 5
}

function demandScore(clicks, sales, cvr) {
  const clickScore = clicks >= 250000 ? 10
    : clicks >= 100000 ? 9
      : clicks >= 50000 ? 8
        : clicks >= 20000 ? 6.5
          : clicks >= 5000 ? 5
            : clicks >= 1000 ? 3
              : clicks > 0 ? 1.5
                : 0
  const salesScore = sales >= 30000 ? 10
    : sales >= 10000 ? 9
      : sales >= 5000 ? 8
        : sales >= 1000 ? 6
          : sales >= 250 ? 4
            : sales > 0 ? 2
              : 0
  const cvrAdj = cvr >= 25 ? 1
    : cvr >= 15 ? 0.5
      : cvr > 0 && cvr < 5 ? -1
        : 0
  return clamp((clickScore * 0.7) + (salesScore * 0.3) + cvrAdj, 0, 10)
}

function growthScore(growthPct) {
  if (growthPct === null || growthPct === undefined) return 4
  return growthPct >= 300 ? 10
    : growthPct >= 150 ? 9
      : growthPct >= 75 ? 8
        : growthPct >= 35 ? 7
          : growthPct >= 10 ? 6
            : growthPct >= 0 ? 5
              : growthPct >= -25 ? 3
                : 1.5
}

function accessScore(entry) {
  let score = tierBase(entry.tier)
  if ((entry.supplier_match_count || entry.supplier_count || 0) > 0) score += 0.5
  if ((entry.product_match_count || entry.primary_product_match_count || 0) > 0) score += 0.5
  if (entry.risk_level === 'medium') score -= 1
  if (entry.risk_level === 'high') score -= 3
  return clamp(score, 0, 10)
}

function differentiationScore(entry) {
  const payload = entry.source_payload || {}
  const values = [
    payload.active_marker_score,
    payload.marker_awareness_score,
    payload.science_score,
    payload.fit_score,
    payload.feasibility_score,
    payload.identity_score,
    payload.toniiq_fit_score,
    payload.portfolio_fit_score,
  ].map(num).filter(value => value !== null)

  if (values.length) {
    const avgFivePoint = values.reduce((sum, value) => sum + value, 0) / values.length
    return clamp(avgFivePoint * 2, 0, 10)
  }

  let score = tierBase(entry.tier)
  const text = [
    entry.name,
    entry.strategic_read,
    entry.toniiq_status,
    payload.active_wedge,
    payload.bio_issue,
    payload.tier_logic,
  ].filter(Boolean).join(' ').toLowerCase()

  if (/(marker|standard|branded|strain|liposomal|phytosome|dihydro|high-cfu|specific|patent|delivery|bioavailability|stack)/.test(text)) score += 1
  if ((entry.supplier_count || 0) > 0) score += 0.5
  if (entry.risk_level === 'high') score -= 2
  return clamp(score, 0, 10)
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function round1(value) {
  return Math.round(value * 10) / 10
}

function scoreEntry(entry) {
  const market = demandScore(entry.latest_clicks || 0, entry.latest_sales || 0, entry.weighted_conversion_pct || entry.best_keyword_cvr || 0)
  const access = accessScore(entry)
  const growth = growthScore(entry.best_keyword_growth)
  const differentiation = differentiationScore(entry)
  const strategic = Math.round((market * 0.20 + access * 0.25 + growth * 0.20 + differentiation * 0.35) * 10)
  const recommendation = strategic >= 85 ? 'launch_priority'
    : strategic >= 70 ? 'strong_candidate'
      : strategic >= 50 ? 'watchlist'
        : 'pass'
  const confidence = confidenceFor(entry, market)
  const pillar_scores = {
    market_size_intent: {
      score: round1(market),
      weight: 0.20,
      reason: `Demand ${formatMetric(entry.latest_clicks)} clicks / ${formatMetric(entry.latest_sales)} sales; best keyword ${entry.best_keyword || 'none'}.`,
    },
    early_market_access: {
      score: round1(access),
      weight: 0.25,
      reason: `${entry.tier || 'No tier'}; risk ${entry.risk_level}; supplier/product overlap used only as category-level access proxy.`,
    },
    growth_timing: {
      score: round1(growth),
      weight: 0.20,
      reason: entry.best_keyword_growth === null || entry.best_keyword_growth === undefined
        ? 'No focused growth metric in source row; neutral-low timing score applied.'
        : `Best keyword growth ${entry.best_keyword_growth}%.`,
    },
    differentiation_hypothesis: {
      score: round1(differentiation),
      weight: 0.35,
      reason: entry.strategic_read || entry.toniiq_status || 'Category atlas fit proxy.',
    },
  }
  return {
    ...entry,
    strategic_score: strategic,
    recommendation_label: recommendation,
    score_confidence: confidence,
    pillar_scores,
    computed_signals: {
      market_size_intent: round1(market),
      early_market_access: round1(access),
      growth_timing: round1(growth),
      differentiation_hypothesis: round1(differentiation),
      scoring_version: SCORING_VERSION,
      source_category_score: entry.source_payload?.strategic_score ?? null,
    },
    scoring_notes: [
      `Scored through ${SCORING_VERSION}.`,
      'Uses sourced category atlas demand and qualitative evidence; not a Phase B score.',
      'Keepa/Phase B competitive enrichment still required before R&D commitment.',
    ].join(' '),
  }
}

function confidenceFor(entry, market) {
  if ((entry.latest_clicks || 0) <= 0) return 'low'
  if (entry.risk_level === 'high') return 'low'
  if (!entry.best_keyword || market < 3) return 'low'
  if (entry.best_keyword_growth === null || entry.best_keyword_growth === undefined) return 'medium'
  return 'high'
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

function normalizeLiposomal(data) {
  const entries = data.rows.map(row => {
    const risk = riskFromText(row.tier, row.science, row.bio_issue, row.tier_logic)
    return scoreEntry({
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
    return scoreEntry({
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
    return scoreEntry({
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
    return scoreEntry({
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

  out.push('insert into category_atlas_entries (id, import_id, category_id, entry_key, name, normalized_name, tier, mechanism_lane, route_or_format, latest_clicks, latest_sales, weighted_conversion_pct, best_keyword, best_keyword_clicks, best_keyword_sales, best_keyword_cvr, best_keyword_growth, strategic_score, recommendation_label, score_confidence, pillar_scores, computed_signals, scoring_notes, toniiq_status, supplier_status, risk_level, risk_notes, strategic_read, next_action, source_payload) values')
  out.push(entries.map(entry => {
    const id = entry.id
    return `  (${sqlString(id)}::uuid, ${sqlString(IMPORT_ID)}::uuid, ${sqlString(entry.category_id)}, ${sqlString(entry.entry_key)}, ${sqlString(entry.name)}, ${sqlString(entry.normalized_name)}, ${sqlString(entry.tier)}, ${sqlString(entry.mechanism_lane)}, ${sqlString(entry.route_or_format)}, ${sqlNumber(entry.latest_clicks)}, ${sqlNumber(entry.latest_sales)}, ${sqlNumber(entry.weighted_conversion_pct)}, ${sqlString(entry.best_keyword)}, ${sqlNumber(entry.best_keyword_clicks)}, ${sqlNumber(entry.best_keyword_sales)}, ${sqlNumber(entry.best_keyword_cvr)}, ${sqlNumber(entry.best_keyword_growth)}, ${sqlNumber(entry.strategic_score)}, ${sqlString(entry.recommendation_label)}, ${sqlString(entry.score_confidence)}, ${sqlJson(entry.pillar_scores)}, ${sqlJson(entry.computed_signals)}, ${sqlString(entry.scoring_notes)}, ${sqlString(entry.toniiq_status)}, ${sqlString(entry.supplier_status)}, ${sqlString(entry.risk_level)}, ${sqlString(entry.risk_notes)}, ${sqlString(entry.strategic_read)}, ${sqlString(entry.next_action)}, ${sqlJson(entry.source_payload)})`
  }).join(',\n') + '\non conflict (import_id, category_id, entry_key) do update set name = excluded.name, normalized_name = excluded.normalized_name, tier = excluded.tier, mechanism_lane = excluded.mechanism_lane, route_or_format = excluded.route_or_format, latest_clicks = excluded.latest_clicks, latest_sales = excluded.latest_sales, weighted_conversion_pct = excluded.weighted_conversion_pct, best_keyword = excluded.best_keyword, best_keyword_clicks = excluded.best_keyword_clicks, best_keyword_sales = excluded.best_keyword_sales, best_keyword_cvr = excluded.best_keyword_cvr, best_keyword_growth = excluded.best_keyword_growth, strategic_score = excluded.strategic_score, recommendation_label = excluded.recommendation_label, score_confidence = excluded.score_confidence, pillar_scores = excluded.pillar_scores, computed_signals = excluded.computed_signals, scoring_notes = excluded.scoring_notes, toniiq_status = excluded.toniiq_status, supplier_status = excluded.supplier_status, risk_level = excluded.risk_level, risk_notes = excluded.risk_notes, strategic_read = excluded.strategic_read, next_action = excluded.next_action, source_payload = excluded.source_payload, updated_at = now();')
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

    for (const entry of normalized.entries) {
      entry.id = uuidFromString(`${IMPORT_KEY}:${entry.category_id}:${entry.entry_key}`)
      allEntries.push(entry)
    }
    allEvidence.push(...normalized.evidence.filter(row => row.keyword && row.entry_key))
  }

  allEntries.sort((a, b) => (b.strategic_score || 0) - (a.strategic_score || 0) || a.name.localeCompare(b.name))

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
