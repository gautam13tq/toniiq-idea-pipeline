import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { formatNumber, normalizeIdeaName } from '../lib/opportunity'

const SORT_OPTIONS = [
  { key: 'score', label: 'Strategic score' },
  { key: 'growth_timing', label: 'Momentum' },
  { key: 'market_size_intent', label: 'Demand & Intent' },
  { key: 'early_market_access', label: 'Competitive Opening' },
  { key: 'differentiation_proxy', label: 'Toniiq Wedge' },
  { key: 'demand_volume', label: 'Demand volume' },
  { key: 'name', label: 'Name' },
]

const RECOMMENDATION_LABELS = {
  launch_priority: 'Launch Priority',
  strong_candidate: 'Strong Candidate',
  watchlist: 'Watchlist',
  pass: 'Pass',
}

const STATUS_LABELS = {
  pending_v4: 'Pending',
  pending_hybrid: 'Pending Hybrid',
  scoring: 'Scoring',
  hybrid_scoring: 'Scoring',
  scored: 'Done',
  hybrid_scored: 'Done',
  failed: 'Failed',
  audit_failed: 'Audit Failed',
  not_scored: 'Family',
}

const SCORE_PILLARS = [
  { key: 'growth_timing', label: 'Momentum', weight: 0.20 },
  { key: 'market_size_intent', label: 'Demand & Intent', weight: 0.20 },
  { key: 'early_market_access', label: 'Competitive Opening', weight: 0.25 },
  { key: 'differentiation_proxy', label: 'Toniiq Wedge', weight: 0.35, aliases: ['differentiation_hypothesis'] },
]

const GATE_LABELS = {
  early_access_below_2_0: 'Very hard to enter',
  early_access_below_3_0: 'Limited opening',
  early_access_below_launch_threshold: 'Opening below launch threshold',
  review_moat_above_75: 'High review barrier',
  review_moat_above_60: 'Meaningful review barrier',
  attackability_below_04: 'Very weak opening',
  attackability_below_10: 'Small opening',
  growth_below_launch_threshold: 'Weak timing',
  dominant_top_bsr_leader: 'Dominant market leader',
  no_exact_competitors: 'No exact competitor set',
  thin_exact_competitor_set: 'Thin exact competitor set',
  thin_keepa_result_set: 'Thin Keepa result set',
  low_stage_a_score: 'Low Stage A score',
  fortress_root_market: 'Fortress root market',
}

let previewAtlasCache = null

async function getPreviewAtlas() {
  if (!previewAtlasCache) {
    previewAtlasCache = (await import('../data/categoryAtlasPreview.json')).default
  }
  return previewAtlasCache
}

function previewImport(previewAtlas) {
  return {
    id: previewAtlas.metadata.import_id,
    import_key: previewAtlas.metadata.import_key,
    source_version: previewAtlas.metadata.source_version,
    scoring_version: previewAtlas.metadata.scoring_version,
    source: 'bundled_preview',
  }
}

function scoreTone(score) {
  if (score === null || score === undefined || score === '') return 'neutral'
  if (score >= 85) return 'green'
  if (score >= 70) return 'amber'
  if (score >= 50) return 'blue'
  return 'neutral'
}

function scoreLabel(score) {
  if (score === null || score === undefined || score === '') return 'Unscored'
  if (score >= 85) return 'Launch priority'
  if (score >= 70) return 'Strong candidate'
  if (score >= 50) return 'Worth reviewing'
  return 'Low priority'
}

function toneStyle(tone) {
  if (tone === 'green') return { background: 'var(--green-muted)', color: 'var(--green-text)', borderColor: 'rgba(74,222,128,0.3)' }
  if (tone === 'amber') return { background: 'var(--amber-muted)', color: 'var(--amber-text)', borderColor: 'rgba(251,191,36,0.3)' }
  if (tone === 'blue') return { background: 'var(--blue-muted)', color: 'var(--blue-text)', borderColor: 'rgba(96,165,250,0.3)' }
  if (tone === 'red') return { background: 'var(--red-muted)', color: 'var(--red-text)', borderColor: 'rgba(248,113,113,0.3)' }
  return { background: 'var(--bg-active)', color: 'var(--text-muted)', borderColor: 'var(--border-default)' }
}

function formatPct(value) {
  if (value === null || value === undefined || value === '') return '-'
  return `${Number(value).toFixed(1)}%`
}

function formatGrowth(value) {
  if (value === null || value === undefined || value === '') return '-'
  const parsed = Number(value)
  return `${parsed >= 0 ? '+' : ''}${parsed.toFixed(1)}%`
}

function formatCompact(value) {
  if (value === null || value === undefined || value === '') return '-'
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return '-'
  if (Math.abs(parsed) >= 1_000_000) return `${(parsed / 1_000_000).toFixed(parsed >= 10_000_000 ? 0 : 1)}M`
  if (Math.abs(parsed) >= 1_000) return `${(parsed / 1_000).toFixed(parsed >= 10_000 ? 0 : 1)}K`
  return Math.round(parsed).toLocaleString()
}

function formatIndex(value) {
  if (value === null || value === undefined || value === '') return '-'
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return '-'
  return `${Math.round(parsed * 100)}/100`
}

function categoryText(entry, categoryMap) {
  const ids = entry.source_categories?.length ? entry.source_categories : [entry.category_id]
  return ids.map(id => categoryMap.get(id)?.label || id).join(' + ')
}

function entryInCategory(entry, categoryId) {
  if (categoryId === 'all') return true
  const ids = entry.source_categories?.length ? entry.source_categories : [entry.category_id]
  return ids.includes(categoryId)
}

function searchableText(entry, categoryMap) {
  return [
    entry.name,
    entry.parent_family,
    entry.atlas_role,
    entry.niche_type,
    entry.tier,
    entry.best_keyword,
    entry.primary_keyword,
    entry.mechanism_lane,
    entry.toniiq_status,
    entry.supplier_status,
    entry.strategic_read,
    entry.specificity_notes,
    categoryText(entry, categoryMap),
  ].filter(Boolean).join(' ').toLowerCase()
}

function isScoredStatus(status) {
  return status === 'scored' || status === 'hybrid_scored'
}

function qualityGateRecord(entry) {
  return entry.computed_signals?.quality_gate || entry.competitive_snapshot?.quality_gate || null
}

function qualityGateTone(gate) {
  if (!gate) return 'neutral'
  if (gate.status === 'passed') return 'green'
  if (gate.status === 'failed') return 'red'
  return 'neutral'
}

function qualityGateLabel(gate) {
  if (!gate) return 'Quality pending'
  return gate.status === 'passed' ? 'Quality passed' : gate.status === 'failed' ? 'Quality failed' : `Quality ${gate.status}`
}

