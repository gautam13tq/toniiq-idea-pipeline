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
  const [tab, setTab] = useState('pipeline') // 'pipeline' | 'picks'

  // Load all data on mount
  useEffect(() => {
    loadData()
  }, [])

  async function loadData() {
    setLoading(true)
    const [candidatesRes, poeRes, datarovaRes, picksRes] = await Promise.all([
      supabase.from('idea_candidates').select('*').neq('stage', 'killed'),
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

  async function submitPickFeedback(pickId, rating, notes) {
    await supabase.from('claude_weekly_picks').update({
      feedback_rating: rating,
      feedback_notes: notes,
      feedback_at: new Date().toISOString(),
    }).eq('id', pickId)
    setPicks(prev => prev.map(p => p.id === pickId ? { ...p, feedback_rating: rating, feedback_notes: notes, feedback_at: new Date().toISOString() } : p))
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-400 mx-auto mb-4"></div>
          <p className="text-slate-400">Loading pipeline data...</p>
        </div>
      </div>
    )
  }

  const data = filtered()

  return (
    <div className="min-h-screen bg-slate-900">
      {/* Header */}
      <header className="border-b border-slate-700/50 bg-slate-900/80 backdrop-blur-sm sticky top-0 z-30">
        <div className="max-w-[1600px] mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <h1 className="text-xl font-semibold text-white tracking-tight">Toniiq Idea Pipeline</h1>
              <span className="text-xs font-medium px-2 py-1 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                {candidates.length} candidates
              </span>
            </div>
            <div className="flex gap-6 items-center">
              <nav className="flex gap-4">
                <button
                  onClick={() => setTab('pipeline')}
                  className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
                    tab === 'pipeline' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Pipeline
                </button>
                <button
                  onClick={() => setTab('picks')}
                  className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors flex items-center gap-2 ${
                    tab === 'picks' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Claude's Picks
                  {picks.length > 0 && (
                    <span className="text-xs bg-amber-500/20 text-amber-300 px-1.5 py-0.5 rounded-full">
                      {picks.filter(p => !p.feedback_rating).length} new
                    </span>
                  )}
                </button>
                <Link
                  to="/concepts"
                  className="px-4 py-1.5 rounded-md text-sm font-medium text-slate-400 hover:text-white transition-colors"
                >
                  Concepts
                </Link>
              </nav>
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-[1600px] mx-auto px-6 py-4">
        {tab === 'pipeline' ? (
          <>
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
          </>
        ) : (
          <PicksView
            picks={picks}
            candidates={candidates}
            poeData={poeData}
            datarovaData={datarovaData}
            onFeedback={submitPickFeedback}
            onSelect={setSelectedId}
          />
        )}
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

// Picks tab component (inline since it's simple)
function PicksView({ picks, candidates, poeData, datarovaData, onFeedback, onSelect }) {
  const [feedbackDraft, setFeedbackDraft] = useState({})

  // Group by week
  const weeks = {}
  for (const pick of picks) {
    if (!weeks[pick.week_date]) weeks[pick.week_date] = []
    weeks[pick.week_date].push(pick)
  }

  if (Object.keys(weeks).length === 0) {
    return (
      <div className="text-center py-20">
        <div className="text-4xl mb-4">🔮</div>
        <h2 className="text-xl font-semibold text-white mb-2">No picks yet</h2>
        <p className="text-slate-400 max-w-md mx-auto">
          Claude's weekly Top 10 picks will appear here. Each week, the pipeline data is analyzed
          to surface the best opportunities, and your feedback helps improve future picks.
        </p>
      </div>
    )
  }

  const RATINGS = [
    { value: 'strong_yes', label: 'Love it', color: 'bg-green-500/20 text-green-300 border-green-500/30' },
    { value: 'yes', label: 'Good', color: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30' },
    { value: 'maybe', label: 'Maybe', color: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30' },
    { value: 'no', label: 'Pass', color: 'bg-red-500/20 text-red-300 border-red-500/30' },
    { value: 'strong_no', label: 'Bad pick', color: 'bg-red-700/20 text-red-400 border-red-700/30' },
  ]

  return (
    <div className="space-y-8">
      {Object.entries(weeks).sort(([a], [b]) => b.localeCompare(a)).map(([week, weekPicks]) => (
        <div key={week}>
          <h2 className="text-lg font-semibold text-white mb-4">
            Week of {new Date(week + 'T00:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
          </h2>
          <div className="space-y-3">
            {weekPicks.sort((a, b) => a.rank - b.rank).map(pick => {
              const candidate = candidates.find(c => c.id === pick.candidate_id)
              const poe = poeData[pick.candidate_id]
              const dr = datarovaData[pick.candidate_id]
              if (!candidate) return null

              return (
                <div key={pick.id} className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <span className="flex items-center justify-center w-7 h-7 rounded-full bg-indigo-500/20 text-indigo-300 text-sm font-bold">
                          {pick.rank}
                        </span>
                        <button
                          onClick={() => onSelect(pick.candidate_id)}
                          className="text-lg font-semibold text-white hover:text-indigo-300 transition-colors"
                        >
                          {candidate.ingredient_name}
                        </button>
                        {candidate.category && (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-slate-700 text-slate-300">
                            {candidate.category}
                          </span>
                        )}
                      </div>
                      <p className="text-slate-300 text-sm leading-relaxed mb-3">{pick.rationale}</p>
                      <div className="flex gap-4 text-xs text-slate-400">
                        {poe && <span>POE Vol: {(poe.search_volume_90d || 0).toLocaleString()}</span>}
                        {poe && <span>POE Growth: {((poe.search_volume_growth_90d || 0) * 100).toFixed(1)}%</span>}
                        {dr && <span>Datarova Growth: {((dr.search_volume_trend || 0) * 100).toFixed(1)}%</span>}
                        {dr && <span>Conv: {(dr.conversion_rate || 0).toFixed(1)}%</span>}
                      </div>
                    </div>

                    {/* Feedback section */}
                    <div className="flex-shrink-0 w-64">
                      {pick.feedback_rating ? (
                        <div className="text-center">
                          <span className={`inline-block text-xs font-medium px-3 py-1 rounded-full border ${
                            RATINGS.find(r => r.value === pick.feedback_rating)?.color || ''
                          }`}>
                            {RATINGS.find(r => r.value === pick.feedback_rating)?.label}
                          </span>
                          {pick.feedback_notes && (
                            <p className="text-xs text-slate-400 mt-2">{pick.feedback_notes}</p>
                          )}
                        </div>
                      ) : (
                        <div>
                          <div className="flex gap-1 mb-2">
                            {RATINGS.map(r => (
                              <button
                                key={r.value}
                                onClick={() => {
                                  const notes = feedbackDraft[pick.id] || ''
                                  onFeedback(pick.id, r.value, notes)
                                }}
                                className={`text-xs px-2 py-1 rounded border transition-colors hover:opacity-80 ${r.color}`}
                              >
                                {r.label}
                              </button>
                            ))}
                          </div>
                          <input
                            type="text"
                            placeholder="Optional note..."
                            className="w-full text-xs bg-slate-900 border border-slate-600 rounded px-2 py-1 text-slate-300 placeholder-slate-500"
                            value={feedbackDraft[pick.id] || ''}
                            onChange={e => setFeedbackDraft(prev => ({ ...prev, [pick.id]: e.target.value }))}
                          />
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
