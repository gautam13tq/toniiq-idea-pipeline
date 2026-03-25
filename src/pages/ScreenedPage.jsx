import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'

const RATINGS = [
  { value: 'strong_yes', label: 'Love it', style: { background: 'var(--green-muted)', color: 'var(--green-text)', border: '1px solid rgba(74,222,128,0.3)' } },
  { value: 'yes', label: 'Good', style: { background: 'var(--green-muted)', color: 'var(--green-text)', border: '1px solid rgba(74,222,128,0.3)' } },
  { value: 'maybe', label: 'Maybe', style: { background: 'var(--amber-muted)', color: 'var(--amber-text)', border: '1px solid rgba(251,191,36,0.3)' } },
  { value: 'no', label: 'Pass', style: { background: 'var(--red-muted)', color: 'var(--red-text)', border: '1px solid rgba(248,113,113,0.3)' } },
  { value: 'strong_no', label: 'Bad pick', style: { background: 'var(--red-muted)', color: 'var(--red-text)', border: '1px solid rgba(248,113,113,0.3)' } },
]

export default function ScreenedPage() {
  const [candidates, setCandidates] = useState([])
  const [picks, setPicks] = useState([])
  const [poeData, setPoeData] = useState({})
  const [datarovaData, setDatarovaData] = useState({})
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('my_screens')
  const [feedbackDraft, setFeedbackDraft] = useState({})

  useEffect(() => {
    loadData()
  }, [])

  async function loadData() {
    setLoading(true)
    const [candidatesRes, picksRes, poeRes, datarovaRes] = await Promise.all([
      supabase
        .from('idea_candidates')
        .select('*')
        .eq('stage', 'screened')
        .order('last_updated_at', { ascending: false }),
      supabase
        .from('claude_weekly_picks')
        .select('*, idea_candidates(ingredient_name, category, stage)')
        .order('week_date', { ascending: false })
        .order('rank'),
      supabase.from('poe_snapshots').select('*'),
      supabase.from('datarova_snapshots').select('*'),
    ])

    setCandidates(candidatesRes.data || [])
    setPicks(picksRes.data || [])

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

    setLoading(false)
  }

  async function submitPickFeedback(pickId, rating, notes) {
    await supabase.from('claude_weekly_picks').update({
      feedback_rating: rating,
      feedback_notes: notes,
      feedback_at: new Date().toISOString(),
    }).eq('id', pickId)
    setPicks(prev => prev.map(p => p.id === pickId ? { ...p, feedback_rating: rating, feedback_notes: notes, feedback_at: new Date().toISOString() } : p))
  }

  const unreviewedCount = picks.filter(p => !p.feedback_rating).length

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full min-h-[60vh]">
        <div className="text-center">
          <div
            className="animate-spin rounded-full h-6 w-6 border-b-2 mx-auto mb-3"
            style={{ borderColor: 'var(--text-faint)' }}
          />
          <p style={{ color: 'var(--text-faint)' }} className="text-sm">Loading...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-5xl">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight" style={{ color: 'var(--text-primary)' }}>
          Screened
        </h1>
        <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>
          Ideas promoted from Discovery for deeper evaluation. Your screens and Claude's weekly picks.
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-6">
        <button
          onClick={() => setTab('my_screens')}
          className="px-3 py-1.5 rounded text-sm font-medium transition-colors"
          style={{
            background: tab === 'my_screens' ? 'var(--accent)' : 'transparent',
            color: tab === 'my_screens' ? 'var(--text-inverse)' : 'var(--text-muted)',
            border: tab === 'my_screens' ? 'none' : '1px solid var(--border-default)',
          }}
        >
          My Screens
          {candidates.length > 0 && (
            <span
              className="ml-2 text-[10px] font-bold px-1.5 py-0.5 rounded"
              style={{
                background: tab === 'my_screens' ? 'rgba(255,255,255,0.2)' : 'var(--bg-active)',
                color: tab === 'my_screens' ? 'var(--text-inverse)' : 'var(--text-muted)',
              }}
            >
              {candidates.length}
            </span>
          )}
        </button>
        <button
          onClick={() => setTab('claude_picks')}
          className="px-3 py-1.5 rounded text-sm font-medium transition-colors flex items-center gap-2"
          style={{
            background: tab === 'claude_picks' ? 'var(--accent)' : 'transparent',
            color: tab === 'claude_picks' ? 'var(--text-inverse)' : 'var(--text-muted)',
            border: tab === 'claude_picks' ? 'none' : '1px solid var(--border-default)',
          }}
        >
          Claude's Picks
          {unreviewedCount > 0 && (
            <span
              className="text-[10px] font-bold px-1.5 py-0.5 rounded"
              style={{ background: 'var(--green-muted)', color: 'var(--green-text)' }}
            >
              {unreviewedCount}
            </span>
          )}
        </button>
      </div>

      {/* Tab content */}
      {tab === 'my_screens' ? (
        <MyScreensView candidates={candidates} />
      ) : (
        <PicksView
          picks={picks}
          poeData={poeData}
          datarovaData={datarovaData}
          feedbackDraft={feedbackDraft}
          setFeedbackDraft={setFeedbackDraft}
          onFeedback={submitPickFeedback}
        />
      )}
    </div>
  )
}

