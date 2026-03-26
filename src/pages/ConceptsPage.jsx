import { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

function ConfidenceBar({ score, max = 10 }) {
  const scoreNum = typeof score === 'number' ? score : parseFloat(score) || 0
  const percentage = Math.min(100, Math.max(0, (scoreNum / max) * 100))
  let backgroundColor = 'var(--red)'
  if (percentage >= 85) backgroundColor = 'var(--green)'
  else if (percentage >= 70) backgroundColor = 'var(--green)'
  else if (percentage >= 50) backgroundColor = 'var(--amber)'
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 rounded-full overflow-hidden max-w-xs" style={{ background: 'var(--bg-active)' }}>
        <div className="h-full transition-all duration-300" style={{ width: `${percentage}%`, background: backgroundColor }} />
      </div>
      <span className="text-sm font-semibold w-8" style={{ color: 'var(--text-primary)' }}>{scoreNum.toFixed(max === 100 ? 0 : 1)}</span>
    </div>
  )
}

function StatusPill({ status }) {
  const styleMap = {
    generated: { background: 'rgba(100,116,139,0.2)', color: 'var(--text-body)' },
    selected: { background: 'var(--green-muted)', color: 'var(--green-text)' },
    rejected: { background: 'var(--red-muted)', color: 'var(--red-text)' },
  }
  const style = styleMap[status] || styleMap.generated
  return (
    <span className="text-xs font-medium px-2 py-1 rounded-full" style={style}>
      {status}
    </span>
  )
}

function TierPill({ tier }) {
  const tiers = {
    immediate_launch: { label: 'Launch', style: { background: 'var(--green-muted)', color: 'var(--green-text)', borderColor: 'rgba(34,197,94,0.3)' } },
    launch_priority: { label: 'Priority', style: { background: 'var(--green-muted)', color: 'var(--green-text)', borderColor: 'rgba(34,197,94,0.3)' } },
    conditional: { label: 'Conditional', style: { background: 'var(--amber-muted)', color: 'var(--amber-text)', borderColor: 'rgba(217,119,6,0.3)' } },
    deprioritize: { label: 'Deprioritize', style: { background: 'var(--amber-muted)', color: 'var(--amber-text)', borderColor: 'rgba(217,119,6,0.3)' } },
    kill: { label: 'Kill', style: { background: 'var(--red-muted)', color: 'var(--red-text)', borderColor: 'rgba(239,68,68,0.3)' } },
  }
  const t = tiers[tier] || { label: tier, style: { background: 'rgba(100,116,139,0.2)', color: 'var(--text-body)', borderColor: 'rgba(100,116,139,0.3)' } }
  return (
    <span className="text-xs font-bold px-2 py-0.5 rounded-full border" style={{ ...t.style, borderStyle: 'solid', borderWidth: '1px' }}>
      {t.label}
    </span>
  )
}

