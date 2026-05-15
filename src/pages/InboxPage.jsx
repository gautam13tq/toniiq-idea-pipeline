import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import PipelineTable from '../components/PipelineTable'
import CandidateDetail from '../components/CandidateDetail'
import FilterBar from '../components/FilterBar'
import StatsBar from '../components/StatsBar'
import ResearchJobStatus from '../components/ResearchJobStatus'
import { formatGrowth, formatNumber, formatUsd } from '../lib/opportunity'

/**
 * Inbox — full Product Opportunity Explorer universe.
 * This is the source-map view for POE rows. Promoting a row adds it to
 * Opportunities; Phase A research starts from the Opportunities queue.
 */

const CATEGORIES = [
  'All Categories',
  'Gut Health', 'Longevity', 'Cognitive Health', 'Metabolic Health',
  'Immune Health', 'Heart Health', 'Joint & Bone', 'Beauty',
  "Women's Health", "Men's Health", 'Detox & Cleanse', 'Uncategorized'
]

export default function InboxPage() {
  const [candidates, setCandidates] = useState([])
  const [poeData, setPoeData] = useState({})
  const [datarovaData, setDatarovaData] = useState({})
  const [picks, setPicks] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState(null)
  const [filters, setFilters] = useState({
    search: '',
    category: 'All Categories',
    stage: 'all',
    showPicks: false,
    flaggedOnly: false,
    sortBy: 'poe_volume',
    sortDir: 'desc',
  })

  async function loadData() {
    setLoading(true)
    const [candidatesRes, poeRes, datarovaRes, picksRes] = await Promise.all([
      supabase.from('idea_candidates').select('*'),
      supabase.from('poe_snapshots').select('*'),
      supabase.from('datarova_snapshots').select('*'),
      supabase.from('claude_weekly_picks').select('*, idea_candidates(ingredient_name, category, stage)').order('week_date', { ascending: false }).order('rank'),
    ])

    const poeRows = poeRes.data || []
    const latestImportDate = poeRows.reduce((latest, row) => row.import_date > latest ? row.import_date : latest, '')
    const latestRows = poeRows.filter(row => row.import_date === latestImportDate)
    const latestIds = new Set(latestRows.map(row => row.candidate_id))
    setCandidates((candidatesRes.data || []).filter(candidate => latestIds.has(candidate.id)))

    const poeMap = {}
    for (const row of latestRows) poeMap[row.candidate_id] = row
    setPoeData(poeMap)

    const drMap = {}
    for (const row of (datarovaRes.data || [])) {
      if (!drMap[row.candidate_id] || (row.search_volume || 0) > (drMap[row.candidate_id].search_volume || 0)) drMap[row.candidate_id] = row
    }
    setDatarovaData(drMap)

    setPicks(picksRes.data || [])
    setLoading(false)
  }

  useEffect(() => {
    Promise.resolve().then(loadData)
  }, [])

  const filtered = useCallback(() => {
    let result = [...candidates]
    const { search, category, stage, showPicks, flaggedOnly, sortBy, sortDir } = filters

    if (search) {
      const q = search.toLowerCase()
      result = result.filter(c => c.ingredient_name.toLowerCase().includes(q))
    }
    if (stage !== 'all') result = result.filter(c => c.stage === stage)
    if (category === 'Uncategorized') result = result.filter(c => !c.category)
    else if (category !== 'All Categories') result = result.filter(c => c.category === category)
    if (showPicks) {
      const pickIds = new Set(picks.map(p => p.candidate_id))
      result = result.filter(c => pickIds.has(c.id))
    }
    if (flaggedOnly) {
      const flaggedIds = new Set(Object.entries(poeData).filter(([, v]) => v.flagged_high_opportunity).map(([k]) => k))
      result = result.filter(c => flaggedIds.has(c.id))
    }

    result.sort((a, b) => {
      let va, vb
      switch (sortBy) {
        case 'name':
          va = a.ingredient_name.toLowerCase(); vb = b.ingredient_name.toLowerCase()
          return sortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va)
        case 'poe_volume':
          va = poeData[a.id]?.search_volume_90d || 0; vb = poeData[b.id]?.search_volume_90d || 0; break
        case 'poe_growth':
          va = poeData[a.id]?.search_volume_growth_90d || 0; vb = poeData[b.id]?.search_volume_growth_90d || 0; break
        case 'datarova_growth':
          va = datarovaData[a.id]?.search_volume_trend || 0; vb = datarovaData[b.id]?.search_volume_trend || 0; break
        case 'datarova_conv':
          va = datarovaData[a.id]?.conversion_rate || 0; vb = datarovaData[b.id]?.conversion_rate || 0; break
        case 'sources':
          va = a.source_count || 0; vb = b.source_count || 0; break
        case 'category':
          va = (a.category || 'zzz').toLowerCase(); vb = (b.category || 'zzz').toLowerCase()
          return sortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va)
        default: va = 0; vb = 0
      }
      return sortDir === 'desc' ? (vb - va) : (va - vb)
    })

    return result
  }, [candidates, filters, poeData, datarovaData, picks])

  const selectedCandidate = candidates.find(c => c.id === selectedId)

  async function updateCandidate(id, updates) {
    await supabase.from('idea_candidates').update(updates).eq('id', id)
    setCandidates(prev => prev.map(c => c.id === id ? { ...c, ...updates } : c))
  }

  async function deleteCandidate(id) {
    // Order matters: clear orphan-prone tables before the candidate row.
    // Snapshots use SET NULL FK and would leave dangling rows; pending_actions has no FK.
    await supabase.from('poe_snapshots').delete().eq('candidate_id', id)
    await supabase.from('datarova_snapshots').delete().eq('candidate_id', id)
    await supabase.from('pending_actions').delete().eq('entity_id', id).eq('entity_type', 'idea')
    const { error } = await supabase.from('idea_candidates').delete().eq('id', id)
    if (error) {
      alert(`Delete failed: ${error.message}`)
      return
    }
    setCandidates(prev => prev.filter(c => c.id !== id))
    setPicks(prev => prev.filter(p => p.candidate_id !== id))
    setSelectedId(null)
  }

  function buildPoeContext(idea) {
    const poe = poeData[idea.id]
    const datarova = datarovaData[idea.id]
    return [
      `Inbox / POE universe row: ${idea.ingredient_name}`,
      `Current lifecycle stage: ${idea.stage}`,
      `Category: ${idea.category || 'n/a'}`,
      poe ? `Customer need: ${poe.customer_need || 'n/a'}` : null,
      poe ? `Top terms: ${[poe.top_search_term_1, poe.top_search_term_2, poe.top_search_term_3].filter(Boolean).join(', ') || 'n/a'}` : null,
      poe ? `90d search volume: ${formatNumber(poe.search_volume_90d)}` : null,
      poe ? `90d growth: ${formatGrowth(poe.search_volume_growth_90d)}` : null,
      poe ? `180d growth: ${formatGrowth(poe.search_volume_growth_180d)}` : null,
      poe ? `Avg price: ${formatUsd(poe.avg_price_usd)}` : null,
      poe ? `POE import: ${poe.import_date}` : null,
      datarova ? `Datarova keyword: ${datarova.keyword}; conversion ${datarova.conversion_rate ?? 'n/a'}%; trend ${formatGrowth(datarova.search_volume_trend)}` : null,
      'No Category Atlas or Market Atlas strategic score has been assigned in this source view.',
    ].filter(Boolean).join('\n')
  }

  async function addToOpportunities(id) {
    const idea = candidates.find(c => c.id === id)
    if (!idea) return
    const poe = poeData[id]
    const { error } = await supabase
      .from('opportunity_reviews')
      .upsert({
        candidate_id: id,
        source: 'poe',
        status: 'new',
        priority: poe?.flagged_high_opportunity ? 'high' : 'medium',
        signal_type: 'poe_universe',
        signal_tags: ['inbox', 'poe', poe?.flagged_high_opportunity ? 'high_opportunity' : null].filter(Boolean),
        toniiq_fit_score: null,
        confidence: null,
        rationale: 'Added from the full POE universe for human strategic review.',
        next_action: 'Review this POE row in Opportunities and decide whether it deserves Phase A research.',
        source_context: buildPoeContext(idea),
        reviewed_at: new Date().toISOString(),
      }, { onConflict: 'candidate_id' })
    if (error) {
      alert(`Failed to add opportunity: ${error.message}`)
      return
    }
    alert(`Added "${idea.ingredient_name}" to Opportunities.`)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 mx-auto mb-4" style={{ borderBottomColor: 'var(--blue)' }}></div>
          <p style={{ color: 'var(--text-muted)' }}>Loading POE universe...</p>
        </div>
      </div>
    )
  }

  const data = filtered()

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg-base)' }}>
      <div className="px-6 pt-6 pb-4 border-b" style={{ borderColor: 'var(--border-default)' }}>
        <h1 className="text-2xl font-bold tracking-tight" style={{ color: 'var(--text-primary)' }}>Inbox</h1>
        <p className="text-sm mt-0.5" style={{ color: 'var(--text-muted)' }}>
          {candidates.length} latest POE row{candidates.length !== 1 ? 's' : ''}. Click a row to inspect POE/Datarova data, then add the right ideas to Opportunities.
        </p>
      </div>

      <div className="px-6 py-4">
        <StatsBar candidates={candidates} poeData={poeData} datarovaData={datarovaData} />
        <FilterBar filters={filters} setFilters={setFilters} categories={CATEGORIES} resultCount={data.length} />
        <PipelineTable
          candidates={data}
          poeData={poeData}
          datarovaData={datarovaData}
          picks={picks}
          filters={filters}
          setFilters={setFilters}
          onSelect={setSelectedId}
          selectedId={selectedId}
        />
      </div>

      {selectedCandidate && (
        <CandidateDetail
          candidate={selectedCandidate}
          poe={poeData[selectedId]}
          datarova={datarovaData[selectedId]}
          picks={picks.filter(p => p.candidate_id === selectedId)}
          onClose={() => setSelectedId(null)}
          onUpdate={(updates) => updateCandidate(selectedId, updates)}
          onQueueResearch={() => addToOpportunities(selectedId)}
          onDelete={() => deleteCandidate(selectedId)}
          jobStatus={<ResearchJobStatus candidateId={selectedId} />}
          primaryActionLabel="Add to Opportunities"
        />
      )}
    </div>
  )
}
