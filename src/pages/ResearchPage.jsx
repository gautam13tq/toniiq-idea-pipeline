import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import PendingActionsBanner from '../components/PendingActionsBanner'

/**
 * Research Page — ideas with Phase A complete, concepts generated.
 * Core UX: show each idea, its concepts, and decision buttons (Accept / Reject / Park).
 * When Gautam accepts a concept, a pending_action is queued for Claude to run Phase B.
 */

const CONCEPT_ACTIONS = [
  { status: 'accepted', label: 'Accept → Phase B', color: 'green' },
  { status: 'rejected', label: 'Reject', color: 'red' },
  { status: 'parked', label: 'Park for later', color: 'gray' },
]

const BTN_STYLE = {
  green: { background: 'var(--green-muted)', color: 'var(--green-text)', border: '1px solid rgba(74,222,128,0.3)' },
  red: { background: 'var(--red-muted)', color: 'var(--red-text)', border: '1px solid rgba(248,113,113,0.3)' },
  gray: { background: 'var(--bg-active)', color: 'var(--text-muted)', border: '1px solid var(--border-default)' },
}

const STATUS_BADGES = {
  proposed: { label: 'Proposed', bg: 'var(--amber-muted)', text: 'var(--amber-text)' },
  accepted: { label: 'Accepted · Phase B pending', bg: 'var(--blue-muted)', text: 'var(--blue-text)' },
  evaluated: { label: 'Evaluated', bg: 'var(--green-muted)', text: 'var(--green-text)' },
  rejected: { label: 'Rejected', bg: 'var(--red-muted)', text: 'var(--red-text)' },
  parked: { label: 'Parked', bg: 'var(--bg-active)', text: 'var(--text-muted)' },
}

export default function ResearchPage() {
  const [ideas, setIdeas] = useState([])
  const [concepts, setConcepts] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => { loadData() }, [])

  async function loadData() {
    setLoading(true)
    const [ideasRes, conceptsRes] = await Promise.all([
      supabase.from('idea_candidates').select('*').eq('stage', 'research').order('last_updated_at', { ascending: false }),
      supabase.from('product_concepts').select('*').order('rank_within_ingredient'),
    ])
    setIdeas(ideasRes.data || [])
    setConcepts(conceptsRes.data || [])
    setLoading(false)
  }

  async function updateConceptStatus(conceptId, newStatus) {
    const prev = concepts.find(c => c.id === conceptId)?.status
    // Optimistic update
    setConcepts(cs => cs.map(c => c.id === conceptId ? { ...c, status: newStatus } : c))
    const { error } = await supabase.from('product_concepts').update({
      status: newStatus,
      decided_at: new Date().toISOString(),
    }).eq('id', conceptId)
    if (error) {
      // Revert on failure
      setConcepts(cs => cs.map(c => c.id === conceptId ? { ...c, status: prev } : c))
      alert(`Failed to update: ${error.message}`)
    } else {
      // Reload ideas to pick up stage rollup from trigger
      const { data } = await supabase.from('idea_candidates').select('*').eq('stage', 'research').order('last_updated_at', { ascending: false })
      setIdeas(data || [])
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-sm" style={{ color: 'var(--text-faint)' }}>Loading research queue...</div>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-6xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight" style={{ color: 'var(--text-primary)' }}>Research</h1>
        <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>
          Phase A complete. {ideas.length} idea{ideas.length !== 1 ? 's' : ''} with concepts awaiting your decision.
        </p>
      </div>

      <PendingActionsBanner scope="global" />

      {ideas.length === 0 && (
        <div className="text-center py-20 rounded-md border border-dashed" style={{ borderColor: 'var(--border-default)', color: 'var(--text-muted)' }}>
          <div className="text-sm">Nothing in research right now.</div>
          <div className="text-xs mt-1 opacity-70">Ideas land here after Claude runs Phase A on them.</div>
        </div>
      )}

      <div className="space-y-6">
        {ideas.map(idea => {
          const ideaConcepts = concepts.filter(c => c.candidate_id === idea.id)
          return (
            <div key={idea.id} className="rounded-lg border overflow-hidden" style={{ borderColor: 'var(--border-default)', background: 'var(--bg-card)' }}>
              {/* Idea header */}
              <div className="px-5 py-4 border-b flex items-center justify-between" style={{ borderColor: 'var(--border-default)' }}>
                <div>
                  <Link to={`/discovery/${idea.id}`} className="text-base font-semibold hover:underline" style={{ color: 'var(--text-primary)' }}>
                    {idea.ingredient_name}
                  </Link>
                  <div className="text-xs mt-0.5 flex items-center gap-3" style={{ color: 'var(--text-muted)' }}>
                    <span>{idea.category || 'Uncategorized'}</span>
                    <span>·</span>
                    <span>{ideaConcepts.length} concept{ideaConcepts.length !== 1 ? 's' : ''}</span>
                    <span>·</span>
                    <span>Updated {new Date(idea.last_updated_at).toLocaleDateString()}</span>
                  </div>
                </div>
                <Link to={`/discovery/${idea.id}`} className="text-xs px-3 py-1.5 rounded transition-colors" style={{ color: 'var(--text-muted)', background: 'var(--bg-active)' }}>
                  View research →
                </Link>
              </div>

              {/* Concepts */}
              <div className="divide-y" style={{ borderColor: 'var(--border-default)' }}>
                {ideaConcepts.map(concept => {
                  const badge = STATUS_BADGES[concept.status] || { label: concept.status, bg: 'var(--bg-active)', text: 'var(--text-muted)' }
                  return (
                    <div key={concept.id} className="px-5 py-4" style={{ borderColor: 'var(--border-default)' }}>
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <Link to={`/concepts/${concept.id}`} className="text-sm font-medium hover:underline" style={{ color: 'var(--text-primary)' }}>
                              {concept.concept_name}
                            </Link>
                            <span className="text-[10px] px-1.5 py-0.5 rounded font-medium" style={{ background: badge.bg, color: badge.text }}>
                              {badge.label}
                            </span>
                            {concept.confidence_score != null && (
                              <span className="text-[11px] opacity-70" style={{ color: 'var(--text-muted)' }}>
                                confidence {Number(concept.confidence_score).toFixed(1)}/10
                              </span>
                            )}
                          </div>
                          {concept.positioning_angle && (
                            <p className="text-xs mt-1.5 line-clamp-2" style={{ color: 'var(--text-muted)' }}>
                              {concept.positioning_angle}
                            </p>
                          )}
                        </div>

                        {/* Decision buttons only if still proposed */}
                        {concept.status === 'proposed' && (
                          <div className="flex-shrink-0 flex items-center gap-1.5">
                            {CONCEPT_ACTIONS.map(a => (
                              <button
                                key={a.status}
                                onClick={() => {
                                  if (a.status === 'rejected' && !confirm(`Reject "${concept.concept_name}"?`)) return
                                  updateConceptStatus(concept.id, a.status)
                                }}
                                className="text-[11px] px-2.5 py-1 rounded transition-transform hover:scale-[1.02]"
                                style={BTN_STYLE[a.color]}
                              >
                                {a.label}
                              </button>
                            ))}
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