function pillarScore(entry, key) {
  const keys = [key, ...(SCORE_PILLARS.find(pillar => pillar.key === key)?.aliases || [])]
  for (const candidate of keys) {
    const stored = Number(entry.pillar_scores?.[candidate]?.score)
    if (Number.isFinite(stored)) return stored
    const signal = Number(entry.computed_signals?.[candidate])
    if (Number.isFinite(signal)) return signal > 10 ? signal / 10 : signal
  }
  return null
}

function pillarRecord(entry, config) {
  const keys = [config.key, ...(config.aliases || [])]
  for (const key of keys) {
    const stored = entry.pillar_scores?.[key]
    const storedScore = Number(stored?.score)
    const signalScore = Number(entry.computed_signals?.[key])
    const score = Number.isFinite(storedScore)
      ? storedScore
      : Number.isFinite(signalScore)
        ? (signalScore > 10 ? signalScore / 10 : signalScore)
        : null
    if (score !== null) {
      return {
        key,
        label: config.label,
        score,
        weight: Number(stored?.weight ?? config.weight ?? 0),
        reason: stored?.reason || '',
      }
    }
  }
  return {
    key: config.key,
    label: config.label,
    score: null,
    weight: config.weight ?? 0,
    reason: '',
  }
}

function tablePillarContext(entry, key) {
  if (key === 'growth_timing') return formatGrowth(entry.best_keyword_growth)
  if (key === 'market_size_intent') return `${formatCompact(entry.latest_clicks)} clicks`
  if (key === 'early_market_access') {
    if (entry.review_p50) return `${formatCompact(entry.review_p50)} review p50`
    if (entry.best_bsr) return `#${formatCompact(entry.best_bsr)} BSR`
  }
  if (key === 'differentiation_proxy') return entry.primary_keyword || entry.best_keyword || ''
  return ''
}

function scoreBandForPillar(score, key, context = '') {
  const parsed = Number(score)
  if (!Number.isFinite(parsed)) return band('neutral', 'Pending')
  const detail = [`${parsed.toFixed(1)}/10`, context].filter(Boolean).join(' · ')
  if (key === 'early_market_access') {
    if (parsed >= 7) return band('green', 'Open', detail)
    if (parsed >= 5) return band('blue', 'Workable', detail)
    if (parsed >= 3) return band('amber', 'Tight', detail)
    return band('red', 'Hard', detail)
  }
  if (key === 'growth_timing') {
    if (parsed >= 7) return band('green', 'Strong', detail)
    if (parsed >= 5) return band('blue', 'Positive', detail)
    if (parsed >= 3) return band('amber', 'Soft', detail)
    return band('red', 'Weak', detail)
  }
  if (key === 'market_size_intent') {
    if (parsed >= 8) return band('green', 'Very strong', detail)
    if (parsed >= 6) return band('blue', 'Strong', detail)
    if (parsed >= 4) return band('amber', 'Moderate', detail)
    return band('red', 'Thin', detail)
  }
  if (parsed >= 8) return band('green', 'Strong', detail)
  if (parsed >= 6) return band('blue', 'Good', detail)
  if (parsed >= 4) return band('amber', 'Mixed', detail)
  return band('red', 'Weak', detail)
}

function sortEntries(entries, sortBy) {
  return [...entries].sort((a, b) => {
    if (sortBy === 'name') return a.name.localeCompare(b.name)
    const aScored = isScoredStatus(scoreStatus(a))
    const bScored = isScoredStatus(scoreStatus(b))
    if (['score', ...SCORE_PILLARS.map(pillar => pillar.key)].includes(sortBy) && aScored !== bScored) return bScored ? 1 : -1
    if (SCORE_PILLARS.some(pillar => pillar.key === sortBy)) return Number(pillarScore(b, sortBy) ?? -1) - Number(pillarScore(a, sortBy) ?? -1)
    if (sortBy === 'demand_volume') return Number(b.latest_clicks || 0) - Number(a.latest_clicks || 0)
    if (!aScored && !bScored) return Number(b.latest_clicks || 0) - Number(a.latest_clicks || 0)
    return Number(b.strategic_score || 0) - Number(a.strategic_score || 0)
  })
}

function scoreStatus(entry) {
  if (entry.score_status) return entry.score_status
  const version = entry.computed_signals?.scoring_version || ''
  if (version.includes('category-atlas-v5') && entry.strategic_score !== null && entry.strategic_score !== undefined) return 'hybrid_scored'
  if (version.includes('category-atlas-v4') && entry.strategic_score !== null && entry.strategic_score !== undefined) return 'scored'
  return 'pending_hybrid'
}

function statusTone(status) {
  if (isScoredStatus(status)) return 'green'
  if (status === 'failed' || status === 'audit_failed') return 'red'
  if (status === 'scoring' || status === 'hybrid_scoring') return 'amber'
  return 'neutral'
}

function gateLabel(value) {
  if (!value) return ''
  return GATE_LABELS[value] || String(value).replace(/_/g, ' ')
}

function band(tone, label, detail = '') {
  return { tone, label, detail }
}

function reviewBarrierBand(value) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return band('neutral', 'Pending')
  if (parsed < 0.25) return band('green', 'Low', formatIndex(parsed))
  if (parsed < 0.50) return band('blue', 'Medium', formatIndex(parsed))
  if (parsed < 0.75) return band('amber', 'High', formatIndex(parsed))
  return band('red', 'Fortress', formatIndex(parsed))
}

function salesRankBand(value) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return band('neutral', 'Pending')
  if (parsed <= 2_000) return band('green', 'Very active', `#${formatCompact(parsed)}`)
  if (parsed <= 10_000) return band('blue', 'Active', `#${formatCompact(parsed)}`)
  if (parsed <= 50_000) return band('amber', 'Niche', `#${formatCompact(parsed)}`)
  return band('neutral', 'Thin', `#${formatCompact(parsed)}`)
}

function typicalReviewBand(value) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return band('neutral', 'Pending')
  if (parsed < 500) return band('green', 'Low reviews', formatCompact(parsed))
  if (parsed < 2_000) return band('blue', 'Moderate reviews', formatCompact(parsed))
  if (parsed < 8_000) return band('amber', 'High reviews', formatCompact(parsed))
  return band('red', 'Very high reviews', formatCompact(parsed))
}

function exactCompetitorBand(value) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return band('red', 'No clean set')
  if (parsed < 5) return band('amber', 'Thin set', `${parsed} matches`)
  if (parsed < 12) return band('blue', 'Usable set', `${parsed} matches`)
  return band('green', 'Good set', `${parsed} matches`)
}