function EvidenceSnippets({ concept, compositeScore }) {
  const kw = concept.keyword_evidence || {}
  const rd = concept.reddit_evidence || {}
  const sc = concept.science_evidence || {}

  return (
    <div className="flex flex-wrap gap-1.5 mt-2">
      {compositeScore && (
        <span className="text-xs px-2 py-0.5 rounded border font-medium" style={{
          background: parseFloat(compositeScore.composite_score) >= 70 ? 'var(--green-muted)' : 'var(--amber-muted)',
          color: parseFloat(compositeScore.composite_score) >= 70 ? 'var(--green-text)' : 'var(--amber-text)',
          borderColor: parseFloat(compositeScore.composite_score) >= 70 ? 'rgba(34,197,94,0.2)' : 'rgba(217,119,6,0.2)',
        }}>
          {parseFloat(compositeScore.composite_score).toFixed(0)}/100 composite
        </span>
      )}
      {compositeScore?.recommendation_tier && (
        <TierPill tier={compositeScore.recommendation_tier} />
      )}
      {!compositeScore && kw.total_monthly_clicks && (
        <span className="text-xs px-2 py-0.5 rounded border" style={{
          background: 'var(--blue-muted)',
          color: 'var(--blue-text)',
          borderColor: 'rgba(96,165,250,0.2)',
        }}>
          {(kw.total_monthly_clicks / 1000).toFixed(0)}K clicks/mo
        </span>
      )}
      {!compositeScore && (kw.growth_yoy_pct || kw.growth_3m_pct) && (
        <span className="text-xs px-2 py-0.5 rounded border" style={{
          background: 'var(--green-muted)',
          color: 'var(--green-text)',
          borderColor: 'rgba(34,197,94,0.2)',
        }}>
          {kw.growth_yoy_pct ? `+${kw.growth_yoy_pct}% YoY` : `+${kw.growth_3m_pct}% 3M`}
        </span>
      )}
      {!compositeScore && rd.reddit_score && (
        <span className="text-xs px-2 py-0.5 rounded border" style={{
          background: 'var(--amber-muted)',
          color: 'var(--amber-text)',
          borderColor: 'rgba(217,119,6,0.2)',
        }}>
          Reddit {rd.reddit_score}/10
        </span>
      )}
      {!compositeScore && sc.key_signals && sc.key_signals.length > 0 && (
        <span className="text-xs px-2 py-0.5 rounded border" style={{
          background: 'rgba(168,85,247,0.12)',
          color: '#c084fc',
          borderColor: 'rgba(168,85,247,0.2)',
        }}>
          {sc.key_signals.length} science signals
        </span>
      )}
      {/* Show individual dimension scores for Phase B concepts */}
      {compositeScore && (
        <>
          {compositeScore.amazon_competitive_score && (
            <span className="text-xs px-2 py-0.5 rounded border" style={{
              background: 'var(--blue-muted)',
              color: 'var(--blue-text)',
              borderColor: 'rgba(96,165,250,0.2)',
            }}>
              Amazon {compositeScore.amazon_competitive_score}/10
            </span>
          )}
          {compositeScore.differentiation_score && (
            <span className="text-xs px-2 py-0.5 rounded border" style={{
              background: 'rgba(168,85,247,0.12)',
              color: '#c084fc',
              borderColor: 'rgba(168,85,247,0.2)',
            }}>
              Diff {compositeScore.differentiation_score}/10
            </span>
          )}
        </>
      )}
    </div>
  )
}

