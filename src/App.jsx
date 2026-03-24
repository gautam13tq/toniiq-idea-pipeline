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
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight" style={{ color: 'var(--text-primary)' }}>
              Discovery
            </h1>
            <p className="text-sm mt-0.5" style={{ color: 'var(--text-muted)' }}>
              {candidates.length} candidates tracked across all sources
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setTab('pipeline')}
              className="px-3 py-1.5 rounded text-sm font-medium transition-colors"
              style={{
                background: tab === 'pipeline' ? 'var(--accent)' : 'transparent',
                color: tab === 'pipeline' ? 'var(--text-inverse)' : 'var(--text-muted)',
                border: tab === 'pipeline' ? 'none' : '1px solid var(--border-default)',
              }}
            >
              Pipeline
            </button>
            <button
              onClick={() => setTab('picks')}
              className="px-3 py-1.5 rounded text-sm font-medium transition-colors flex items-center gap-2"
              style={{
                background: tab === 'picks' ? 'var(--accent)' : 'transparent',
                color: tab === 'picks' ? 'var(--text-inverse)' : 'var(--text-muted)',
                border: tab === 'picks' ? 'none' : '1px solid var(--border-default)',
              }}
            >
              Claude's Picks
              {picks.filter(p => !p.feedback_rating).length > 0 && (
                <span
                  className="text-[10px] font-bold px-1.5 py-0.5 rounded"
                  style={{ background: 'var(--green-muted)', color: 'var(--green-text)' }}
                >
                  {picks.filter(p => !p.feedback_rating).length}
                </span>
              )}
            </button>
          </div>
        </div>
      </div>

      <div className="px-6 py-4">
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
        <h2 className="text-xl font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>No picks yet</h2>
        <p className="max-w-md mx-auto" style={{ color: 'var(--text-muted)' }}>
          Claude's weekly Top 10 picks will appear here. Each week, the pipeline data is analyzed
          to surface the best opportunities, and your feedback helps improve future picks.
        </p>
      </div>
    )
  }

  const RATINGS = [
    { value: 'strong_yes', label: 'Love it', style: { background: 'var(--green-muted)', color: 'var(--green-text)', border: '1px solid rgba(74,222,128,0.3)' } },
    { value: 'yes', label: 'Good', style: { background: 'var(--green-muted)', color: 'var(--green-text)', border: '1px solid rgba(74,222,128,0.3)' } },
    { value: 'maybe', label: 'Maybe', style: { background: 'var(--amber-muted)', color: 'var(--amber-text)', border: '1px solid rgba(251,191,36,0.3)' } },
    { value: 'no', label: 'Pass', style: { background: 'var(--red-muted)', color: 'var(--red-text)', border: '1px solid rgba(248,113,113,0.3)' } },
    { value: 'strong_no', label: 'Bad pick', style: { background: 'var(--red-muted)', color: 'var(--red-text)', border: '1px solid rgba(248,113,113,0.3)' } },
  ]

  return (
    <div className="space-y-8">
      {Object.entries(weeks).sort(([a], [b]) => b.localeCompare(a)).map(([week, weekPicks]) => (
        <div key={week}>
          <h2 className="text-lg font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>
            Week of {new Date(week + 'T00:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
          </h2>
          <div className="space-y-3">
            {weekPicks.sort((a, b) => a.rank - b.rank).map(pick => {
              const candidate = candidates.find(c => c.id === pick.candidate_id)
              const poe = poeData[pick.candidate_id]
              const dr = datarovaData[pick.candidate_id]
              if (!candidate) return null

              return (
                <div key={pick.id} className="rounded-xl p-5" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)' }}>
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <span className="flex items-center justify-center w-7 h-7 rounded-full text-sm font-bold" style={{ background: 'var(--blue-muted)', color: 'var(--blue-text)' }}>
                          {pick.rank}
                        </span>
                        <Link
                          to={`/discovery/${pick.candidate_id}`}
                          className="text-lg font-semibold transition-colors"
                          style={{ color: 'var(--text-primary)' }}
                          onMouseEnter={(e) => e.target.style.color = 'var(--blue-text)'}
                          onMouseLeave={(e) => e.target.style.color = 'var(--text-primary)'}
                          onClick={(e) => e.stopPropagation()}
                        >
                          {candidate.ingredient_name}
                        </Link>
                        {candidate.category && (
                          <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: 'var(--bg-active)', color: 'var(--text-body)' }}>
                            {candidate.category}
                          </span>
                        )}
                      </div>
                      <p className="text-sm leading-relaxed mb-3" style={{ color: 'var(--text-body)' }}>{pick.rationale}</p>
                      <div className="flex gap-4 text-xs" style={{ color: 'var(--text-muted)' }}>
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
                          <span className="inline-block text-xs font-medium px-3 py-1 rounded-full border" style={RATINGS.find(r => r.value === pick.feedback_rating)?.style}>
                            {RATINGS.find(r => r.value === pick.feedback_rating)?.label}
                          </span>
                          {pick.feedback_notes && (
                            <p className="text-xs mt-2" style={{ color: 'var(--text-muted)' }}>{pick.feedback_notes}</p>
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
                                className="text-xs px-2 py-1 rounded border transition-colors hover:opacity-80"
                                style={r.style}
                              >
                                {r.label}
                              </button>
                            ))}
                          </div>
                          <input
                            type="text"
                            placeholder="Optional note..."
                            className="w-full text-xs rounded px-2 py-1"
                            style={{
                              background: 'var(--bg-base)',
                              border: '1px solid var(--border-default)',
                              color: 'var(--text-body)',
                            }}
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
