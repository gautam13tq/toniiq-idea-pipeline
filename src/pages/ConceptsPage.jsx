import { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

function ConfidenceBar({ score, max = 10 }) {
  const scoreNum = typeof score === 'number' ? score : parseFloat(score) || 0
  const percentage = Math.min(100, Math.max(0, (scoreNum / max) * 100))
  let color = 'bg-red-500'
  if (percentage >= 85) color = 'bg-green-500'
  else if (percentage >= 70) color = 'bg-emerald-500'
  else if (percentage >= 50) color = 'bg-yellow-500'
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 bg-slate-700 rounded-full overflow-hidden max-w-xs">
        <div className={`h-full ${color} transition-all duration-300`} style={{ width: `${percentage}%` }} />
      </div>
      <span className="text-sm font-semibold text-white w-8">{scoreNum.toFixed(max === 100 ? 0 : 1)}</span>
    </div>
  )
}

function StatusPill({ status }) {
  const colors = {
    generated: 'bg-slate-600/30 text-slate-300',
    selected: 'bg-green-500/20 text-green-300',
    rejected: 'bg-red-500/20 text-red-300',
  }
  return (
    <span className={`text-xs font-medium px-2 py-1 rounded-full ${colors[status] || colors.generated}`}>
      {status}
    </span>
  )
}

