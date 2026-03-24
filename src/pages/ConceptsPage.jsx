import { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

function ConfidenceBar({ score }) {
  const scoreNum = typeof score === 'number' ? score : parseFloat(score) || 0
  const percentage = Math.min(100, Math.max(0, scoreNum * 10))
  let color = 'bg-red-500'
  if (scoreNum >= 8.5) color = 'bg-green-500'
  else if (scoreNum >= 7.0) color = 'bg-emerald-500'
  else if (scoreNum >= 5) color = 'bg-yellow-500'
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 bg-slate-700 rounded-full overflow-hidden max-w-xs">
        <div className={`h-full ${color} transition-all duration-300`} style={{ width: `${percentage}%` }} />
      </div>
      <span className="text-sm font-semibold text-white w-8">{scoreNum.toFixed(1)}</span>
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

function EvidenceSnippets({ concept, candidate }) {
  const kw = concept.keyword_evidence || {}
  const rd = concept.reddit_evidence || {}
  const sc = concept.science_evidence || {}

  return (
    <div className="flex flex-wrap gap-1.5 mt-2">
      {kw.total_monthly_clicks && (
        <span className="text-xs px-2 py-0.5 bg-blue-500/15 text-blue-300 rounded border border-blue-500/20">
          {(kw.total_monthly_clicks / 1000).toFixed(0)}K clicks/mo
        </span>
      )}
      {(kw.growth_yoy_pct || kw.growth_3m_pct) && (
        <span className="text-xs px-2 py-0.5 bg-emerald-500/15 text-emerald-300 rounded border border-emerald-500/20">
          {kw.growth_yoy_pct ? `+${kw.growth_yoy_pct}% YoY` : `+${kw.growth_3m_pct}% 3M`}
        </span>
      )}
      {rd.reddit_score && (
        <span className="text-xs px-2 py-0.5 bg-amber-500/15 text-amber-300 rounded border border-amber-500/20">
          Reddit {rd.reddit_score}/10
        </span>
      )}
      {sc.key_signals && sc.key_signals.length > 0 && (
        <span className="text-xs px-2 py-0.5 bg-purple-500/15 text-purple-300 rounded border border-purple-500/20">
          {sc.key_signals.length} science signals
        </span>
      )}
    </div>
  )
}

export default function ConceptsPage() {
  const [concepts, setConcepts] = useState([])
  const [candidates, setCandidates] = useState({})
  const [ingredientConceptCounts, setIngredientConceptCounts] = useState({})
  const [loading, setLoading] = useState(true)
  const [viewMode, setViewMode] = useState('ranked') // 'ranked' or 'by-ingredient'
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

      // Load concept-ingredient links to get bidirectional counts
      const { data: linksData } = await supabase
        .from('concept_ingredient_links')
        .select('concept_id, candidate_id, role')

      // Load all candidate IDs referenced by concepts or links
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

        // Build counts: how many concepts per ingredient (via links)
        const counts = {}
        for (const link of (linksData || [])) {
          counts[link.candidate_id] = (counts[link.candidate_id] || 0) + 1
        }
        setIngredientConceptCounts(counts)
      }

      setConcepts(conceptsData || [])
    } catch (err) {
      console.error('Error loading concepts:', err)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-900">
        <header className="border-b border-slate-700/50 bg-slate-900/80 backdrop-blur-sm sticky top-0 z-30">
          <div className="max-w-[1600px] mx-auto px-6 py-4">
            <Link to="/" className="text-xl font-semibold text-white hover:text-indigo-300 transition-colors">
              Toniiq Idea Pipeline
            </Link>
          </div>
        </header>
        <div className="flex items-center justify-center min-h-[calc(100vh-64px)]">
          <div className="text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-400 mx-auto mb-4"></div>
            <p className="text-slate-400">Loading concepts...</p>
          </div>
        </div>
      </div>
    )
  }

  // Group by confidence tiers
  const high = concepts.filter(c => parseFloat(c.confidence_score) >= 8.5)
  const medium = concepts.filter(c => parseFloat(c.confidence_score) >= 7.0 && parseFloat(c.confidence_score) < 8.5)
  const low = concepts.filter(c => parseFloat(c.confidence_score) < 7.0)

  const tiers = [
    { label: 'High Conviction (8.5+)', concepts: high, color: 'border-green-500/30', badge: 'bg-green-500/20 text-green-300' },
    { label: 'Good Opportunities (7.0–8.4)', concepts: medium, color: 'border-emerald-500/30', badge: 'bg-emerald-500/20 text-emerald-300' },
    { label: 'Higher Risk / Niche (<7.0)', concepts: low, color: 'border-yellow-500/30', badge: 'bg-yellow-500/20 text-yellow-300' },
  ]

  // Group by ingredient for the by-ingredient view
  const byIngredient = {}
  for (const concept of concepts) {
    const cand = candidates[concept.candidate_id]
    const name = cand?.ingredient_name || 'Unknown'
    if (!byIngredient[concept.candidate_id]) {
      byIngredient[concept.candidate_id] = { candidate: cand, concepts: [] }
    }
    byIngredient[concept.candidate_id].concepts.push(concept)
  }
  // Sort ingredient groups by best concept score
  const ingredientGroups = Object.values(byIngredient).sort(
    (a, b) => Math.max(...b.concepts.map(c => parseFloat(c.confidence_score))) - Math.max(...a.concepts.map(c => parseFloat(c.confidence_score)))
  )

  return (
    <div className="min-h-screen bg-slate-900">
      {/* Header */}
      <header className="border-b border-slate-700/50 bg-slate-900/80 backdrop-blur-sm sticky top-0 z-30">
        <div className="max-w-[1600px] mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link to="/" className="text-xl font-semibold text-white hover:text-indigo-300 transition-colors">
                Toniiq Idea Pipeline
              </Link>
              <span className="text-xs font-medium px-2 py-1 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                {concepts.length} concepts
              </span>
            </div>
            <nav className="flex gap-4 items-center">
              <Link to="/" className="text-sm text-slate-400 hover:text-white transition-colors">Pipeline</Link>
              <span className="text-slate-600">/</span>
              <span className="text-sm text-white">Concepts</span>
            </nav>
          </div>
        </div>
      </header>

      <div className="max-w-[1600px] mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-white mb-2">Product Concepts</h1>
            <p className="text-slate-400">Synthesized from keyword data, Reddit research, and clinical science.</p>
          </div>
          {/* View toggle */}
          <div className="flex bg-slate-800 rounded-lg p-1 border border-slate-700/50">
            <button
              onClick={() => setViewMode('ranked')}
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
                viewMode === 'ranked' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              By Score
            </button>
            <button
              onClick={() => setViewMode('by-ingredient')}
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
                viewMode === 'by-ingredient' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              By Ingredient
            </button>
          </div>
        </div>

        {viewMode === 'ranked' ? (
          /* ── RANKED VIEW (by confidence tier) ── */
          <div className="space-y-12">
            {tiers.map(tier => (
              tier.concepts.length > 0 && (
                <div key={tier.label}>
                  <div className="flex items-center gap-3 mb-4 pb-2 border-b border-slate-700/50">
                    <h2 className={`text-lg font-semibold text-white`}>{tier.label}</h2>
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${tier.badge}`}>
                      {tier.concepts.length}
                    </span>
                  </div>
                  <div className="space-y-3">
                    {tier.concepts.map(concept => {
                      const candidate = candidates[concept.candidate_id]
                      return (
                        <ConceptCard
                          key={concept.id}
                          concept={concept}
                          candidate={candidate}
                          navigate={navigate}
                        />
                      )
                    })}
                  </div>
                </div>
              )
            ))}
          </div>
        ) : (
          /* ── BY-INGREDIENT VIEW ── */
          <div className="space-y-10">
            {ingredientGroups.map(({ candidate, concepts: ingConcepts }) => {
              if (!candidate) return null
              const topScore = Math.max(...ingConcepts.map(c => parseFloat(c.confidence_score)))
              return (
                <div key={candidate.id}>
                  <div className="flex items-center justify-between mb-4 pb-2 border-b border-slate-700/50">
                    <div className="flex items-center gap-3">
                      <Link
                        to={`/discovery/${candidate.id}`}
                        className="text-lg font-semibold text-white hover:text-indigo-300 transition-colors"
                      >
                        {candidate.ingredient_name}
                      </Link>
                      {candidate.category && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-slate-700 text-slate-300">
                          {candidate.category}
                        </span>
                      )}
                      <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300">
                        {ingConcepts.length} concept{ingConcepts.length !== 1 ? 's' : ''}
                      </span>
                    </div>
                    <Link
                      to={`/discovery/${candidate.id}`}
                      className="text-sm text-indigo-400 hover:text-indigo-300 transition-colors"
                    >
                      View full evidence →
                    </Link>
                  </div>
                  <div className="space-y-3">
                    {ingConcepts.map(concept => (
                      <ConceptCard
                        key={concept.id}
                        concept={concept}
                        candidate={candidate}
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

function ConceptCard({ concept, candidate, navigate, compact = false }) {
  return (
    <button
      onClick={() => navigate(`/concepts/${concept.id}`)}
      className="w-full text-left bg-slate-800/60 hover:bg-slate-800 border border-slate-700/50 hover:border-indigo-500/30 rounded-lg p-4 transition-all duration-200 group"
    >
      <div className="flex items-start justify-between gap-4 mb-2">
        <div className="flex-1">
          <div className="flex items-center gap-3 mb-1">
            <h3 className="text-base font-semibold text-white group-hover:text-indigo-300 transition-colors">
              {concept.concept_name}
            </h3>
            <StatusPill status={concept.status} />
          </div>
          {!compact && candidate && (
            <p className="text-sm text-slate-400">
              From{' '}
              <span
                className="text-slate-300 hover:text-indigo-300 cursor-pointer"
                onClick={(e) => {
                  e.stopPropagation()
                  navigate(`/discovery/${candidate.id}`)
                }}
              >
                {candidate.ingredient_name}
              </span>
              {candidate.category && <span className="text-slate-500"> · {candidate.category}</span>}
            </p>
          )}
        </div>
        <div className="flex-shrink-0 w-40">
          <ConfidenceBar score={parseFloat(concept.confidence_score)} />
        </div>
      </div>

      <div className="flex items-center gap-2 mb-2 flex-wrap">
        {concept.concept_type && (
          <span className="text-xs px-2 py-0.5 bg-indigo-500/20 rounded text-indigo-300">
            {concept.concept_type.replace(/_/g, ' ')}
          </span>
        )}
        {concept.format && (
          <span className="text-xs px-2 py-0.5 bg-slate-700/50 rounded text-slate-300">
            {concept.format}
          </span>
        )}
        {concept.target_dosage && (
          <span className="text-xs px-2 py-0.5 bg-slate-700/50 rounded text-slate-400">
            {concept.target_dosage}
          </span>
        )}
      </div>

      {concept.positioning_angle && (
        <p className="text-sm text-slate-400 mb-2 line-clamp-2">
          {concept.positioning_angle}
        </p>
      )}

      <EvidenceSnippets concept={concept} candidate={candidate} />
    </button>
  )
}
