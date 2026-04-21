import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import PipelineTable from '../components/PipelineTable'
import CandidateDetail from '../components/CandidateDetail'
import FilterBar from '../components/FilterBar'
import StatsBar from '../components/StatsBar'
import ResearchJobStatus from '../components/ResearchJobStatus'

/**
 * Inbox — raw ideas that haven't been screened yet.
 * Matches the old Discovery page quality: stats bar, filter bar, sortable
 * table with POE + Datarova data, clickable rows open CandidateDetail sidebar.
 * Promoting an idea out of Inbox queues it for Phase A research.
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

  useEffect(() => { loadData() }, [])

  async function loadData() {
    setLoading(true)
    const [candidatesRes, poeRes, datarovaRes, picksRes] = await Promise.all([
      supabase.from('idea_candidates').select('*').eq('stage', 'inbox'),
      supabase.from('poe_snapshots').select('*'),
      supabase.from('datarova_snapshots').select('*'),
      supabase.from('claude_weekly_picks').select('*, idea_candidates(ingredient_name, category, stage)').order('week_date', { ascending: false }).order('rank'),
    ])

    setCandidates(candidatesRes.data || [])

    const poeMap = {}
    for (const row of (poeRes.data || [])) {
      if (!poeMap[row.candidate_id] || row.import_date > poeMap[row.candidate_id].import_date) poeMap[row.candidate_id] = row
    }
    setPoeData(poeMap)

    const drMap = {}
    for (const row of (datarovaRes.data || [])) {
      if (!drMap[row.candidate_id] || (row.search_volume || 0) > (drMap[row.candidate_id].search_volume || 0)) drMap[row.candidate_id] = row
    }
    setDatarovaData(drMap)

    setPicks(picksRes.data || [])
    setLoading(false)
  }

  const filtered = useCallback(() => {
    let result = [...candidates]
    const { search, category, showPicks, flaggedOnly, sortBy, sortDir } = filters

    if (search) {
      const q = search.toLowerCase()
      result = result.filter(c => c.ingredient_name.toLowerCase().includes(q))
    }
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
    // If stage changed out of inbox, remove from list
    if (updates.stage && updates.stage !== 'inbox') {
      setCandidates(prev => prev.filter(c => c.id !== id))
      setSelectedId(null)
    } else {
      setCandidates(prev => prev.map(c => c.id === id ? { ...c, ...updates } : c))
    }
  }

  async function promoteToResearch(id) {
    const idea = candidates.find(c => c.id === id)
    if (!idea) return
    if (!confirm(`Run research on "${idea.ingredient_name}"? This kicks off ~5-8 minutes of automated work (keyword + Reddit + science + concept synthesis).`)) return
    // 1. Insert pending action
    const { data: action, error } = await supabase.from('pending_actions').insert({
      entity_type: 'idea', entity_id: id, action: 'run_phase_a', triggered_by: 'ui',
      context: { ingredient_name: idea.ingredient_name },
    }).select('id').single()
    if (error) { alert(`Failed to queue: ${error.message}`); return }
    // 2. Fire-and-forget invoke the Edge Function. Don't await — runs several minutes.
    supabase.functions.invoke('phase-a-gather', { body: { pending_action_id: action.id } }).catch(e => {
      console.error('Failed to invoke phase-a-gather:', e)
    })
    alert(`Research started for "${idea.ingredient_name}". Results will appear on the Research page in ~5-8 min.`)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 mx-auto mb-4" style={{ borderBottomColor: 'var(--blue)' }}></div>
          <p style={{ color: 'var(--text-muted)' }}>Loading inbox...</p>
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
          {candidates.length} raw idea{candidates.length !== 1 ? 's' : ''} not yet screened. Click a row to inspect POE/Datarova data, then queue for research.
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
          onQueueResearch={() => promoteToResearch(selectedId)}
          jobStatus={<ResearchJobStatus candidateId={selectedId} />}
        />
      )}
    </div>
  )
}
