import { useState, useEffect } from 'react'
import { Link, useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

function ConfidenceBar({ score }) {
  const scoreNum = typeof score === 'number' ? score : parseFloat(score) || 0
  const percentage = Math.min(100, Math.max(0, scoreNum * 10))
  let color = 'bg-red-500'
  if (scoreNum >= 8.5) color = 'bg-green-500'
  else if (scoreNum >= 7.0) color = 'bg-emerald-500'
  else if (scoreNum >= 5) color = 'bg-yellow-500'
  return (
    <div className="flex items-center gap-3">
      <div className="flex-1 h-3 bg-slate-700 rounded-full overflow-hidden max-w-sm">
        <div className={`h-full ${color} transition-all duration-300`} style={{ width: `${percentage}%` }} />
      </div>
      <span className="text-2xl font-bold text-white w-12">{scoreNum.toFixed(1)}</span>
    </div>
  )
}

function ActionButton({ onClick, disabled, children, variant = 'primary' }) {
  const baseClass = 'px-4 py-2 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed'
  const variantClass =
    variant === 'success' ? 'bg-green-600 hover:bg-green-700 text-white'
    : variant === 'danger' ? 'bg-red-600 hover:bg-red-700 text-white'
    : variant === 'secondary' ? 'bg-slate-700 hover:bg-slate-600 text-white'
    : 'bg-indigo-600 hover:bg-indigo-700 text-white'
  return (
    <button onClick={onClick} disabled={disabled} className={`${baseClass} ${variantClass}`}>
      {children}
    </button>
  )
}

function formatNumber(n) {
  if (!n && n !== 0) return '—'
  if (typeof n === 'string') n = parseFloat(n)
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K'
  return n.toLocaleString()
}

/* ─────────────────────────────────────────────────────────
   KEYWORD EVIDENCE PANEL — redesigned for readability
   Shows individual keywords line-by-line with data columns
   ───────────────────────────────────────────────────────── */
function KeywordEvidencePanel({ evidence }) {
  if (!evidence || Object.keys(evidence).length === 0) return null

  const totalClicks = evidence.total_monthly_clicks
  const growthYoy = evidence.growth_yoy_pct
  const growth3m = evidence.growth_3m_pct
  const primaryClicks = evidence.primary_keyword_clicks

  // key_signals is the main array of readable insights
  const signals = evidence.key_signals || []

  return (
    <div className="bg-slate-800/60 border border-slate-700/50 rounded-lg p-6">
      <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
        <span className="text-xl">📊</span>
        Keyword Evidence
      </h3>

      {/* Top-level stats row */}
      {(totalClicks || growthYoy || growth3m) && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
          {totalClicks && (
            <div className="bg-slate-700/30 rounded-lg p-3">
              <p className="text-xs text-slate-400 mb-1">Monthly Clicks</p>
              <p className="text-lg font-bold text-white">{formatNumber(totalClicks)}</p>
            </div>
          )}
          {primaryClicks && (
            <div className="bg-slate-700/30 rounded-lg p-3">
              <p className="text-xs text-slate-400 mb-1">Primary Keyword</p>
              <p className="text-lg font-bold text-white">{formatNumber(primaryClicks)}</p>
            </div>
          )}
          {growth3m && (
            <div className="bg-slate-700/30 rounded-lg p-3">
              <p className="text-xs text-slate-400 mb-1">3-Month Growth</p>
              <p className={`text-lg font-bold ${parseFloat(growth3m) > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {parseFloat(growth3m) > 0 ? '+' : ''}{growth3m}%
              </p>
            </div>
          )}
          {growthYoy && (
            <div className="bg-slate-700/30 rounded-lg p-3">
              <p className="text-xs text-slate-400 mb-1">Year-over-Year</p>
              <p className={`text-lg font-bold ${parseFloat(growthYoy) > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {parseFloat(growthYoy) > 0 ? '+' : ''}{growthYoy}%
              </p>
            </div>
          )}
        </div>
      )}

      {/* Key signals — line by line */}
      {signals.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold text-slate-300 mb-3">Key Signals</h4>
          <div className="space-y-2">
            {signals.map((signal, i) => {
              // Parse signal for highlighting numbers/percentages
              return (
                <div key={i} className="flex items-start gap-2 text-sm">
                  <span className="text-indigo-400 mt-0.5 flex-shrink-0">•</span>
                  <span className="text-slate-200">{highlightSignal(signal)}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

// Highlight numbers, percentages, and click counts in signal text
function highlightSignal(text) {
  if (!text) return text
  // Split on numbers with % or K/M suffixes, or "X clicks" patterns
  const parts = text.split(/(\+?\d[\d,.]*%|\d[\d,.]*K|\d[\d,.]*M|\d[\d,.]+ clicks(?:\/mo)?|\d[\d,.]+% conversion)/g)
  return parts.map((part, i) => {
    if (/\+?\d[\d,.]*%/.test(part) || /\d[\d,.]*[KM]/.test(part) || /clicks/.test(part) || /conversion/.test(part)) {
      const isGrowth = part.startsWith('+') || part.includes('growth')
      return (
        <span key={i} className={`font-semibold ${isGrowth ? 'text-emerald-400' : 'text-white'}`}>
          {part}
        </span>
      )
    }
    return part
  })
}

/* ─────────────────────────────────────────────────────────
   REDDIT EVIDENCE PANEL
   ───────────────────────────────────────────────────────── */
function RedditEvidencePanel({ evidence }) {
  if (!evidence || Object.keys(evidence).length === 0) return null

  const score = evidence.reddit_score
  const signals = evidence.key_signals || []

  return (
    <div className="bg-slate-800/60 border border-slate-700/50 rounded-lg p-6">
      <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
        <span className="text-xl">💬</span>
        Reddit Research
      </h3>

      {score && (
        <div className="bg-slate-700/30 rounded-lg p-3 mb-4 inline-block">
          <p className="text-xs text-slate-400 mb-1">Reddit Score</p>
          <p className="text-2xl font-bold text-amber-300">{score}/10</p>
        </div>
      )}

      {signals.length > 0 && (
        <div className="space-y-2">
          {signals.map((signal, i) => (
            <div key={i} className="flex items-start gap-2 text-sm">
              <span className="text-amber-400 mt-0.5 flex-shrink-0">•</span>
              <span className="text-slate-200">{signal}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/* ─────────────────────────────────────────────────────────
   SCIENCE EVIDENCE PANEL
   ───────────────────────────────────────────────────────── */
function ScienceEvidencePanel({ evidence }) {
  if (!evidence || Object.keys(evidence).length === 0) return null

  const signals = evidence.key_signals || []

  return (
    <div className="bg-slate-800/60 border border-slate-700/50 rounded-lg p-6">
      <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
        <span className="text-xl">🧪</span>
        Science Evidence
      </h3>

      {signals.length > 0 && (
        <div className="space-y-2">
          {signals.map((signal, i) => (
            <div key={i} className="flex items-start gap-2 text-sm">
              <span className="text-purple-400 mt-0.5 flex-shrink-0">•</span>
              <span className="text-slate-200">{signal}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/* ─────────────────────────────────────────────────────────
   MAIN PAGE COMPONENT
   ───────────────────────────────────────────────────────── */
export default function ConceptDetailPage() {
  const { conceptId } = useParams()
  const navigate = useNavigate()
  const [concept, setConcept] = useState(null)
  const [candidate, setCandidate] = useState(null)
  const [linkedIngredients, setLinkedIngredients] = useState([]) // from junction table
  const [allConcepts, setAllConcepts] = useState([])
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    loadData()
  }, [conceptId])

  async function loadData() {
    setLoading(true)
    try {
      // Load the concept
      const { data: conceptData, error: conceptError } = await supabase
        .from('product_concepts')
        .select('*')
        .eq('id', conceptId)
        .single()

      if (conceptError) throw conceptError
      setConcept(conceptData)

      // Load the primary candidate
      if (conceptData.candidate_id) {
        const { data: candidateData } = await supabase
          .from('idea_candidates')
          .select('*')
          .eq('id', conceptData.candidate_id)
          .single()
        if (candidateData) setCandidate(candidateData)
      }

      // Load all linked ingredients via junction table
      const { data: linksData } = await supabase
        .from('concept_ingredient_links')
        .select('candidate_id, role')
        .eq('concept_id', conceptId)

      if (linksData && linksData.length > 0) {
        const linkedCandidateIds = linksData.map(l => l.candidate_id)
        const { data: linkedCandidates } = await supabase
          .from('idea_candidates')
          .select('id, ingredient_name, category')
          .in('id', linkedCandidateIds)

        if (linkedCandidates) {
          // Merge role info
          const withRoles = linkedCandidates.map(c => ({
            ...c,
            role: linksData.find(l => l.candidate_id === c.id)?.role || 'primary',
          }))
          // Sort: primary first
          withRoles.sort((a, b) => (a.role === 'primary' ? -1 : 1))
          setLinkedIngredients(withRoles)
        }
      }

      // Load all concepts for this candidate for navigation
      const { data: allConceptsData } = await supabase
        .from('product_concepts')
        .select('id, concept_name, confidence_score')
        .eq('candidate_id', conceptData.candidate_id)
        .order('confidence_score', { ascending: false })

      setAllConcepts(allConceptsData || [])
    } catch (err) {
      console.error('Error loading concept:', err)
      setMessage('Error loading concept')
    } finally {
      setLoading(false)
    }
  }

  async function updateStatus(newStatus) {
    setActionLoading(true)
    try {
      const { error } = await supabase
        .from('product_concepts')
        .update({
          status: newStatus,
          decided_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', conceptId)

      if (error) throw error

      setConcept(prev => ({
        ...prev,
        status: newStatus,
        decided_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }))
      setMessage(`Status updated to "${newStatus}"`)
      setTimeout(() => setMessage(''), 3000)
    } catch (err) {
      console.error('Error updating status:', err)
      setMessage('Error updating status')
    } finally {
      setActionLoading(false)
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
            <p className="text-slate-400">Loading concept...</p>
          </div>
        </div>
      </div>
    )
  }

  if (!concept) {
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
            <p className="text-slate-400">Concept not found</p>
            <Link to="/concepts" className="text-indigo-400 hover:text-indigo-300 mt-2 inline-block">Back to concepts</Link>
          </div>
        </div>
      </div>
    )
  }

  const currentIndex = allConcepts.findIndex(c => c.id === conceptId)
  const prevConcept = currentIndex > 0 ? allConcepts[currentIndex - 1] : null
  const nextConcept = currentIndex < allConcepts.length - 1 ? allConcepts[currentIndex + 1] : null

  // Parse key_ingredients — handle both array and object formats
  const ingredients = Array.isArray(concept.key_ingredients)
    ? concept.key_ingredients
    : concept.key_ingredients && typeof concept.key_ingredients === 'object'
      ? Object.entries(concept.key_ingredients).map(([name, data]) => ({
          ingredient: name,
          ...(typeof data === 'object' ? data : { dose: data }),
        }))
      : []

  return (
    <div className="min-h-screen bg-slate-900">
      {/* Header */}
      <header className="border-b border-slate-700/50 bg-slate-900/80 backdrop-blur-sm sticky top-0 z-30">
        <div className="max-w-[1600px] mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <Link to="/" className="text-xl font-semibold text-white hover:text-indigo-300 transition-colors">
              Toniiq Idea Pipeline
            </Link>
            <nav className="flex gap-3 items-center text-sm">
              <Link to="/" className="text-slate-400 hover:text-white transition-colors">Pipeline</Link>
              <span className="text-slate-600">/</span>
              <Link to="/concepts" className="text-slate-400 hover:text-white transition-colors">Concepts</Link>
              <span className="text-slate-600">/</span>
              <span className="text-white truncate max-w-xs">{concept.concept_name}</span>
            </nav>
          </div>
        </div>
      </header>

      <div className="max-w-[1600px] mx-auto px-6 py-8">
        {/* Back button */}
        <button
          onClick={() => navigate('/concepts')}
          className="text-indigo-400 hover:text-indigo-300 text-sm font-medium mb-6 flex items-center gap-1"
        >
          ← Back to Concepts
        </button>

        <div className="grid grid-cols-3 gap-6 mb-8">
          {/* Left column: concept overview */}
          <div className="col-span-2">
            <div className="bg-slate-800/60 border border-slate-700/50 rounded-lg p-8 mb-6">
              <div className="mb-6">
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <h1 className="text-3xl font-bold text-white mb-2">{concept.concept_name}</h1>
                    {/* Linked ingredients — bidirectional navigation */}
                    <div className="flex items-center gap-2 flex-wrap">
                      {linkedIngredients.map(ing => (
                        <Link
                          key={ing.id}
                          to={`/discovery/${ing.id}`}
                          className="inline-flex items-center gap-1.5 text-sm px-3 py-1 rounded-full bg-slate-700/50 hover:bg-indigo-500/20 border border-slate-600/50 hover:border-indigo-500/30 text-slate-300 hover:text-indigo-300 transition-all"
                        >
                          {ing.ingredient_name}
                          {ing.role === 'secondary' && (
                            <span className="text-xs text-slate-500">(secondary)</span>
                          )}
                          <span className="text-slate-500">→</span>
                        </Link>
                      ))}
                      {linkedIngredients.length === 0 && candidate && (
                        <Link
                          to={`/discovery/${candidate.id}`}
                          className="inline-flex items-center gap-1.5 text-sm px-3 py-1 rounded-full bg-slate-700/50 hover:bg-indigo-500/20 border border-slate-600/50 hover:border-indigo-500/30 text-slate-300 hover:text-indigo-300 transition-all"
                        >
                          {candidate.ingredient_name}
                          <span className="text-slate-500">→</span>
                        </Link>
                      )}
                    </div>
                  </div>
                  <span
                    className={`text-xs font-bold px-3 py-1.5 rounded-full flex-shrink-0 ${
                      concept.status === 'selected' ? 'bg-green-500/20 text-green-300'
                      : concept.status === 'rejected' ? 'bg-red-500/20 text-red-300'
                      : 'bg-slate-600/30 text-slate-300'
                    }`}
                  >
                    {concept.status}
                  </span>
                </div>

                <div className="mb-6">
                  <p className="text-sm text-slate-400 mb-2">Confidence Score</p>
                  <ConfidenceBar score={concept.confidence_score} />
                </div>
              </div>

              <div className="border-t border-slate-700/50 pt-6">
                <h2 className="text-lg font-semibold text-white mb-3">Positioning Angle</h2>
                {concept.positioning_angle ? (
                  <p className="text-lg text-slate-200 italic leading-relaxed">"{concept.positioning_angle}"</p>
                ) : (
                  <p className="text-slate-500">No positioning angle provided</p>
                )}
              </div>
            </div>

            {/* Key Ingredients table */}
            {ingredients.length > 0 && (
              <div className="bg-slate-800/60 border border-slate-700/50 rounded-lg p-6 mb-6">
                <h2 className="text-lg font-semibold text-white mb-4">Key Ingredients</h2>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-700/50">
                        <th className="text-left py-2 px-3 text-slate-400 font-medium">Ingredient</th>
                        <th className="text-left py-2 px-3 text-slate-400 font-medium">Dosage</th>
                        <th className="text-left py-2 px-3 text-slate-400 font-medium">Role</th>
                        <th className="text-left py-2 px-3 text-slate-400 font-medium">Notes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ingredients.map((ing, i) => (
                        <tr key={i} className="border-b border-slate-700/30 hover:bg-slate-700/20">
                          <td className="py-2 px-3 text-white font-medium">
                            {ing.ingredient || ing.name || '—'}
                          </td>
                          <td className="py-2 px-3 text-slate-300">{ing.dose || ing.dosage || '—'}</td>
                          <td className="py-2 px-3 text-slate-400">{ing.role || '—'}</td>
                          <td className="py-2 px-3 text-slate-500 text-xs">{ing.notes || ''}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Confidence Reasoning */}
            {concept.confidence_reasoning && (
              <div className="bg-slate-800/60 border border-slate-700/50 rounded-lg p-6">
                <h2 className="text-lg font-semibold text-white mb-3">Why This Score?</h2>
                <p className="text-slate-200 leading-relaxed">{concept.confidence_reasoning}</p>
              </div>
            )}
          </div>

          {/* Right column: actions + metadata */}
          <div>
            <div className="bg-slate-800/60 border border-slate-700/50 rounded-lg p-6 sticky top-24">
              <h3 className="text-lg font-semibold text-white mb-4">Actions</h3>

              <div className="space-y-3 mb-6">
                <ActionButton
                  onClick={() => updateStatus('selected')}
                  disabled={actionLoading || concept.status === 'selected'}
                  variant="success"
                >
                  ✓ Select for Phase B
                </ActionButton>
                <ActionButton
                  onClick={() => updateStatus('rejected')}
                  disabled={actionLoading || concept.status === 'rejected'}
                  variant="danger"
                >
                  ✕ Reject
                </ActionButton>
                {concept.status !== 'generated' && (
                  <ActionButton
                    onClick={() => updateStatus('generated')}
                    disabled={actionLoading}
                    variant="secondary"
                  >
                    ↻ Reset
                  </ActionButton>
                )}
              </div>

              {message && (
                <div className={`text-sm px-3 py-2 rounded mb-4 ${
                  message.includes('Error') ? 'bg-red-500/20 text-red-300' : 'bg-green-500/20 text-green-300'
                }`}>
                  {message}
                </div>
              )}

              {/* Metadata */}
              <div className="border-t border-slate-700/50 pt-4 space-y-3 text-sm">
                <div>
                  <p className="text-slate-400">Format</p>
                  <p className="text-slate-200">{concept.format || '—'}</p>
                </div>
                <div>
                  <p className="text-slate-400">Target Dosage</p>
                  <p className="text-slate-200">{concept.target_dosage || '—'}</p>
                </div>
                <div>
                  <p className="text-slate-400">Type</p>
                  <p className="text-slate-200">{concept.concept_type?.replace(/_/g, ' ') || '—'}</p>
                </div>
                <div>
                  <p className="text-slate-400">Rank (within ingredient)</p>
                  <p className="text-slate-200">{concept.rank_within_ingredient || '—'}</p>
                </div>
              </div>

              {/* Other concepts for same ingredient */}
              {allConcepts.length > 1 && (
                <div className="border-t border-slate-700/50 pt-4 mt-4">
                  <p className="text-sm text-slate-400 mb-2">Other concepts for this ingredient</p>
                  <div className="space-y-1.5">
                    {allConcepts.filter(c => c.id !== conceptId).map(c => (
                      <button
                        key={c.id}
                        onClick={() => navigate(`/concepts/${c.id}`)}
                        className="w-full text-left text-sm text-slate-300 hover:text-indigo-300 transition-colors py-1 flex justify-between"
                      >
                        <span className="truncate">{c.concept_name}</span>
                        <span className="text-slate-500 flex-shrink-0 ml-2">{parseFloat(c.confidence_score).toFixed(1)}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Evidence panels — REDESIGNED */}
        <div className="mb-8">
          <h2 className="text-2xl font-bold text-white mb-6">Evidence Sources</h2>
          <div className="grid grid-cols-3 gap-6">
            <KeywordEvidencePanel evidence={concept.keyword_evidence} />
            <RedditEvidencePanel evidence={concept.reddit_evidence} />
            <ScienceEvidencePanel evidence={concept.science_evidence} />
          </div>
        </div>

        {/* Navigation */}
        {(prevConcept || nextConcept) && (
          <div className="flex justify-between items-center pt-8 border-t border-slate-700/50">
            {prevConcept ? (
              <button
                onClick={() => navigate(`/concepts/${prevConcept.id}`)}
                className="text-indigo-400 hover:text-indigo-300 flex items-center gap-2 text-sm font-medium"
              >
                ← {prevConcept.concept_name}
              </button>
            ) : <div />}
            <Link to="/concepts" className="text-slate-400 hover:text-white text-sm">View all concepts</Link>
            {nextConcept ? (
              <button
                onClick={() => navigate(`/concepts/${nextConcept.id}`)}
                className="text-indigo-400 hover:text-indigo-300 flex items-center gap-2 text-sm font-medium"
              >
                {nextConcept.concept_name} →
              </button>
            ) : <div />}
          </div>
        )}
      </div>
    </div>
  )
}