function TierPill({ tier }) {
  const tiers = {
    immediate_launch: { label: 'Launch', class: 'bg-green-500/20 text-green-300 border-green-500/30' },
    launch_priority: { label: 'Priority', class: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30' },
    conditional: { label: 'Conditional', class: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30' },
    deprioritize: { label: 'Deprioritize', class: 'bg-orange-500/20 text-orange-300 border-orange-500/30' },
    kill: { label: 'Kill', class: 'bg-red-500/20 text-red-300 border-red-500/30' },
  }
  const t = tiers[tier] || { label: tier, class: 'bg-slate-600/30 text-slate-300 border-slate-600/30' }
  return (
    <span className={`text-xs font-bold px-2 py-0.5 rounded-full border ${t.class}`}>
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
        <span className={`text-xs px-2 py-0.5 rounded border font-medium ${
          parseFloat(compositeScore.composite_score) >= 70
            ? 'bg-green-500/15 text-green-300 border-green-500/20'
            : 'bg-yellow-500/15 text-yellow-300 border-yellow-500/20'
        }`}>
          {parseFloat(compositeScore.composite_score).toFixed(0)}/100 composite
        </span>
      )}
      {compositeScore?.recommendation_tier && (
        <TierPill tier={compositeScore.recommendation_tier} />
      )}
      {!compositeScore && kw.total_monthly_clicks && (
        <span className="text-xs px-2 py-0.5 bg-blue-500/15 text-blue-300 rounded border border-blue-500/20">
          {(kw.total_monthly_clicks / 1000).toFixed(0)}K clicks/mo
        </span>
      )}
      {!compositeScore && (kw.growth_yoy_pct || kw.growth_3m_pct) && (
        <span className="text-xs px-2 py-0.5 bg-emerald-500/15 text-emerald-300 rounded border border-emerald-500/20">
          {kw.growth_yoy_pct ? `+${kw.growth_yoy_pct}% YoY` : `+${kw.growth_3m_pct}% 3M`}
        </span>
      )}
      {!compositeScore && rd.reddit_score && (
        <span className="text-xs px-2 py-0.5 bg-amber-500/15 text-amber-300 rounded border border-amber-500/20">
          Reddit {rd.reddit_score}/10
        </span>
      )}
      {!compositeScore && sc.key_signals && sc.key_signals.length > 0 && (
        <span className="text-xs px-2 py-0.5 bg-purple-500/15 text-purple-300 rounded border border-purple-500/20">
          {sc.key_signals.length} science signals
        </span>
      )}
      {/* Show individual dimension scores for Phase B concepts */}
      {compositeScore && (
        <>
          {compositeScore.amazon_competitive_score && (
            <span className="text-xs px-2 py-0.5 bg-indigo-500/15 text-indigo-300 rounded border border-indigo-500/20">
              Amazon {compositeScore.amazon_competitive_score}/10
            </span>
          )}
          {compositeScore.differentiation_score && (
            <span className="text-xs px-2 py-0.5 bg-purple-500/15 text-purple-300 rounded border border-purple-500/20">
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
      <div className="min-h-screen bg-slate-900">
        <header className="border-b border-slate-700/50 bg-slate-900/80 backdrop-blur-sm sticky top-0 z-30">
          <div className="px-6 py-4">
            <Link to="/" className="text-xl font-semibold text-white hover:text-indigo-300 transition-colors">Toniiq Idea Pipeline</Link>
          </div>
        </header>
        <div className="flex items-center justify-center min-h-[calc(100vh-64px)]">
          <div className="text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-400 mx-auto mb-4" />
            <p className="text-slate-400">Loading concepts...</p>
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

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg-primary)' }}>
      {/* Page Header */}
      <div className="px-6 pt-6 pb-4 border-b" style={{ borderColor: 'var(--border-subtle)' }}>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight" style={{ color: 'var(--text-primary)' }}>
              Concepts
            </h1>
            <p className="text-sm mt-0.5" style={{ color: 'var(--text-secondary)' }}>
              {phaseBConcepts.length > 0
                ? `${phaseBConcepts.length} evaluated · ${phaseAOnlyConcepts.length} awaiting evaluation`
                : `${concepts.length} concepts from keyword data, Reddit research, and clinical science`}
            </p>
          </div>
          <div className="flex rounded p-0.5" style={{ background: 'var(--bg-tertiary)' }}>
            <button
              onClick={() => setViewMode('ranked')}
              className="px-3 py-1.5 rounded text-sm font-medium transition-colors"
              style={{
                background: viewMode === 'ranked' ? 'var(--accent-primary)' : 'transparent',
                color: viewMode === 'ranked' ? 'var(--text-inverse)' : 'var(--text-secondary)',
              }}
            >
              By Score
            </button>
            <button
              onClick={() => setViewMode('by-ingredient')}
              className="px-3 py-1.5 rounded text-sm font-medium transition-colors"
              style={{
                background: viewMode === 'by-ingredient' ? 'var(--accent-primary)' : 'transparent',
                color: viewMode === 'by-ingredient' ? 'var(--text-inverse)' : 'var(--text-secondary)',
              }}
            >
              By Ingredient
            </button>
          </div>
        </div>

        {viewMode === 'ranked' ? (
          <div className="space-y-12">
            {/* Phase B Evaluated Concepts — shown first */}
            {phaseBConcepts.length > 0 && (
              <div>
                <div className="flex items-center gap-3 mb-4 pb-2 border-b border-slate-700/50">
                  <h2 className="text-lg font-semibold text-white">Phase B Evaluated</h2>
                  <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300">
                    {phaseBConcepts.length}
                  </span>
                </div>
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
              </div>
            )}

            {/* Phase A tiers */}
            {phaseATiers.map(tier => (
              tier.concepts.length > 0 && (
                <div key={tier.label}>
                  <div className="flex items-center gap-3 mb-4 pb-2 border-b border-slate-700/50">
                    <h2 className="text-lg font-semibold text-white">{tier.label}</h2>
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${tier.badge}`}>
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
            ))}
          </div>
        ) : (
          <div className="space-y-10">
            {ingredientGroups.map(({ candidate, concepts: ingConcepts }) => {
              if (!candidate) return null
              return (
                <div key={candidate.id}>
                  <div className="flex items-center justify-between mb-4 pb-2 border-b border-slate-700/50">
                    <div className="flex items-center gap-3">
                      <Link to={`/discovery/${candidate.id}`} className="text-lg font-semibold text-white hover:text-indigo-300 transition-colors">
                        {candidate.ingredient_name}
                      </Link>
                      {candidate.category && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-slate-700 text-slate-300">{candidate.category}</span>
                      )}
                      <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300">
                        {ingConcepts.length} concept{ingConcepts.length !== 1 ? 's' : ''}
                      </span>
                    </div>
                    <Link to={`/discovery/${candidate.id}`} className="text-sm text-indigo-400 hover:text-indigo-300 transition-colors">
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
            <h2 className="text-xl font-semibold text-white mb-2">No concepts yet</h2>
            <p className="text-slate-400">Check back soon as the idea pipeline generates concepts.</p>
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
      className={`w-full text-left border rounded-lg p-4 transition-all duration-200 group ${
        hasPhaseB
          ? 'bg-gradient-to-r from-slate-800/80 to-slate-800/60 border-indigo-500/20 hover:border-indigo-500/40'
          : 'bg-slate-800/60 hover:bg-slate-800 border-slate-700/50 hover:border-indigo-500/30'
      }`}
    >
      <div className="flex items-start justify-between gap-4 mb-2">
        <div className="flex-1">
          <div className="flex items-center gap-3 mb-1">
            <h3 className="text-base font-semibold text-white group-hover:text-indigo-300 transition-colors">
              {concept.concept_name}
            </h3>
            <StatusPill status={concept.status} />
            {hasPhaseB && (
              <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                Phase B
              </span>
            )}
          </div>
          {!compact && candidate && (
            <p className="text-sm text-slate-400">
              From{' '}
              <span
                className="text-slate-300 hover:text-indigo-300 cursor-pointer"
                onClick={(e) => { e.stopPropagation(); navigate(`/discovery/${candidate.id}`) }}
              >
                {candidate.ingredient_name}
              </span>
              {candidate.category && <span className="text-slate-500"> · {candidate.category}</span>}
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
          <span className="text-xs px-2 py-0.5 bg-indigo-500/20 rounded text-indigo-300">
            {concept.concept_type.replace(/_/g, ' ')}
          </span>
        )}
        {concept.format && (
          <span className="text-xs px-2 py-0.5 bg-slate-700/50 rounded text-slate-300">{concept.format}</span>
        )}
        {concept.target_dosage && (
          <span className="text-xs px-2 py-0.5 bg-slate-700/50 rounded text-slate-400">{concept.target_dosage}</span>
        )}
      </div>

      {concept.positioning_angle && (
        <p className="text-sm text-slate-400 mb-2 line-clamp-2">{concept.positioning_angle}</p>
      )}

      <EvidenceSnippets concept={concept} compositeScore={compositeScore} />
    </button>
  )
}
