import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from './lib/supabase'
import PipelineTable from './components/PipelineTable'
import CandidateDetail from './components/CandidateDetail'
import FilterBar from './components/FilterBar'
import StatsBar from './components/StatsBar'

const CATEGORIES = [
  'All Categories',
  'Gut Health', 'Longevity', 'Cognitive Health', 'Metabolic Health',
  'Immune Health', 'Heart Health', 'Joint & Bone', 'Beauty',
  "Women's Health", "Men's Health", 'Detox & Cleanse', 'Uncategorized'
]

const STAGES = ['all', 'raw', 'screened', 'enriched', 'scored', 'killed']

export default function App() {
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

  // Load all data on mount
  useEffect(() => {
    loadData()
  }, [])

  async function loadData() {
    setLoading(true)
    const [candidatesRes, poeRes, datarovaRes, picksRes] = await Promise.all([
      supabase.from('idea_candidates').select('*').neq('stage', 'archive'),
      supabase.from('poe_snapshots').select('*'),
      supabase.from('datarova_snapshots').select('*'),
      supabase.from('claude_weekly_picks').select('*, idea_candidates(ingredient_name, category, stage)').order('week_date', { ascending: false }).order('rank'),
    ])

    setCandidates(candidatesRes.data || [])

    // Index POE data by candidate_id (latest per candidate)
    const poeMap = {}
    for (const row of (poeRes.data || [])) {
      if (!poeMap[row.candidate_id] || row.import_date > poeMap[row.candidate_id].import_date) {
        poeMap[row.candidate_id] = row
      }
    }
    setPoeData(poeMap)

    // Index Datarova — pick best keyword per candidate (highest volume)
    const drMap = {}
    for (const row of (datarovaRes.data || [])) {
      if (!drMap[row.candidate_id] || (row.search_volume || 0) > (drMap[row.candidate_id].search_volume || 0)) {
        drMap[row.candidate_id] = row
      }
    }
    setDatarovaData(drMap)

    setPicks(picksRes.data || [])
    setLoading(false)
  }

  // Apply filters and sorting
  const filtered = useCallback(() => {
    let result = [...candidates]
    const { search, category, stage, showPicks, flaggedOnly, sortBy, sortDir } = filters

    // Search
    if (search) {
      const q = search.toLowerCase()
      result = result.filter(c => c.ingredient_name.toLowerCase().includes(q))
    }

    // Category
    if (category === 'Uncategorized') {
      result = result.filter(c => !c.category)
    } else if (category !== 'All Categories') {
      result = result.filter(c => c.category === category)
    }

    // Stage
    if (stage !== 'all') {
      result = result.filter(c => c.stage === stage)
    }

    // Claude's Picks
    if (showPicks) {
      const pickIds = new Set(picks.map(p => p.candidate_id))
      result = result.filter(c => pickIds.has(c.id))
    }

    // Flagged only
    if (flaggedOnly) {
      const flaggedIds = new Set(
        Object.entries(poeData)
          .filter(([, v]) => v.flagged_high_opportunity)
          .map(([k]) => k)
      )
      result = result.filter(c => flaggedIds.has(c.id))
    }

    // Sort
    result.sort((a, b) => {
      let va, vb
      switch (sortBy) {
        case 'name':
          va = a.ingredient_name.toLowerCase()
          vb = b.ingredient_name.toLowerCase()
          return sortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va)
        case 'poe_volume':
          va = poeData[a.id]?.search_volume_90d || 0
          vb = poeData[b.id]?.search_volume_90d || 0
          break
        case 'poe_growth':
          va = poeData[a.id]?.search_volume_growth_90d || 0
          vb = poeData[b.id]?.search_volume_growth_90d || 0
          break
        case 'datarova_growth':
          va = datarovaData[a.id]?.search_volume_trend || 0
          vb = datarovaData[b.id]?.search_volume_trend || 0
          break
        case 'datarova_conv':
          va = datarovaData[a.id]?.conversion_rate || 0
          vb = datarovaData[b.id]?.conversion_rate || 0
          break
        case 'sources':
          va = a.source_count || 0
          vb = b.source_count || 0
          break
        case 'category':
          va = (a.category || 'zzz').toLowerCase()
          vb = (b.category || 'zzz').toLowerCase()
          return sortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va)
        default:
          va = 0; vb = 0
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

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 mx-auto mb-4" style={{ borderBottomColor: 'var(--blue)' }}></div>
          <p style={{ color: 'var(--text-muted)' }}>Loading pipeline data...</p>
        </div>
      </div>
    )
  }

  const data = filtered()

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg-base)' }}>
      {/* Page Header */}
      <div className="px-6 pt-6 pb-4 border-b" style={{ borderColor: 'var(--border-default)' }}>
        <div>
          <h1 className="text-2xl font-bold tracking-tight" style={{ color: 'var(--text-primary)' }}>
            Discovery
          </h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--text-muted)' }}>
            {candidates.length} candidates tracked across all sources
          </p>
        </div>
      </div>

      <div className="px-6 py-4">
        <StatsBar candidates={candidates} poeData={poeData} datarovaData={datarovaData} />
        <FilterBar
          filters={filters}
          setFilters={setFilters}
          categories={CATEGORIES}
          resultCount={data.length}
        />
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

      {/* Detail slide-over */}
      {selectedCandidate && (
        <CandidateDetail
          candidate={selectedCandidate}
          poe={poeData[selectedId]}
          datarova={datarovaData[selectedId]}
          picks={picks.filter(p => p.candidate_id === selectedId)}
          onClose={() => setSelectedId(null)}
          onUpdate={(updates) => updateCandidate(selectedId, updates)}
        />
      )}
    </div>
  )
}