export default function ConceptsPage() {
  const [concepts, setConcepts] = useState([])
  const [candidates, setCandidates] = useState({})
  const [conceptScoresMap, setConceptScoresMap] = useState({}) // concept_id -> scores
  const [loading, setLoading] = useState(true)
  const [viewMode, setViewMode] = useState('ranked')
  const [phaseTab, setPhaseTab] = useState('phase_b') // 'phase_b' or 'phase_a'
  const navigate = useNavigate()

  useEffect(() => {
    loadData()
  }, [])

  async function loadData() {
    setLoading(true)
    try {
      // Load product concepts
      const { data: conceptsData, error: conceptsError } = await supabase
        .from('product_concepts')
        .select('*')
        .order('confidence_score', { ascending: false })

      if (conceptsError) throw conceptsError

      // Load concept-ingredient links
      const { data: linksData } = await supabase
        .from('concept_ingredient_links')
        .select('concept_id, candidate_id, role')

      // Load candidates
      const candidateIds = [...new Set([
        ...conceptsData.map(c => c.candidate_id),
        ...(linksData || []).map(l => l.candidate_id),
      ])]

      if (candidateIds.length > 0) {
        const { data: candidatesData } = await supabase
          .from('idea_candidates')
          .select('id, ingredient_name, category')
          .in('id', candidateIds)

        const candidatesMap = {}
        for (const cand of (candidatesData || [])) {
          candidatesMap[cand.id] = cand
        }
        setCandidates(candidatesMap)
      }

      // Load composite scores for all concepts that have them
      const { data: scoresData } = await supabase
        .from('concept_scores')
        .select('*')

      if (scoresData) {
        const scoresMap = {}
        for (const score of scoresData) {
          // Keep the latest score per concept
          if (!scoresMap[score.concept_id] || new Date(score.scored_at) > new Date(scoresMap[score.concept_id].scored_at)) {
            scoresMap[score.concept_id] = score
          }
        }
        setConceptScoresMap(scoresMap)
      }

      setConcepts(conceptsData || [])
    } catch (err) {
      console.error('Error loading concepts:', err)
    } finally {
      setLoading(false)
    }
  }

  // Sort concepts: Phase B scored concepts first (by composite), then by confidence
  function getSortScore(concept) {
    const cs = conceptScoresMap[concept.id]
    if (cs) return 1000 + parseFloat(cs.composite_score || 0) // Phase B concepts sort first
    return parseFloat(concept.confidence_score || 0) * 10 // Phase A only
  }

  const sortedConcepts = [...concepts].sort((a, b) => getSortScore(b) - getSortScore(a))

  if (loading) {
    return (
      <div className="min-h-screen" style={{ background: 'var(--bg-base)' }}>
        <header className="border-b sticky top-0 z-30 backdrop-blur-sm" style={{ borderColor: 'var(--border-default)', background: 'var(--bg-base)' }}>
          <div className="px-6 py-4">
            <Link to="/" className="text-xl font-semibold transition-colors" style={{ color: 'var(--text-primary)' }}>Toniiq Idea Pipeline</Link>
          </div>
        </header>
        <div className="flex items-center justify-center min-h-[calc(100vh-64px)]">
          <div className="text-center">
            <div className="animate-spin rounded-full h-8 w-8 mx-auto mb-4" style={{ borderTop: '2px solid var(--text-muted)', borderRadius: '50%', borderRight: '2px solid var(--text-muted)' }} />
            <p style={{ color: 'var(--text-muted)' }}>Loading concepts...</p>
          </div>
        </div>
      </div>
    )
  }

  // Group Phase B vs Phase A only
  const phaseBConcepts = sortedConcepts.filter(c => conceptScoresMap[c.id])
  const phaseAOnlyConcepts = sortedConcepts.filter(c => !conceptScoresMap[c.id])

  // Confidence tiers (for Phase A only concepts)
  const high = phaseAOnlyConcepts.filter(c => parseFloat(c.confidence_score) >= 8.5)
  const medium = phaseAOnlyConcepts.filter(c => parseFloat(c.confidence_score) >= 7.0 && parseFloat(c.confidence_score) < 8.5)
  const low = phaseAOnlyConcepts.filter(c => parseFloat(c.confidence_score) < 7.0)

  const phaseATiers = [
    { label: 'High Conviction (8.5+)', concepts: high, badge: 'bg-green-500/20 text-green-300' },
    { label: 'Good Opportunities (7.0–8.4)', concepts: medium, badge: 'bg-emerald-500/20 text-emerald-300' },
    { label: 'Higher Risk / Niche (<7.0)', concepts: low, badge: 'bg-yellow-500/20 text-yellow-300' },
  ]

  // Group by ingredient
  const byIngredient = {}
  for (const concept of sortedConcepts) {
    const cand = candidates[concept.candidate_id]
    if (!byIngredient[concept.candidate_id]) {
      byIngredient[concept.candidate_id] = { candidate: cand, concepts: [] }
    }
    byIngredient[concept.candidate_id].concepts.push(concept)
  }
  const ingredientGroups = Object.values(byIngredient).sort(
    (a, b) => Math.max(...b.concepts.map(c => getSortScore(c))) - Math.max(...a.concepts.map(c => getSortScore(c)))
  )

  // Active concepts based on phase tab
  const activeConcepts = phaseTab === 'phase_b' ? phaseBConcepts : phaseAOnlyConcepts

  // Ingredient groups scoped to active tab
  const activeByIngredient = {}
  for (const concept of activeConcepts) {
    const cand = candidates[concept.candidate_id]
    if (!activeByIngredient[concept.candidate_id]) {
      activeByIngredient[concept.candidate_id] = { candidate: cand, concepts: [] }
    }
    activeByIngredient[concept.candidate_id].concepts.push(concept)
  }
  const activeIngredientGroups = Object.values(activeByIngredient).sort(
    (a, b) => Math.max(...b.concepts.map(c => getSortScore(c))) - Math.max(...a.concepts.map(c => getSortScore(c)))
  )

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg-base)' }}>
      {/* Page Header */}
      <div className="px-6 pt-6 pb-4">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h1 className="text-2xl font-bold tracking-tight" style={{ color: 'var(--text-primary)' }}>
              Concepts
            </h1>
            <p className="text-sm mt-0.5" style={{ color: 'var(--text-muted)' }}>
              {phaseBConcepts.length} evaluated · {phaseAOnlyConcepts.length} awaiting evaluation
            </p>
          </div>
          {/* View mode toggle — only show when there are concepts */}
          {activeConcepts.length > 0 && (
            <div className="flex rounded p-0.5" style={{ background: 'var(--bg-active)' }}>
              <button
                onClick={() => setViewMode('ranked')}
                className="px-3 py-1.5 rounded text-sm font-medium transition-colors"
                style={{
                  background: viewMode === 'ranked' ? 'var(--accent)' : 'transparent',
                  color: viewMode === 'ranked' ? 'var(--text-inverse)' : 'var(--text-muted)',
                }}
              >
                By Score
              </button>
              <button
                onClick={() => setViewMode('by-ingredient')}
                className="px-3 py-1.5 rounded text-sm font-medium transition-colors"
                style={{
                  background: viewMode === 'by-ingredient' ? 'var(--accent)' : 'transparent',
                  color: viewMode === 'by-ingredient' ? 'var(--text-inverse)' : 'var(--text-muted)',
                }}
              >
                By Ingredient
              </button>
            </div>
          )}
        </div>

        {/* Phase A / Phase B toggle tabs */}
        <div className="flex gap-2 mb-6">
          <button
            onClick={() => setPhaseTab('phase_b')}
            className="px-3 py-1.5 rounded text-sm font-medium transition-colors"
            style={{
              background: phaseTab === 'phase_b' ? 'var(--accent)' : 'transparent',
              color: phaseTab === 'phase_b' ? 'var(--text-inverse)' : 'var(--text-muted)',
              border: phaseTab === 'phase_b' ? 'none' : '1px solid var(--border-default)',
            }}
          >
            Phase B — Evaluated
            {phaseBConcepts.length > 0 && (
              <span
                className="ml-2 text-[10px] font-bold px-1.5 py-0.5 rounded"
                style={{
                  background: phaseTab === 'phase_b' ? 'rgba(255,255,255,0.2)' : 'var(--bg-active)',
                  color: phaseTab === 'phase_b' ? 'var(--text-inverse)' : 'var(--text-muted)',
                }}
              >
                {phaseBConcepts.length}
              </span>
            )}
          </button>
          <button
            onClick={() => setPhaseTab('phase_a')}
            className="px-3 py-1.5 rounded text-sm font-medium transition-colors"
            style={{
              background: phaseTab === 'phase_a' ? 'var(--accent)' : 'transparent',
              color: phaseTab === 'phase_a' ? 'var(--text-inverse)' : 'var(--text-muted)',
              border: phaseTab === 'phase_a' ? 'none' : '1px solid var(--border-default)',
            }}
          >
            Phase A — Screened
            {phaseAOnlyConcepts.length > 0 && (
              <span
                className="ml-2 text-[10px] font-bold px-1.5 py-0.5 rounded"
                style={{
                  background: phaseTab === 'phase_a' ? 'rgba(255,255,255,0.2)' : 'var(--bg-active)',
                  color: phaseTab === 'phase_a' ? 'var(--text-inverse)' : 'var(--text-muted)',
                }}
              >
                {phaseAOnlyConcepts.length}
              </span>
            )}
          </button>
        </div>

        {/* Content area */}
        {activeConcepts.length === 0 ? (
          <div className="text-center py-20">
            <div className="text-4xl mb-4 opacity-30">◉</div>
            <h2 className="text-base font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>
              {phaseTab === 'phase_b' ? 'No Phase B evaluated concepts yet' : 'No Phase A screened concepts yet'}
            </h2>
            <p className="text-sm max-w-md mx-auto" style={{ color: 'var(--text-muted)' }}>
              {phaseTab === 'phase_b'
                ? 'Run Phase B evaluation on screened concepts to see composite scores, Amazon competitive research, and differentiation analysis.'
                : 'Concepts from keyword data, Reddit research, and clinical science will appear here after Phase A screening.'}
            </p>
          </div>
        ) : viewMode === 'ranked' ? (
          <div className="space-y-12">
            {phaseTab === 'phase_b' ? (
              /* Phase B: sorted by composite score */
              <div className="space-y-3">
                {phaseBConcepts.map(concept => (
                  <ConceptCard
                    key={concept.id}
                    concept={concept}
                    candidate={candidates[concept.candidate_id]}
                    compositeScore={conceptScoresMap[concept.id]}
                    navigate={navigate}
                  />
                ))}
              </div>
            ) : (
              /* Phase A: grouped by confidence tiers */
              phaseATiers.map(tier => (
                tier.concepts.length > 0 && (
                  <div key={tier.label}>
                    <div className="flex items-center gap-3 mb-4 pb-2 border-b" style={{ borderColor: 'var(--border-default)' }}>
                      <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>{tier.label}</h2>
                      <span className="text-xs font-medium px-2 py-0.5 rounded-full" style={{
                        background: tier.label.includes('High') ? 'var(--green-muted)' : tier.label.includes('Good') ? 'var(--green-muted)' : 'var(--amber-muted)',
                        color: tier.label.includes('High') ? 'var(--green-text)' : tier.label.includes('Good') ? 'var(--green-text)' : 'var(--amber-text)',
                      }}>
                        {tier.concepts.length}
                      </span>
                    </div>
                    <div className="space-y-3">
                      {tier.concepts.map(concept => (
                        <ConceptCard
                          key={concept.id}
                          concept={concept}
                          candidate={candidates[concept.candidate_id]}
                          navigate={navigate}
                        />
                      ))}
                    </div>
                  </div>
                )
              ))
            )}
          </div>
        ) : (
          /* By Ingredient view — scoped to active tab */
          <div className="space-y-10">
            {activeIngredientGroups.map(({ candidate, concepts: ingConcepts }) => {
              if (!candidate) return null
              return (
                <div key={candidate.id}>
                  <div className="flex items-center justify-between mb-4 pb-2 border-b" style={{ borderColor: 'var(--border-default)' }}>
                    <div className="flex items-center gap-3">
                      <Link to={`/discovery/${candidate.id}`} className="text-lg font-semibold transition-colors" style={{ color: 'var(--text-primary)' }}>
                        {candidate.ingredient_name}
                      </Link>
                      {candidate.category && (
                        <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: 'var(--bg-active)', color: 'var(--text-body)' }}>{candidate.category}</span>
                      )}
                      <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: 'var(--blue-muted)', color: 'var(--blue-text)' }}>
                        {ingConcepts.length} concept{ingConcepts.length !== 1 ? 's' : ''}
                      </span>
                    </div>
                    <Link to={`/discovery/${candidate.id}`} className="text-sm transition-colors" style={{ color: 'var(--blue)' }}>
                      View full evidence →
                    </Link>
                  </div>
                  <div className="space-y-3">
                    {ingConcepts.map(concept => (
                      <ConceptCard
                        key={concept.id}
                        concept={concept}
                        candidate={candidate}
                        compositeScore={conceptScoresMap[concept.id]}
                        navigate={navigate}
                        compact
                      />
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {concepts.length === 0 && (
          <div className="text-center py-20">
            <div className="text-4xl mb-4">🔍</div>
            <h2 className="text-xl font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>No concepts yet</h2>
            <p style={{ color: 'var(--text-muted)' }}>Check back soon as the idea pipeline generates concepts.</p>
          </div>
        )}
      </div>
    </div>
  )
}

function ConceptCard({ concept, candidate, compositeScore, navigate, compact = false }) {
  const hasPhaseB = !!compositeScore
  const displayScore = hasPhaseB
    ? parseFloat(compositeScore.composite_score)
    : parseFloat(concept.confidence_score)
  const displayMax = hasPhaseB ? 100 : 10

  return (
    <button
      onClick={() => navigate(`/concepts/${concept.id}`)}
      className="w-full text-left border rounded-lg p-4 transition-all duration-200 group"
      style={{
        background: hasPhaseB ? 'var(--bg-card)' : 'var(--bg-card)',
        borderColor: hasPhaseB ? 'rgba(96,165,250,0.2)' : 'var(--border-default)',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = hasPhaseB ? 'rgba(96,165,250,0.4)' : 'rgba(96,165,250,0.3)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = hasPhaseB ? 'rgba(96,165,250,0.2)' : 'var(--border-default)'
      }}
    >
      <div className="flex items-start justify-between gap-4 mb-2">
        <div className="flex-1">
          <div className="flex items-center gap-3 mb-1">
            <h3 className="text-base font-semibold transition-colors" style={{ color: 'var(--text-primary)' }}>
              {concept.concept_name}
            </h3>
            <StatusPill status={concept.status} />
            {hasPhaseB && (
              <span className="text-xs font-medium px-2 py-0.5 rounded-full border" style={{ background: 'var(--blue-muted)', color: 'var(--blue-text)', borderColor: 'rgba(96,165,250,0.3)' }}>
                Phase B
              </span>
            )}
          </div>
          {!compact && candidate && (
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
              From{' '}
              <span
                className="cursor-pointer transition-colors"
                style={{ color: 'var(--text-body)' }}
                onClick={(e) => { e.stopPropagation(); navigate(`/discovery/${candidate.id}`) }}
              >
                {candidate.ingredient_name}
              </span>
              {candidate.category && <span style={{ color: 'var(--text-faint)' }}> · {candidate.category}</span>}
            </p>
          )}
        </div>
        <div className="flex-shrink-0 w-44">
          {hasPhaseB ? (
            <div className="flex items-center gap-2">
              <ConfidenceBar score={displayScore} max={displayMax} />
              {compositeScore.recommendation_tier && (
                <TierPill tier={compositeScore.recommendation_tier} />
              )}
            </div>
          ) : (
            <ConfidenceBar score={displayScore} max={displayMax} />
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 mb-2 flex-wrap">
        {concept.concept_type && (
          <span className="text-xs px-2 py-0.5 rounded" style={{ background: 'var(--blue-muted)', color: 'var(--blue-text)' }}>
            {concept.concept_type.replace(/_/g, ' ')}
          </span>
        )}
        {concept.format && (
          <span className="text-xs px-2 py-0.5 rounded" style={{ background: 'var(--bg-active)', color: 'var(--text-body)' }}>{concept.format}</span>
        )}
        {concept.target_dosage && (
          <span className="text-xs px-2 py-0.5 rounded" style={{ background: 'var(--bg-active)', color: 'var(--text-muted)' }}>{concept.target_dosage}</span>
        )}
      </div>

      {concept.positioning_angle && (
        <p className="text-sm mb-2 line-clamp-2" style={{ color: 'var(--text-muted)' }}>{concept.positioning_angle}</p>
      )}

      <EvidenceSnippets concept={concept} compositeScore={compositeScore} />
    </button>
  )
}