function MyScreensView({ candidates }) {
  if (candidates.length === 0) {
    return (
      <div
        className="rounded-lg border-2 border-dashed p-12 text-center"
        style={{ borderColor: 'var(--border-default)' }}
      >
        <div className="text-4xl mb-3 opacity-30">◉</div>
        <h3 className="text-base font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>
          No screened ideas yet
        </h3>
        <p className="text-sm max-w-md mx-auto" style={{ color: 'var(--text-faint)' }}>
          Go to <Link to="/" className="underline" style={{ color: 'var(--text-primary)' }}>Discovery</Link> and
          promote promising ideas to the screened stage. This will trigger the Phase A concept research pipeline.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {candidates.map(c => (
        <Link
          key={c.id}
          to={`/discovery/${c.id}`}
          className="block rounded-lg border p-4 transition-colors"
          style={{
            background: 'var(--bg-card)',
            borderColor: 'var(--border-default)',
          }}
        >
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>
                {c.ingredient_name}
              </h3>
              {c.category && (
                <span
                  className="text-xs mt-1 inline-block px-2 py-0.5 rounded"
                  style={{ background: 'var(--bg-active)', color: 'var(--text-muted)' }}
                >
                  {c.category}
                </span>
              )}
            </div>
            <span className="text-xs" style={{ color: 'var(--text-faint)' }}>
              {c.last_updated_at ? new Date(c.last_updated_at).toLocaleDateString() : ''}
            </span>
          </div>
        </Link>
      ))}
    </div>
  )
}

function PicksView({ picks, poeData, datarovaData, feedbackDraft, setFeedbackDraft, onFeedback }) {
  // Group by week
  const weeks = {}
  for (const pick of picks) {
    if (!weeks[pick.week_date]) weeks[pick.week_date] = []
    weeks[pick.week_date].push(pick)
  }

  if (Object.keys(weeks).length === 0) {
    return (
      <div className="text-center py-20">
        <div className="text-4xl mb-4 opacity-30">◉</div>
        <h2 className="text-base font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>No picks yet</h2>
        <p className="text-sm max-w-md mx-auto" style={{ color: 'var(--text-muted)' }}>
          Claude's weekly Top 10 picks will appear here. Each week, the pipeline data is analyzed
          to surface the best opportunities, and your feedback helps improve future picks.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-8">
      {Object.entries(weeks).sort(([a], [b]) => b.localeCompare(a)).map(([week, weekPicks]) => (
        <div key={week}>
          <h2 className="text-lg font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>
            Week of {new Date(week + 'T00:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
          </h2>
          <div className="space-y-3">
            {weekPicks.sort((a, b) => a.rank - b.rank).map(pick => {
              const candidate = pick.idea_candidates
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
                        >
                          {candidate.ingredient_name}
                        </Link>
                        {candidate.category && (
                          <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: 'var(--bg-active)', color: 'var(--text-body)' }}>
                            {candidate.category}
                          </span>
                        )}
                        {candidate.stage && (
                          <span className="text-xs px-2 py-0.5 rounded" style={{ color: 'var(--text-faint)' }}>
                            {candidate.stage}
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
