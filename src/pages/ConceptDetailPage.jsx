import { useState, useEffect } from 'react'
import { Link, useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

function ConfidenceBar({ score }) {
  const scoreNum = typeof score === 'number' ? score : 0
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

function EvidencePanel({ title, evidence, icon }) {
  if (!evidence || Object.keys(evidence).length === 0) {
    return null
  }

  return (
    <div className="bg-slate-800/60 border border-slate-700/50 rounded-lg p-6">
      <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
        <span className="text-xl">{icon}</span>
        {title}
      </h3>
      <div className="space-y-3">
        {Object.entries(evidence).map(([key, value]) => {
          if (!value || (typeof value === 'object' && Object.keys(value).length === 0)) return null

          let displayValue = value
          if (typeof value === 'number') {
            displayValue = value.toLocaleString()
          } else if (typeof value === 'object') {
            displayValue = JSON.stringify(value)
          }

          return (
            <div key={key} className="text-sm">
              <dt className="text-slate-400 font-medium">{key.replace(/_/g, ' ')}</dt>
              <dd className="text-slate-200 mt-1">{String(displayValue)}</dd>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function ActionButton({ onClick, disabled, children, variant = 'primary' }) {
  const baseClass =
    'px-4 py-2 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed'
  const variantClass =
    variant === 'primary'
      ? 'bg-indigo-600 hover:bg-indigo-700 text-white'
      : variant === 'success'
        ? 'bg-green-600 hover:bg-green-700 text-white'
        : variant === 'danger'
          ? 'bg-red-600 hover:bg-red-700 text-white'
          : 'bg-slate-700 hover:bg-slate-600 text-white'

  return (
    <button onClick={onClick} disabled={disabled} className={`${baseClass} ${variantClass}`}>
      {children}
    </button>
  )
}

export default function ConceptDetailPage() {
  const { conceptId } = useParams()
  const navigate = useNavigate()
  const [concept, setConcept] = useState(null)
  const [candidate, setCandidate] = useState(null)
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

      // Load the candidate
      if (conceptData.candidate_id) {
        const { data: candidateData, error: candidateError } = await supabase
          .from('idea_candidates')
          .select('*')
          .eq('id', conceptData.candidate_id)
          .single()

        if (!candidateError && candidateData) {
          setCandidate(candidateData)
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
            <Link to="/concepts" className="text-indigo-400 hover:text-indigo-300 mt-2 inline-block">
              Back to concepts
            </Link>
          </div>
        </div>
      </div>
    )
  }

  const currentIndex = allConcepts.findIndex(c => c.id === conceptId)
  const prevConcept = currentIndex > 0 ? allConcepts[currentIndex - 1] : null
  const nextConcept = currentIndex < allConcepts.length - 1 ? allConcepts[currentIndex + 1] : null

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
            </div>
            <nav className="flex gap-3 items-center">
              <Link to="/" className="text-sm text-slate-400 hover:text-white transition-colors">
                Pipeline
              </Link>
              <span className="text-slate-600">/</span>
              <Link to="/concepts" className="text-sm text-slate-400 hover:text-white transition-colors">
                Concepts
              </Link>
              <span className="text-slate-600">/</span>
              <span className="text-sm text-white">{concept.concept_name}</span>
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

        {/* Main content */}
        <div className="grid grid-cols-3 gap-6 mb-8">
          {/* Left column: concept overview */}
          <div className="col-span-2">
            <div className="bg-slate-800/60 border border-slate-700/50 rounded-lg p-8 mb-6">
              <div className="mb-6">
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <h1 className="text-4xl font-bold text-white mb-2">{concept.concept_name}</h1>
                    {candidate && (
                      <p className="text-lg text-slate-400">
                        From <span className="text-slate-300 font-semibold">{candidate.ingredient_name}</span>
                        {candidate.category && <span className="text-slate-500"> · {candidate.category}</span>}
                      </p>
                    )}
                  </div>
                  <span
                    className={`text-xs font-bold px-3 py-1.5 rounded-full ${
                      concept.status === 'selected'
                        ? 'bg-green-500/20 text-green-300'
                        : concept.status === 'rejected'
                          ? 'bg-red-500/20 text-red-300'
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
                  <p className="text-lg text-slate-200 italic">"{concept.positioning_angle}"</p>
                ) : (
                  <p className="text-slate-500">No positioning angle provided</p>
                )}
              </div>
            </div>

            {/* Key Ingredients */}
            {concept.key_ingredients && Object.keys(concept.key_ingredients).length > 0 && (
              <div className="bg-slate-800/60 border border-slate-700/50 rounded-lg p-6 mb-6">
                <h2 className="text-lg font-semibold text-white mb-4">Key Ingredients</h2>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-700/50">
                        <th className="text-left py-2 px-3 text-slate-400">Ingredient</th>
                        <th className="text-left py-2 px-3 text-slate-400">Dosage</th>
                        <th className="text-left py-2 px-3 text-slate-400">Role</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(concept.key_ingredients).map(([name, data]) => (
                        <tr key={name} className="border-b border-slate-700/30 hover:bg-slate-700/20">
                          <td className="py-2 px-3 text-white font-medium">{name}</td>
                          <td className="py-2 px-3 text-slate-300">
                            {typeof data === 'object' && data.dosage ? data.dosage : '—'}
                          </td>
                          <td className="py-2 px-3 text-slate-400">
                            {typeof data === 'object' && data.role ? data.role : '—'}
                          </td>
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

          {/* Right column: actions */}
          <div>
            <div className="bg-slate-800/60 border border-slate-700/50 rounded-lg p-6 sticky top-24">
              <h3 className="text-lg font-semibold text-white mb-4">Actions</h3>

              <div className="space-y-3 mb-6">
                <ActionButton
                  onClick={() => updateStatus('selected')}
                  disabled={actionLoading || concept.status === 'selected'}
                  variant="success"
                >
                  ✓ Select
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
                  message.includes('Error')
                    ? 'bg-red-500/20 text-red-300'
                    : 'bg-green-500/20 text-green-300'
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
              </div>
            </div>
          </div>
        </div>

        {/* Evidence panels */}
        <div className="mb-8">
          <h2 className="text-2xl font-bold text-white mb-6">Evidence Sources</h2>
          <div className="grid grid-cols-3 gap-6">
            <EvidencePanel title="Keyword Evidence" evidence={concept.keyword_evidence} icon="📊" />
            <EvidencePanel title="Reddit Research" evidence={concept.reddit_evidence} icon="💬" />
            <EvidencePanel title="Science Evidence" evidence={concept.science_evidence} icon="🧪" />
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
            ) : (
              <div />
            )}
            <Link to="/concepts" className="text-slate-400 hover:text-white text-sm">
              View all concepts
            </Link>
            {nextConcept ? (
              <button
                onClick={() => navigate(`/concepts/${nextConcept.id}`)}
                className="text-indigo-400 hover:text-indigo-300 flex items-center gap-2 text-sm font-medium"
              >
                {nextConcept.concept_name} →
              </button>
            ) : (
              <div />
            )}
          </div>
        )}
      </div>
    </div>
  )
}