function productMatchLabel(value) {
  if (value === 'included') return 'Included'
  if (value === 'exact') return 'Exact match'
  if (value === 'stack') return 'Stack / blend'
  if (value === 'adjacent') return 'Adjacent'
  if (value === 'excluded') return 'Excluded'
  if (value === 'noise') return 'Filtered noise'
  return value || 'Competitor'
}

function productMatchTone(value) {
  if (value === 'included') return 'green'
  if (value === 'exact') return 'green'
  if (value === 'stack') return 'blue'
  if (value === 'adjacent') return 'amber'
  if (value === 'excluded') return 'red'
  if (value === 'noise') return 'red'
  return 'neutral'
}

function scorePillars(entry) {
  return SCORE_PILLARS.map(config => {
    const value = pillarRecord(entry, config)
    const score = Number(value.score)
    const weight = Number(value.weight || 0)
    const points = Number.isFinite(score) ? score * weight * 10 : null
    return { ...value, score, weight, points }
  })
}

function scoreSummary(entry, gates, pillars) {
  const status = scoreStatus(entry)
  if (!isScoredStatus(status)) {
    if (entry.atlas_role && entry.atlas_role !== 'scored_niche') return 'Family context row only. Use the child niche rows for scoring and launch decisions.'
    return `Pending hybrid competitive scoring for ${entry.primary_keyword || entry.best_keyword || entry.name}.`
  }
  const sorted = [...pillars].filter(item => Number.isFinite(item.score)).sort((a, b) => b.score - a.score)
  const strongest = sorted[0]?.label
  const weakest = [...sorted].sort((a, b) => a.score - b.score)[0]?.label
  const gate = gates[0] ? gateLabel(gates[0]) : ''
  return [
    `${entry.strategic_score}/100 means ${scoreLabel(entry.strategic_score).toLowerCase()}.`,
    strongest ? `Best support: ${strongest}.` : null,
    gate ? `Main constraint: ${gate}.` : weakest ? `Main constraint: ${weakest}.` : null,
  ].filter(Boolean).join(' ')
}

function sourceContext(entry, categoryMap) {
  const pillarSummary = scorePillars(entry)
    .map(value => `${value.label}: ${value.score ?? '-'} (${value.reason || 'no reason'})`)
    .join('\n')
  return [
    `Category Atlas: ${categoryText(entry, categoryMap)}`,
    `Entry: ${entry.name}`,
    `Strategic score: ${entry.strategic_score ?? 'n/a'}/100`,
    `Recommendation: ${RECOMMENDATION_LABELS[entry.recommendation_label] || entry.recommendation_label || 'n/a'}`,
    `Tier: ${entry.tier || 'n/a'}`,
    entry.best_keyword ? `Best keyword: ${entry.best_keyword} (${formatNumber(entry.best_keyword_clicks)} clicks, ${formatNumber(entry.best_keyword_sales)} sales, ${formatPct(entry.best_keyword_cvr)} CVR)` : null,
    entry.strategic_read ? `Strategic read: ${entry.strategic_read}` : null,
    entry.next_action ? `Next action: ${entry.next_action}` : null,
    pillarSummary ? `Pillar scores:\n${pillarSummary}` : null,
    'Source: category_atlas_entries, generated from local category breakdown files.',
  ].filter(Boolean).join('\n')
}

