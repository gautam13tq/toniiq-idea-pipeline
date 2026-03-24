import { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

function ConfidenceBar({ score }) {
  const scoreNum = typeof score === 'number' ? score : 0
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

function EvidenceSnippets({ concept }) {
  const snippets = []

  // Add keyword evidence snippets
  if (concept.keyword_evidence?.totalClicks) {
    snippets.push(`Clicks: ${concept.keyword_evidence.totalClicks.toLocaleString()}`)
  }
  if (concept.keyword_evidence?.growthRate) {
    snippets.push(`Growth: ${(concept.keyword_evidence.growthRate * 100).toFixed(0)}%`)
  }

  // Add reddit score
  if (concept.reddit_evidence?.redditScore) {
    snippets.push(`Reddit: ${concept.reddit_evidence.redditScore}/10`)
  }

  // Add science note
  if (concept.science_evidence && Object.keys(concept.science_evidence).length > 0) {
    snippets.push('Science backed')
  }

  return (
    <div className="flex flex-wrap gap-1">
      {snippets.slice(0, 3).map((s, i) => (
        <span key={i} className="text-xs px-2 py-0.5 bg-slate-700/50 text-slate-300 rounded">
          {s}
        </span>
      ))}
    </div>
  )
}

export default function ConceptsPage() {
  const [concepts, setConcepts] = useState([])
  const [candidates, setCandidates] = useState({})
  const [loading, setLoading] = useState(true)
  const navigate = useNavigate()

  useEffect(() => {
    loadData()
  }, [])

  async function loadData() {
    setLoading(true)
    try {
      // Load product concepts with related candidate data
      const { data: conceptsData, error: conceptsError } = await supabase
        .from('product_concepts')
        .select('*')
        .order('confidence_score', { ascending: false })

      if (conceptsError) throw conceptsError

      // Load all candidate IDs referenced by concepts
      const candidateIds = [...new Set(conceptsData.map(c => c.candidate_id))]
      if (candidateIds.length > 0) {
        const { data: candidatesData, error: candidatesError } = await supabase
          .from('idea_candidates')
          .select('id, ingredient_name, category')
          .in('id', candidateIds)

        if (candidatesError) throw candidatesError

        const candidatesMap = {}
        for (const cand of candidatesData) {
          candidatesMap[cand.id] = cand
        }
        setCandidates(candidatesMap)
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
  const high = concepts.filter(c => c.confidence_score >= 8.5)
  const medium = concepts.filter(c => c.confidence_score >= 7.0 && c.confidence_score < 8.5)
  const low = concepts.filter(c => c.confidence_score < 7.0)

  const tiers = [
    { label: 'Highly Confident (8.5+)', concepts: high, color: 'border-green-500/30' },
    { label: 'Confident (7.0-8.4)', concepts: medium, color: 'border-emerald-500/30' },
    { label: 'Emerging (<7.0)', concepts: low, color: 'border-yellow-500/30' },
  ]

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
            <nav className="flex gap-4">
              <Link to="/" className="text-sm text-slate-400 hover:text-white transition-colors">
                Pipeline
              </Link>
              <span className="text-slate-600">/</span>
              <span className="text-sm text-white">Concepts</span>
            </nav>
          </div>
        </div>
      </header>

      <div className="max-w-[1600px] mx-auto px-6 py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-white mb-2">Product Concepts</h1>
          <p className="text-slate-400">Ranked by confidence score. Click any concept for detailed evidence and actions.</p>
        </div>

        <div className="space-y-12">
          {tiers.map(tier => (
            tier.concepts.length > 0 && (
              <div key={tier.label}>
                <h2 className={`text-lg font-semibold text-white mb-4 pb-2 border-b ${tier.color}`}>
                  {tier.label}
                </h2>
                <div className="space-y-3">
                  {tier.concepts.map(concept => {
                    const candidate = candidates[concept.candidate_id]
                    return (
                      <button
                        key={concept.id}
                        onClick={() => navigate(`/concepts/${concept.id}`)}
                        className="w-full text-left bg-slate-800/60 hover:bg-slate-800 border border-slate-700/50 hover:border-indigo-500/30 rounded-lg p-4 transition-all duration-200 group"
                      >
                        <div className="flex items-start justify-between gap-4 mb-3">
                          <div className="flex-1">
                            <div className="flex items-center gap-3 mb-1">
                              <h3 className="text-lg font-semibold text-white group-hover:text-indigo-300 transition-colors">
                                {concept.concept_name}
                              </h3>
                              <StatusPill status={concept.status} />
                            </div>
                            {candidate && (
                              <p className="text-sm text-slate-400">
                                From <span className="text-slate-300">{candidate.ingredient_name}</span>
                                {candidate.category && <span className="text-slate-500"> · {candidate.category}</span>}
                              </p>
                            )}
                          </div>
                          <div className="flex-shrink-0 w-40">
                            <ConfidenceBar score={concept.confidence_score} />
                          </div>
                        </div>

                        <div className="flex items-center justify-between gap-4 mb-3">
                          <div className="flex items-center gap-3 text-sm text-slate-400">
                            {concept.format && (
                              <span className="px-2 py-1 bg-slate-700/50 rounded text-slate-300">
                                {concept.format}
                              </span>
                            )}
                            {concept.target_dosage && (
                              <span className="px-2 py-1 bg-slate-700/50 rounded text-slate-300">
                                {concept.target_dosage}
                              </span>
                            )}
                            {concept.concept_type && (
                              <span className="px-2 py-1 bg-indigo-500/20 rounded text-indigo-300 text-xs">
                                {concept.concept_type.replace(/_/g, ' ')}
                              </span>
                            )}
                          </div>
                        </div>

                        {concept.positioning_angle && (
                          <p className="text-sm text-slate-300 mb-3 italic">
                            "{concept.positioning_angle}"
                          </p>
                        )}

                        <EvidenceSnippets concept={concept} />
                      </button>
                    )
                  })}
                </div>
              </div>
            )
          ))}
        </div>

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
