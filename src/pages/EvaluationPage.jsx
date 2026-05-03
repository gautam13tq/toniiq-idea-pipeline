import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import PendingActionsBanner from '../components/PendingActionsBanner'

/**
 * Evaluation Page — ideas with evaluation scores. Ready for greenlight decision.
 * Shows composite score + greenlight button.
 */

const TIER_STYLE = {
  launch_priority: { bg: 'var(--green-muted)', text: 'var(--green-text)', label: 'Launch Priority' },
  strong_candidate: { bg: 'var(--blue-muted)', text: 'var(--blue-text)', label: 'Strong Candidate' },
  needs_work: { bg: 'var(--amber-muted)', text: 'var(--amber-text)', label: 'Needs Work' },
  pass: { bg: 'var(--red-muted)', text: 'var(--red-text)', label: 'Pass' },
}

export default function EvaluationPage() {
  const [ideas, setIdeas] = useState([])
  const [concepts, setConcepts] = useState([])
  const [scores, setScores] = useState({})
  const [loading, setLoading] = useState(true)

  useEffect(() => { loadData() }, [])

  async function loadData() {
    setLoading(true)
    // Show ideas at stage='evaluation' OR ideas with at least one scored concept (includes legacy
    // concepts stuck at status='accepted' from the older Cowork Phase B flow).
    const [scoresRes] = await Promise.all([
      supabase.from('concept_scores').select('concept_id,composite_score,recommendation_tier'),
    ])
    const scoreMap = {}
    for (const s of (scoresRes.data || [])) scoreMap[s.concept_id] = s
    setScores(scoreMap)

    const [conceptsRes] = await Promise.all([
      supabase.from('product_concepts').select('*').order('rank_within_ingredient'),
    ])
    const allConcepts = conceptsRes.data || []
    setConcepts(allConcepts)

    const candidatesWithScoredConcepts = new Set(
      allConcepts.filter(c => scoreMap[c.id]).map(c => c.candidate_id)
    )

    const [ideasRes] = await Promise.all([
      supabase.from('idea_candidates').select('*')
        .or(`stage.eq.evaluation,id.in.(${Array.from(candidatesWithScoredConcepts).join(',') || 'null'})`)
        .order('last_updated_at', { ascending: false }),
    ])
    setIdeas(ideasRes.data || [])
    setLoading(false)
  }

  async function updateConceptStatus(conceptId, newStatus) {
    await supabase.from('product_concepts').update({ status: newStatus, decided_at: new Date().toISOString() }).eq('id', conceptId)
    await loadData()
  }

  if (loading) {
    return <div className="flex items-center justify-center min-h-[60vh]"><div className="text-sm" style={{ color: 'var(--text-faint)' }}>Loading...</div></div>
  }

  return (
    <div className="p-6 max-w-6xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight" style={{ color: 'var(--text-primary)' }}>Evaluation</h1>
        <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>
          Evaluation complete. {ideas.length} idea{ideas.length !== 1 ? 's' : ''} with scored concepts awaiting greenlight decision.
        </p>
      </div>

      <PendingActionsBanner scope="global" />

      {ideas.length === 0 && (
        <div className="text-center py-20 rounded-md border border-dashed" style={{ borderColor: 'var(--border-default)', color: 'var(--text-muted)' }}>
          <div className="text-sm">Nothing in evaluation.</div>
        </div>
      )}

      <div className="space-y-6">
        {ideas.map(idea => {
          const ideaConcepts = concepts.filter(c => c.candidate_id === idea.id)
          return (
            <div key={idea.id} className="rounded-lg border overflow-hidden" style={{ borderColor: 'var(--border-default)', background: 'var(--bg-card)' }}>
              <div className="px-5 py-4 border-b flex items-center justify-between" style={{ borderColor: 'var(--border-default)' }}>
                <div>
                  <Link to={`/discovery/${idea.id}`} className="text-base font-semibold hover:underline" style={{ color: 'var(--text-primary)' }}>
                    {idea.ingredient_name}
                  </Link>
                  <div className="text-xs mt-0.5 flex items-center gap-3" style={{ color: 'var(--text-muted)' }}>
                    <span>{idea.category || 'Uncategorized'}</span>
                    <span>·</span>
                    <span>{ideaConcepts.length} concept{ideaConcepts.length !== 1 ? 's' : ''}</span>
                  </div>
                </div>
              </div>
              <div className="divide-y" style={{ borderColor: 'var(--border-default)' }}>
                {ideaConcepts.map(concept => {
                  const score = scores[concept.id]
                  const tier = score && TIER_STYLE[score.recommendation_tier]
                  return (
                    <div key={concept.id} className="px-5 py-4">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <Link to={`/concepts/${concept.id}`} className="text-sm font-medium hover:underline" style={{ color: 'var(--text-primary)' }}>
                              {concept.concept_name}
                            </Link>
                            {tier && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded font-medium" style={{ background: tier.bg, color: tier.text }}>
                                {tier.label}
                              </span>
                            )}
                            {score?.composite_score != null && (
                              <span className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>
                                {Math.round(score.composite_score)}/100
                              </span>
                            )}
                            <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: 'var(--bg-active)', color: 'var(--text-muted)' }}>
                              {concept.status}
                            </span>
                          </div>
                          {concept.positioning_angle && (
                            <p className="text-xs mt-1.5 line-clamp-2" style={{ color: 'var(--text-muted)' }}>{concept.positioning_angle}</p>
                          )}
                        </div>
                        {/* Show greenlight controls for any scored concept that hasn't moved to dev yet.
                            Includes legacy concepts at status='accepted' that got Phase B scored via the
                            old Cowork flow without ever flipping to 'evaluated'. */}
                        {score && (concept.status === 'evaluated' || concept.status === 'accepted') && (
                          <div className="flex-shrink-0 flex items-center gap-1.5">
                            <button onClick={() => updateConceptStatus(concept.id, 'greenlit')} className="text-[11px] px-2.5 py-1 rounded" style={{ background: 'var(--green-muted)', color: 'var(--green-text)', border: '1px solid rgba(74,222,128,0.3)' }}>Greenlight →</button>
                            <button onClick={() => updateConceptStatus(concept.id, 'parked')} className="text-[11px] px-2.5 py-1 rounded" style={{ background: 'var(--bg-active)', color: 'var(--text-muted)' }}>Park</button>
                            <button onClick={() => { if (confirm(`Reject "${concept.concept_name}"?`)) updateConceptStatus(concept.id, 'rejected') }} className="text-[11px] px-2.5 py-1 rounded" style={{ background: 'var(--red-muted)', color: 'var(--red-text)', border: '1px solid rgba(248,113,113,0.3)' }}>Reject</button>
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