export default function CategoryAtlasPage() {
  const [categories, setCategories] = useState([])
  const [currentImport, setCurrentImport] = useState(null)
  const [entries, setEntries] = useState([])
  const [evidence, setEvidence] = useState([])
  const [selectedId, setSelectedId] = useState(null)
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [roleFilter, setRoleFilter] = useState('scored_niche')
  const [recommendationFilter, setRecommendationFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [sortBy, setSortBy] = useState('score')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [savingId, setSavingId] = useState(null)
  const [scoring, setScoring] = useState(false)
  const [competitors, setCompetitors] = useState([])

  useEffect(() => {
    let ignore = false
    async function load() {
      setError('')
      setLoading(true)
      async function loadBundledPreview() {
        const previewAtlas = await getPreviewAtlas()
        if (ignore) return
        setCategories(previewAtlas.categories)
        setCurrentImport(previewImport(previewAtlas))
        setEntries(previewAtlas.entries || [])
        setSelectedId(previewAtlas.entries?.[0]?.id || null)
        setLoading(false)
      }

      const [categoriesRes, importsRes] = await Promise.all([
        supabase.from('category_atlas_categories').select('*').order('sort_order'),
        supabase.from('category_atlas_imports').select('*').eq('status', 'completed').order('generated_at', { ascending: false }).limit(1),
      ])

      if (ignore) return
      if (categoriesRes.error || importsRes.error) {
        await loadBundledPreview()
        return
      }

      const importRow = importsRes.data?.[0] || null
      setCategories(categoriesRes.data || [])
      setCurrentImport(importRow)

      if (!importRow) {
        await loadBundledPreview()
        return
      }

      const { data, error: entriesError } = await supabase
        .from('category_atlas_entries')
        .select('*')
        .eq('import_id', importRow.id)
        .order('strategic_score', { ascending: false })

      if (ignore) return
      if (entriesError) {
        await loadBundledPreview()
      }
      else {
        setEntries(data || [])
        setSelectedId(data?.[0]?.id || null)
      }
      setLoading(false)
    }
    load()
    return () => { ignore = true }
  }, [])

  const categoryMap = useMemo(() => new Map(categories.map(category => [category.id, category])), [categories])
  const selected = useMemo(() => entries.find(entry => entry.id === selectedId) || entries[0] || null, [entries, selectedId])

  useEffect(() => {
    let ignore = false
    async function loadEvidence() {
      if (!selected) {
        setEvidence([])
        setCompetitors([])
        return
      }
      const [evidenceRes, competitorsRes] = await Promise.all([
        supabase
        .from('category_atlas_keyword_evidence')
        .select('*')
        .eq('entry_id', selected.id)
        .order('clicks', { ascending: false })
        .limit(80),
        supabase
          .from('category_atlas_competitors')
          .select('*')
          .eq('entry_id', selected.id)
          .order('bucket', { ascending: true })
          .order('rank', { ascending: true })
          .limit(120),
      ])
      if (ignore) return
      if (evidenceRes.error) setEvidence([])
      else setEvidence(evidenceRes.data || [])
      if (competitorsRes.error) setCompetitors([])
      else setCompetitors(competitorsRes.data || [])
    }
    loadEvidence()
    return () => { ignore = true }
  }, [selected])

  const visibleEntries = useMemo(() => {
    const q = search.trim().toLowerCase()
    let rows = entries
    if (categoryFilter !== 'all') rows = rows.filter(entry => entryInCategory(entry, categoryFilter))
    if (roleFilter !== 'all') rows = rows.filter(entry => (entry.atlas_role || 'scored_niche') === roleFilter)
    if (recommendationFilter !== 'all') rows = rows.filter(entry => entry.recommendation_label === recommendationFilter)
    if (statusFilter !== 'all') rows = rows.filter(entry => scoreStatus(entry) === statusFilter)
    if (q) rows = rows.filter(entry => searchableText(entry, categoryMap).includes(q))
    return sortEntries(rows, sortBy)
  }, [entries, categoryFilter, roleFilter, recommendationFilter, statusFilter, search, sortBy, categoryMap])

  const stats = useMemo(() => {
    const launch = entries.filter(entry => entry.recommendation_label === 'launch_priority').length
    const strong = entries.filter(entry => entry.recommendation_label === 'strong_candidate').length
    const scored = entries.filter(entry => isScoredStatus(scoreStatus(entry))).length
    const pending = entries.filter(entry => ['pending_v4', 'pending_hybrid', 'scoring', 'hybrid_scoring', 'failed', 'audit_failed'].includes(scoreStatus(entry))).length
    const scoreable = entries.filter(entry => (entry.atlas_role || 'scored_niche') === 'scored_niche').length
    const families = entries.filter(entry => (entry.atlas_role || 'scored_niche') !== 'scored_niche').length
    const promoted = entries.filter(entry => entry.promoted_review_id).length
    return { launch, strong, scored, pending, promoted, scoreable, families }
  }, [entries])

  async function refreshEntries(importId = currentImport?.id) {
    if (!importId || currentImport?.source === 'bundled_preview') return
    const { data, error: entriesError } = await supabase
      .from('category_atlas_entries')
      .select('*')
      .eq('import_id', importId)
      .order('strategic_score', { ascending: false, nullsFirst: false })
    if (!entriesError) setEntries(data || [])
  }

  async function runScoringBatch() {
    if (!currentImport?.id || currentImport?.source === 'bundled_preview') {
      alert('Hybrid scoring needs the Supabase Category Atlas tables and Edge Function deployed first.')
      return
    }
    setScoring(true)
    const { data, error: invokeError } = await supabase.functions.invoke('category-atlas-score-run', {
      body: { import_id: currentImport.id, limit: 5, keep_asins: 50 },
    })
    setScoring(false)
    if (invokeError) {
      alert(invokeError.message)
      return
    }
    await refreshEntries(currentImport.id)
    alert(`Hybrid scoring batch complete: ${data?.scored || 0} scored, ${data?.failed || 0} failed.`)
  }

  async function addToOpportunities(entry) {
    if (!entry) return
    if (!isScoredStatus(scoreStatus(entry))) {
      alert('This row needs hybrid competitive scoring before it can be added to Opportunities.')
      return
    }
    setSavingId(entry.id)
    const normalized = normalizeIdeaName(entry.name)
    let candidate = null

    const { data: existing, error: existingError } = await supabase
      .from('idea_candidates')
      .select('id, ingredient_name, ingredient_name_normalized, category, stage')
      .eq('ingredient_name_normalized', normalized)
      .maybeSingle()

    if (existingError) {
      alert(existingError.message)
      setSavingId(null)
      return
    }

    if (existing) {
      candidate = existing
    } else {
      const { data: inserted, error: insertError } = await supabase
        .from('idea_candidates')
        .insert({
          ingredient_name: entry.name,
          ingredient_name_normalized: normalized,
          category: categoryText(entry, categoryMap),
          stage: 'inbox',
          source_poe: false,
          source_datarova: Boolean(Number(entry.latest_clicks || 0)),
          source_count: 1,
          surfaced_week: new Date().toISOString().slice(0, 10),
          notes: entry.strategic_read || entry.scoring_notes || null,
          in_toniiq_catalog: false,
        })
        .select('id, ingredient_name, ingredient_name_normalized, category, stage')
        .single()
      if (insertError) {
        alert(insertError.message)
        setSavingId(null)
        return
      }
      candidate = inserted
    }

    async function saveReview(source) {
      return supabase
      .from('opportunity_reviews')
      .upsert({
        candidate_id: candidate.id,
        source,
        status: 'new',
        priority: entry.strategic_score >= 85 ? 'urgent' : entry.strategic_score >= 70 ? 'high' : entry.strategic_score >= 50 ? 'medium' : 'low',
        signal_type: 'category_atlas',
        signal_tags: [...(entry.source_categories || [entry.category_id]), entry.recommendation_label, entry.score_confidence].filter(Boolean),
        toniiq_fit_score: entry.strategic_score,
        confidence: entry.score_confidence || 'medium',
        rationale: entry.strategic_read || entry.scoring_notes,
        next_action: entry.next_action || 'Review this category-atlas opportunity and decide whether to run Phase A research.',
        source_context: sourceContext(entry, categoryMap),
        initial_hypothesis: entry.strategic_read || null,
        reviewed_at: new Date().toISOString(),
      }, { onConflict: 'candidate_id' })
      .select()
      .single()
    }

    let { data: review, error: reviewError } = await saveReview('category_atlas')
    if (reviewError && /source|check constraint|category_atlas/i.test(reviewError.message || '')) {
      const fallback = await saveReview('codex')
      review = fallback.data
      reviewError = fallback.error
    }

    if (reviewError) {
      alert(reviewError.message)
      setSavingId(null)
      return
    }

    await supabase.from('category_atlas_entries').update({ promoted_review_id: review.id }).eq('id', entry.id)
    setEntries(prev => prev.map(item => item.id === entry.id ? { ...item, promoted_review_id: review.id } : item))
    setSavingId(null)
  }

  if (loading) return <div className="flex min-h-[60vh] items-center justify-center text-sm" style={{ color: 'var(--text-faint)' }}>Loading category atlas...</div>

  if (error) {
    return (
      <div className="p-6">
        <div className="rounded-md border p-4 text-sm" style={{ borderColor: 'rgba(248,113,113,0.3)', color: 'var(--red-text)', background: 'var(--red-muted)' }}>
          {error}
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen">
      <div className="border-b px-6 py-5" style={{ borderColor: 'var(--border-default)', background: 'var(--bg-base)' }}>
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <h1 className="text-2xl font-semibold" style={{ color: 'var(--text-primary)' }}>Category Atlas</h1>
            <p className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>
              Category-first opportunity map scored through hybrid Amazon discovery, lane classification, and Keepa enrichment.
            </p>
            <div className="mt-3 flex flex-wrap gap-2 text-xs">
              <MetricPill label={`${entries.length} entries`} />
              <MetricPill label={`${stats.scoreable} scoreable niches`} tone="blue" />
              <MetricPill label={`${stats.families} family rows`} />
              <MetricPill label={`${stats.scored} scored`} tone="green" />
              <MetricPill label={`${stats.pending} pending`} />
              {currentImport?.source === 'bundled_preview' && <MetricPill label="preview data" tone="amber" />}
            </div>
          </div>
          <div className="flex w-full flex-col gap-2 xl:w-auto xl:min-w-[760px]">
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                value={search}
                onChange={event => setSearch(event.target.value)}
                placeholder="Search entries, families, keywords, Toniiq notes"
                className="t-input h-10 min-w-0 flex-1 px-3 text-sm"
              />
              <select value={sortBy} onChange={event => setSortBy(event.target.value)} className="t-input h-10 px-3 text-sm">
                {SORT_OPTIONS.map(option => <option key={option.key} value={option.key}>{option.label}</option>)}
              </select>
              <select value={recommendationFilter} onChange={event => setRecommendationFilter(event.target.value)} className="t-input h-10 px-3 text-sm">
                <option value="all">All recommendations</option>
                {Object.entries(RECOMMENDATION_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
              </select>
              <select value={statusFilter} onChange={event => setStatusFilter(event.target.value)} className="t-input h-10 px-3 text-sm">
                <option value="all">All status</option>
                <option value="pending_hybrid">Pending Hybrid</option>
                <option value="pending_v4">Pending</option>
                <option value="hybrid_scoring">Scoring</option>
                <option value="scoring">Scoring</option>
                <option value="hybrid_scored">Done</option>
                <option value="scored">Done</option>
                <option value="audit_failed">Audit Failed</option>
                <option value="not_scored">Family</option>
                <option value="failed">Failed</option>
              </select>
            </div>
            <div className="flex flex-wrap gap-1">
              <FilterChip active={categoryFilter === 'all'} onClick={() => setCategoryFilter('all')}>All</FilterChip>
              {categories.map(category => (
                <FilterChip key={category.id} active={categoryFilter === category.id} onClick={() => setCategoryFilter(category.id)}>
                  {category.label}
                </FilterChip>
              ))}
              <span className="mx-1 h-6 border-l" style={{ borderColor: 'var(--border-default)' }} />
              <FilterChip active={roleFilter === 'scored_niche'} onClick={() => setRoleFilter('scored_niche')}>Scoreable</FilterChip>
              <FilterChip active={roleFilter === 'parent_family'} onClick={() => setRoleFilter('parent_family')}>Families</FilterChip>
              <FilterChip active={roleFilter === 'all'} onClick={() => setRoleFilter('all')}>All rows</FilterChip>
            </div>
            <details className="w-fit text-xs" style={{ color: 'var(--text-muted)' }}>
              <summary className="cursor-pointer">Scoring tools</summary>
              <div className="mt-2 flex items-center gap-3 rounded-md border p-3" style={{ borderColor: 'var(--border-default)', background: 'var(--bg-card)' }}>
                <span>Admin action: score the next 5 pending rows with Apify + Keepa + Datarova.</span>
                <button onClick={runScoringBatch} disabled={scoring} className="t-btn h-8 shrink-0 px-3 text-xs">
                  {scoring ? 'Scoring...' : 'Score next 5'}
                </button>
              </div>
            </details>
          </div>
        </div>
      </div>

      <div className="grid xl:grid-cols-[minmax(0,1fr)_560px]">
        <main className="min-w-0 p-6">
          <div className="overflow-hidden rounded-lg border" style={{ borderColor: 'var(--border-default)', background: 'var(--bg-card)' }}>
            <div className="overflow-x-auto">
              <table className="t-table">
                <thead>
                  <tr>
                    <th>Score</th>
                    <th>Category</th>
                    <th>Opportunity</th>
                    <th>Search Target</th>
                    {SCORE_PILLARS.map(pillar => (
                      <th key={pillar.key}>{pillar.label}</th>
                    ))}
                    <th>Gate</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleEntries.map(entry => (
                    <EntryRow
                      key={entry.id}
                      entry={entry}
                      selected={selected?.id === entry.id}
                      category={categoryText(entry, categoryMap)}
                      saving={savingId === entry.id}
                      onSelect={() => setSelectedId(entry.id)}
                      onPromote={() => addToOpportunities(entry)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
            {visibleEntries.length === 0 && (
              <div className="py-16 text-center text-sm" style={{ color: 'var(--text-muted)' }}>No category atlas entries match your filters.</div>
            )}
          </div>
        </main>

        <aside className="border-l xl:sticky xl:top-0 xl:h-screen xl:overflow-y-auto" style={{ borderColor: 'var(--border-default)', background: 'var(--bg-raised)' }}>
          <EntryDrawer
            entry={selected}
            category={selected ? categoryText(selected, categoryMap) : ''}
            evidence={evidence}
            competitors={competitors}
            saving={selected && savingId === selected.id}
            onPromote={() => selected && addToOpportunities(selected)}
          />
        </aside>
      </div>
    </div>
  )
}

function MetricPill({ label, tone = 'neutral' }) {
  const style = toneStyle(tone)
  return <span className="rounded border px-2 py-1" style={style}>{label}</span>
}

function FilterChip({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className="rounded border px-2.5 py-1 text-xs"
      style={active ? toneStyle('blue') : { borderColor: 'var(--border-default)', color: 'var(--text-muted)', background: 'var(--bg-card)' }}
    >
      {children}
    </button>
  )
}

function TableBand({ item }) {
  return (
    <div className="min-w-[86px]">
      <span className="rounded border px-2 py-1 text-[11px] font-semibold" style={toneStyle(item.tone)}>
        {item.label}
      </span>
      {item.detail && <div className="mt-1 text-[10px]" style={{ color: 'var(--text-faint)' }}>{item.detail}</div>}
    </div>
  )
}

function EntryRow({ entry, selected, category, saving, onSelect, onPromote }) {
  const status = scoreStatus(entry)
  const gates = entry.competition_gate?.reasons || entry.computed_signals?.competition_gate_reasons || []
  const pillarBands = SCORE_PILLARS.map(config => {
    const record = pillarRecord(entry, config)
    return {
      key: config.key,
      band: scoreBandForPillar(record.score, config.key, tablePillarContext(entry, config.key)),
    }
  })
  return (
    <tr style={{ background: selected ? 'var(--bg-hover)' : 'transparent' }}>
      <td onClick={onSelect} className="cursor-pointer">
        <span className="rounded border px-2 py-1 text-xs font-semibold" style={toneStyle(isScoredStatus(status) ? scoreTone(entry.strategic_score) : statusTone(status))}>
          {isScoredStatus(status) ? `${entry.strategic_score}` : STATUS_LABELS[status] || status}
        </span>
      </td>
      <td onClick={onSelect} className="cursor-pointer text-xs" style={{ color: 'var(--text-muted)' }}>{category}</td>
      <td onClick={onSelect} className="cursor-pointer">
        <div className="font-medium" style={{ color: 'var(--text-primary)' }}>{entry.name}</div>
        <div className="mt-1 text-xs" style={{ color: 'var(--text-faint)' }}>
          {entry.parent_family && entry.parent_family !== entry.name ? `${entry.parent_family} · ` : ''}
          {RECOMMENDATION_LABELS[entry.recommendation_label] || entry.recommendation_label || ((entry.atlas_role || 'scored_niche') === 'scored_niche' ? 'Awaiting hybrid score' : 'Context row')} · {entry.lens || entry.niche_type || 'no lens yet'}
        </div>
      </td>
      <td onClick={onSelect} className="cursor-pointer max-w-[220px] text-xs" style={{ color: 'var(--text-muted)' }}>{entry.primary_keyword || entry.best_keyword || '-'}</td>
      {pillarBands.map(item => (
        <td key={item.key} onClick={onSelect} className="cursor-pointer"><TableBand item={item.band} /></td>
      ))}
      <td onClick={onSelect} className="cursor-pointer text-xs" style={{ color: 'var(--text-muted)' }}>{gates.length ? gateLabel(gates[0]) : '-'}</td>
      <td>
        {entry.promoted_review_id ? (
          <span className="text-xs" style={{ color: 'var(--green-text)' }}>In queue</span>
        ) : !isScoredStatus(status) ? (
          <span className="text-xs" style={{ color: 'var(--text-faint)' }}>{status === 'not_scored' ? 'Context' : 'Score first'}</span>
        ) : (
          <button onClick={onPromote} disabled={saving} className="t-btn-ghost px-2.5 py-1 text-[11px]">
            {saving ? 'Adding...' : 'Add'}
          </button>
        )}
      </td>
    </tr>
  )
}

function EntryDrawer({ entry, category, evidence, competitors, saving, onPromote }) {
  if (!entry) return <div className="p-6 text-sm" style={{ color: 'var(--text-muted)' }}>Select an entry.</div>
  const topEvidence = evidence.filter(row => row.has_data).slice(0, 10)
  const status = scoreStatus(entry)
  const snapshot = entry.competitive_snapshot?.hybrid || entry.competitive_snapshot?.keepa || {}
  const snapshotProducts = snapshot.top_products || []
  const topProducts = competitors?.length ? competitors.filter(product => product.bucket === 'included') : snapshotProducts
  const adjacentProducts = competitors?.length ? competitors.filter(product => product.bucket === 'adjacent') : (snapshot.adjacent_products || [])
  const excludedProducts = competitors?.length ? competitors.filter(product => product.bucket === 'excluded') : (snapshot.excluded_sample || [])
  const gates = entry.competition_gate?.reasons || entry.computed_signals?.competition_gate_reasons || []
  const drivers = scorePillars(entry)
  const openingRecord = pillarRecord(entry, SCORE_PILLARS.find(pillar => pillar.key === 'early_market_access'))
  const opening = scoreBandForPillar(openingRecord.score, 'early_market_access', tablePillarContext(entry, 'early_market_access'))
  const barrier = reviewBarrierBand(entry.review_moat)
  const salesRank = salesRankBand(entry.best_bsr)
  const typicalReviews = typicalReviewBand(entry.review_p50)
  const competitorSet = exactCompetitorBand(entry.exact_competitor_count)
  const targetKeyword = entry.primary_keyword || entry.best_keyword || entry.name
  const hasPillarScores = drivers.some(driver => Number.isFinite(driver.score))
  const qualityGate = qualityGateRecord(entry)

  return (
    <div className="p-5">
      <div className="mb-5">
        <div className="mb-2 flex flex-wrap gap-2">
          <SmallBadge>{category}</SmallBadge>
          <SmallBadge tone={statusTone(status)}>{STATUS_LABELS[status] || status}</SmallBadge>
          {qualityGate && <SmallBadge tone={qualityGateTone(qualityGate)}>{qualityGateLabel(qualityGate)}</SmallBadge>}
          {entry.parent_family && <SmallBadge>{entry.parent_family}</SmallBadge>}
          {entry.niche_type && <SmallBadge>{entry.niche_type.replace(/_/g, ' ')}</SmallBadge>}
          <SmallBadge>{entry.score_confidence || 'no'} confidence</SmallBadge>
          <SmallBadge>{entry.risk_level || 'low'} risk</SmallBadge>
        </div>
        <h2 className="text-xl font-semibold leading-tight" style={{ color: 'var(--text-primary)' }}>{entry.name}</h2>
        <div className="mt-2 flex items-center gap-2">
          <span className="rounded border px-2 py-1 text-sm font-semibold" style={toneStyle(isScoredStatus(status) ? scoreTone(entry.strategic_score) : statusTone(status))}>{isScoredStatus(status) ? `${entry.strategic_score}/100` : STATUS_LABELS[status] || status}</span>
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{RECOMMENDATION_LABELS[entry.recommendation_label] || entry.recommendation_label || ((entry.atlas_role || 'scored_niche') === 'scored_niche' ? 'Hybrid scoring required' : 'Context row')} · {scoreLabel(entry.strategic_score)}</span>
        </div>
      </div>

      <DrawerSection title="Score Read">
        <div className="rounded-md border p-4" style={{ borderColor: 'var(--border-default)', background: 'var(--bg-card)' }}>
          <p className="text-sm leading-relaxed" style={{ color: 'var(--text-body)' }}>{scoreSummary(entry, gates, drivers)}</p>
          {hasPillarScores && (
            <div className="mt-4 space-y-3">
              {drivers.map(driver => <ScoreDriver key={driver.key} driver={driver} />)}
            </div>
          )}
        </div>
      </DrawerSection>

      <DrawerSection title="Quality Gate">
        {!qualityGate ? (
          <div className="rounded border p-3 text-sm" style={toneStyle('neutral')}>No quality gate result stored yet.</div>
        ) : (
          <div className="rounded-md border p-3 text-xs" style={{ borderColor: toneStyle(qualityGateTone(qualityGate)).borderColor, background: 'var(--bg-card)' }}>
            <div className="mb-2 flex items-center justify-between gap-3">
              <span className="font-semibold" style={{ color: toneStyle(qualityGateTone(qualityGate)).color }}>{qualityGateLabel(qualityGate)}</span>
              <span style={{ color: 'var(--text-faint)' }}>{qualityGate.strict_modified_lane ? 'strict niche' : 'standard niche'}</span>
            </div>
            <div className="grid grid-cols-2 gap-2" style={{ color: 'var(--text-muted)' }}>
              <MiniStat label="Demand terms" value={qualityGate.checks?.demand_keyword_count ?? '-'} />
              <MiniStat label="Queries" value={qualityGate.checks?.competitor_query_count ?? '-'} />
              <MiniStat label="Included" value={qualityGate.checks?.included_count ?? '-'} />
              <MiniStat label="Source" value={qualityGate.checks?.demand_source || '-'} />
            </div>
            {qualityGate.failures?.length > 0 && (
              <div className="mt-3 rounded border p-2" style={{ borderColor: 'var(--red-muted)', color: 'var(--red-text)', background: 'rgba(248,113,113,0.08)' }}>
                {qualityGate.failures.join(', ')}
              </div>
            )}
          </div>
        )}
      </DrawerSection>

      <DrawerSection title="Action">
        <p className="mb-3 text-sm leading-relaxed" style={{ color: 'var(--text-muted)' }}>
          {isScoredStatus(status)
            ? (entry.next_action || 'Review this scored category-atlas row.')
            : (entry.atlas_role && entry.atlas_role !== 'scored_niche')
              ? 'This is a family context row. Use the child niche rows for scoring and promotion.'
              : `Pending hybrid scoring for ${targetKeyword}.`}
        </p>
        {entry.promoted_review_id ? (
          <div className="rounded border p-3 text-sm" style={toneStyle('green')}>Already added to Opportunities.</div>
        ) : !isScoredStatus(status) ? (
          <div className="rounded border p-3 text-sm" style={toneStyle('amber')}>{status === 'not_scored' ? 'Context rows are not promoted.' : 'Run hybrid scoring before adding to Opportunities.'}</div>
        ) : (
          <button onClick={onPromote} disabled={saving} className="t-btn">{saving ? 'Adding...' : 'Add to Opportunities'}</button>
        )}
      </DrawerSection>

      <DrawerSection title="Market Snapshot">
        <div className="grid grid-cols-2 gap-3">
          <SnapshotCard label="Search target" value={targetKeyword} detail={isScoredStatus(status) ? 'Hybrid query packet scored' : 'Pending hybrid scoring'} />
          <SnapshotCard label="Sales rank" value={salesRank.label} detail={salesRank.detail} tone={salesRank.tone} />
          <SnapshotCard label="Competitive opening" value={opening.label} detail={opening.detail} tone={opening.tone} />
          <SnapshotCard label="Review barrier" value={barrier.label} detail={barrier.detail} tone={barrier.tone} />
          <SnapshotCard label="Typical reviews" value={typicalReviews.label} detail={typicalReviews.detail} tone={typicalReviews.tone} />
          <SnapshotCard label="Competitor set" value={competitorSet.label} detail={competitorSet.detail} tone={competitorSet.tone} />
        </div>
        {gates.length > 0 && (
          <div className="mt-3 rounded-md border p-3 text-xs" style={{ borderColor: 'var(--border-default)', background: 'var(--bg-card)', color: 'var(--text-muted)' }}>
            Score gates: {gates.map(gateLabel).join(', ')}
          </div>
        )}
      </DrawerSection>

      <DrawerSection title="Competitors">
        {topProducts.length > 0 && (
          <div className="space-y-2">
            {topProducts.slice(0, 10).map(product => <CompetitorCard key={product.asin} product={product} />)}
          </div>
        )}
        {topProducts.length === 0 && (
          <div className="rounded border p-3 text-sm" style={toneStyle('neutral')}>No included competitor cards stored yet.</div>
        )}
        {adjacentProducts.length > 0 && (
          <details className="mt-3 rounded-md border p-3" style={{ borderColor: 'var(--border-default)', background: 'var(--bg-card)' }}>
            <summary className="cursor-pointer text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>Adjacent products ({adjacentProducts.length})</summary>
            <div className="mt-3 space-y-2">
              {adjacentProducts.slice(0, 8).map(product => <CompetitorCard key={product.asin} product={product} compact />)}
            </div>
          </details>
        )}
        {excludedProducts.length > 0 && (
          <details className="mt-3 rounded-md border p-3" style={{ borderColor: 'var(--border-default)', background: 'var(--bg-card)' }}>
            <summary className="cursor-pointer text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>Excluded sample ({excludedProducts.length})</summary>
            <div className="mt-3 space-y-2">
              {excludedProducts.slice(0, 8).map(product => <CompetitorCard key={product.asin} product={product} compact />)}
            </div>
          </details>
        )}
      </DrawerSection>

      <DrawerSection title="Score Breakdown">
        {!hasPillarScores ? (
          <div className="rounded border p-3 text-sm" style={toneStyle('neutral')}>No score breakdown until hybrid competitive scoring is complete.</div>
        ) : (
          <div className="space-y-2">
            {drivers.map(driver => (
            <div key={driver.key} className="rounded-md border p-3" style={{ borderColor: 'var(--border-default)', background: 'var(--bg-card)' }}>
              <div className="flex items-center justify-between gap-3">
                <div className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>{driver.label}</div>
                <div className="text-xs" style={{ color: 'var(--text-muted)' }}>{Number.isFinite(driver.score) ? driver.score.toFixed(1) : '-'}/10 · {Math.round((driver.weight || 0) * 100)}%</div>
              </div>
              {driver.reason && <p className="mt-1 text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>{driver.reason}</p>}
            </div>
            ))}
          </div>
        )}
      </DrawerSection>

      <DrawerSection title="Market Evidence">
        <div className="grid grid-cols-2 gap-3">
          <Readout label="Clicks" value={formatNumber(entry.latest_clicks)} />
          <Readout label="Sales" value={formatNumber(entry.latest_sales)} />
          <Readout label="Conversion" value={formatPct(entry.weighted_conversion_pct)} />
          <Readout label="Growth" value={formatGrowth(entry.best_keyword_growth)} />
        </div>
        <div className="mt-3 rounded-md border p-3 text-xs" style={{ borderColor: 'var(--border-default)', background: 'var(--bg-card)', color: 'var(--text-muted)' }}>
          Best keyword: <span style={{ color: 'var(--text-primary)' }}>{entry.best_keyword || '-'}</span>
        </div>
      </DrawerSection>

      <DrawerSection title="Strategic Read">
        <TextBlock value={entry.strategic_read || 'No strategic read stored.'} />
        {entry.toniiq_status && <ReadOnlyBlock label="Toniiq status" value={entry.toniiq_status} />}
        {entry.supplier_status && <ReadOnlyBlock label="Supplier status" value={entry.supplier_status} />}
        {entry.risk_notes && <ReadOnlyBlock label="Risk notes" value={entry.risk_notes} />}
      </DrawerSection>

      <DrawerSection title="Keyword Evidence">
        {topEvidence.length === 0 ? (
          <div className="text-sm" style={{ color: 'var(--text-muted)' }}>No keyword rows with data for this entry.</div>
        ) : (
          <KeywordTable rows={topEvidence} />
        )}
      </DrawerSection>

      <DrawerSection title="Scoring Notes">
        <TextBlock value={entry.scoring_notes || 'No scoring note stored.'} />
      </DrawerSection>
    </div>
  )
}

function DrawerSection({ title, children }) {
  return <section className="mb-5"><h3 className="mb-2 text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{title}</h3>{children}</section>
}

function ScoreDriver({ driver }) {
  const width = Number.isFinite(driver.score) ? Math.max(0, Math.min(100, driver.score * 10)) : 0
  const tone = driver.score >= 7 ? 'green' : driver.score >= 5 ? 'blue' : driver.score >= 3 ? 'amber' : 'red'
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-3">
        <div className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>{driver.label}</div>
        <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
          {Number.isFinite(driver.points) ? `${driver.points.toFixed(0)} pts` : '-'} · {Number.isFinite(driver.score) ? `${driver.score.toFixed(1)}/10` : '-'}
        </div>
      </div>
      <div className="h-2 overflow-hidden rounded-full" style={{ background: 'var(--bg-active)' }}>
        <div className="h-full rounded-full" style={{ width: `${width}%`, background: toneStyle(tone).color }} />
      </div>
      {driver.reason && <p className="mt-1 text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>{driver.reason}</p>}
    </div>
  )
}

function SnapshotCard({ label, value, detail, tone = 'neutral' }) {
  return (
    <div className="rounded-md border p-3" style={{ borderColor: toneStyle(tone).borderColor, background: 'var(--bg-card)' }}>
      <div className="text-[10px] font-semibold uppercase" style={{ color: 'var(--text-faint)' }}>{label}</div>
      <div className="mt-1 text-sm font-semibold" style={{ color: tone === 'neutral' ? 'var(--text-primary)' : toneStyle(tone).color }}>{value || '-'}</div>
      {detail && <div className="mt-1 text-[11px]" style={{ color: 'var(--text-muted)' }}>{detail}</div>}
    </div>
  )
}

function CompetitorCard({ product, compact = false }) {
  const amazonUrl = product.amazon_url || (product.asin ? `https://www.amazon.com/dp/${product.asin}` : null)
  const match = product.bucket || product.classification
  const monthlySold = product.monthly_sold_badge ?? product.monthly_sold
  return (
    <article className="rounded-md border p-3" style={{ borderColor: 'var(--border-default)', background: 'var(--bg-card)' }}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <div className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{product.brand || product.asin}</div>
            <span className="rounded border px-1.5 py-0.5 text-[10px] font-medium" style={toneStyle(productMatchTone(match))}>
              {productMatchLabel(match)}
            </span>
            {product.lane_fit && <span className="text-[10px]" style={{ color: 'var(--text-faint)' }}>{product.lane_fit.replace(/_/g, ' ')}</span>}
          </div>
          <div className="mt-1 line-clamp-2 text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>{product.title}</div>
          {!compact && product.reason && <div className="mt-2 text-[11px]" style={{ color: 'var(--text-faint)' }}>{product.reason}</div>}
        </div>
        {amazonUrl && (
          <a href={amazonUrl} target="_blank" rel="noreferrer" className="shrink-0 rounded border px-2 py-1 text-[11px]" style={{ borderColor: 'var(--border-default)', color: 'var(--text-muted)', background: 'var(--bg-active)' }}>
            Open
          </a>
        )}
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
        <MiniStat label="Rank" value={product.bsr_current ? `#${formatCompact(product.bsr_current)}` : '-'} />
        <MiniStat label="Reviews" value={formatCompact(product.reviews)} />
        <MiniStat label="Badge" value={monthlySold ? formatCompact(monthlySold) : '-'} />
      </div>
    </article>
  )
}

function MiniStat({ label, value }) {
  return (
    <div className="rounded border px-2 py-1.5" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-base)' }}>
      <div className="text-[10px] uppercase" style={{ color: 'var(--text-faint)' }}>{label}</div>
      <div className="mt-0.5 font-semibold" style={{ color: 'var(--text-primary)' }}>{value}</div>
    </div>
  )
}

function KeywordTable({ rows }) {
  return (
    <div className="overflow-hidden rounded-md border" style={{ borderColor: 'var(--border-default)', background: 'var(--bg-card)' }}>
      <table className="w-full text-xs">
        <thead style={{ color: 'var(--text-faint)', background: 'var(--bg-base)' }}>
          <tr>
            <th className="px-3 py-2 text-left font-semibold">Keyword</th>
            <th className="px-3 py-2 text-right font-semibold">Clicks</th>
            <th className="px-3 py-2 text-right font-semibold">CVR</th>
            <th className="px-3 py-2 text-right font-semibold">Growth</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(row => (
            <tr key={row.id} className="border-t" style={{ borderColor: 'var(--border-subtle)' }}>
              <td className="px-3 py-2">
                <a href={`https://www.amazon.com/s?k=${encodeURIComponent(row.keyword)}`} target="_blank" rel="noreferrer" style={{ color: 'var(--text-primary)' }}>
                  {row.keyword}
                </a>
              </td>
              <td className="px-3 py-2 text-right font-mono" style={{ color: 'var(--text-muted)' }}>{formatCompact(row.clicks)}</td>
              <td className="px-3 py-2 text-right font-mono" style={{ color: 'var(--text-muted)' }}>{formatPct(row.conversion_rate_pct)}</td>
              <td className="px-3 py-2 text-right font-mono" style={{ color: Number(row.growth_pct) >= 0 ? 'var(--green-text)' : 'var(--red-text)' }}>{formatGrowth(row.growth_pct)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function SmallBadge({ children, tone = 'neutral' }) {
  const style = tone === 'neutral'
    ? { borderColor: 'var(--border-default)', background: 'var(--bg-active)', color: 'var(--text-muted)' }
    : toneStyle(tone)
  return <span className="rounded border px-1.5 py-0.5 text-[10px] font-medium" style={style}>{children}</span>
}

function Readout({ label, value }) {
  return (
    <div className="rounded-md border p-3" style={{ borderColor: 'var(--border-default)', background: 'var(--bg-card)' }}>
      <div className="text-[10px] font-semibold uppercase" style={{ color: 'var(--text-faint)' }}>{label}</div>
      <div className="mt-1 text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{value}</div>
    </div>
  )
}

function TextBlock({ value }) {
  return <div className="rounded-md border p-3 text-sm leading-relaxed" style={{ borderColor: 'var(--border-default)', color: 'var(--text-muted)', background: 'var(--bg-card)' }}>{value}</div>
}

function ReadOnlyBlock({ label, value }) {
  return (
    <div className="mt-3">
      <div className="mb-1 text-[10px] font-semibold uppercase" style={{ color: 'var(--text-faint)' }}>{label}</div>
      <TextBlock value={value} />
    </div>
  )
}
