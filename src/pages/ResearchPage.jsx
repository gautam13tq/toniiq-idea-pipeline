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
  { status: 'accepted', label: 'Accept → Evaluate', color: 'green' },
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
  accepted: { label: 'Accepted · evaluation pending', bg: 'var(--blue-muted)', text: 'var(--blue-text)' },
  evaluated: { label: 'Evaluated', bg: 'var(--green-muted)', text: 'var(--green-text)' },
  rejected: { label: 'Rejected', bg: 'var(--red-muted)', text: 'var(--red-text)' },
  parked: { label: 'Parked', bg: 'var(--bg-active)', text: 'var(--text-muted)' },
}

export default function ResearchPage() {
  const [ideas, setIdeas] = useState([])
  const [concepts, setConcepts] = useState([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('active') // 'active' | 'shelved'

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

  async function shelveIdea(ideaId, ideaName) {
    const reason = prompt(`Shelve "${ideaName}"? You can restore it later from the Shelved tab.\n\nOptional reason (skip if none):`)
    // null = canceled, '' = no reason, string = reason
    if (reason === null) return
    const { error } = await supabase.from('idea_candidates').update({
      shelved_at: new Date().toISOString(),
      shelved_reason: reason || null,
    }).eq('id', ideaId)
    if (error) { alert(`Shelve failed: ${error.message}`); return }
    setIdeas(prev => prev.map(i => i.id === ideaId ? { ...i, shelved_at: new Date().toISOString(), shelved_reason: reason || null } : i))
  }

  async function unshelveIdea(ideaId) {
    const { error } = await supabase.from('idea_candidates').update({
      shelved_at: null, shelved_reason: null,
    }).eq('id', ideaId)
    if (error) { alert(`Restore failed: ${error.message}`); return }
    setIdeas(prev => prev.map(i => i.id === ideaId ? { ...i, shelved_at: null, shelved_reason: null } : i))
  }

  async function refreshResearch(ideaId, ideaName) {
    const ok = confirm(`Refresh research for "${ideaName}"?\n\nThis re-runs Phase A: keyword deep dive + Reddit + science + concept synthesis (~5-8 min). Existing concepts are preserved; new ones may be added. Useful when the market has grown or the prior run had data gaps.`)
    if (!ok) return
    // Insert new pending_action
    const { data: action, error } = await supabase.from('pending_actions').insert({
      entity_type: 'idea', entity_id: ideaId, action: 'run_phase_a', triggered_by: 'ui',
      context: { ingredient_name: ideaName, refresh: true },
    }).select('id').single()
    if (error) { alert(`Failed to queue: ${error.message}`); return }
    // Fire-and-forget invoke
    supabase.functions.invoke('phase-a-gather', { body: { pending_action_id: action.id } }).catch(e => {
      console.error('Failed to invoke phase-a-gather:', e)
    })
    // If shelved, clear shelved_at so the user can see the run progress in Active
    await supabase.from('idea_candidates').update({ shelved_at: null, shelved_reason: null }).eq('id', ideaId)
    setIdeas(prev => prev.map(i => i.id === ideaId ? { ...i, shelved_at: null, shelved_reason: null } : i))
    alert(`Research refresh started for "${ideaName}". Results will update on this page in ~5-8 min.`)
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

  const activeIdeas = ideas.filter(i => !i.shelved_at)
  const shelvedIdeas = ideas.filter(i => i.shelved_at)
  const visibleIdeas = tab === 'shelved' ? shelvedIdeas : activeIdeas

  return (
    <div className="p-6 max-w-6xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight" style={{ color: 'var(--text-primary)' }}>Research</h1>
        <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>
          {tab === 'shelved'
            ? `${shelvedIdeas.length} shelved idea${shelvedIdeas.length !== 1 ? 's' : ''}. Restore one to bring it back to active research, or refresh to re-run Phase A.`
            : `Research complete. ${activeIdeas.length} idea${activeIdeas.length !== 1 ? 's' : ''} with concepts awaiting your decision. Accept a concept to queue its evaluation.`}
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-5 border-b" style={{ borderColor: 'var(--border-default)' }}>
        {[
          { key: 'active', label: 'Active', count: activeIdeas.length },
          { key: 'shelved', label: 'Shelved', count: shelvedIdeas.length },
        ].map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className="px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors"
            style={{
              borderBottomColor: tab === t.key ? 'var(--blue)' : 'transparent',
              color: tab === t.key ? 'var(--text-primary)' : 'var(--text-muted)',
            }}
          >
            {t.label} <span className="text-xs opacity-70">{t.count}</span>
          </button>
        ))}
      </div>

      <PendingActionsBanner scope="global" />

      {visibleIdeas.length === 0 && (
        <div className="text-center py-20 rounded-md border border-dashed" style={{ borderColor: 'var(--border-default)', color: 'var(--text-muted)' }}>
          <div className="text-sm">{tab === 'shelved' ? 'No shelved ideas.' : 'Nothing in research right now.'}</div>
          <div className="text-xs mt-1 opacity-70">{tab === 'shelved' ? 'Ideas you shelve from Active will appear here.' : 'Ideas land here after Claude runs Phase A on them.'}</div>
        </div>
      )}

      <div className="space-y-6">
        {visibleIdeas.map(idea => {
          const ideaConcepts = concepts.filter(c => c.candidate_id === idea.id)
          return (
            <div key={idea.id} className="rounded-lg border overflow-hidden" style={{ borderColor: 'var(--border-default)', background: 'var(--bg-card)' }}>
              {/* Idea header */}
              <div className="px-5 py-4 border-b flex items-center justify-between gap-4" style={{ borderColor: 'var(--border-default)' }}>
                <div className="flex-1 min-w-0">
                  <Link to={`/discovery/${idea.id}`} className="text-base font-semibold hover:underline" style={{ color: 'var(--text-primary)' }}>
                    {idea.ingredient_name}
                  </Link>
                  <div className="text-xs mt-0.5 flex items-center gap-3 flex-wrap" style={{ color: 'var(--text-muted)' }}>
                    <span>{idea.category || 'Uncategorized'}</span>
                    <span>·</span>
                    <span>{ideaConcepts.length} concept{ideaConcepts.length !== 1 ? 's' : ''}</span>
                    <span>·</span>
                    <span>Updated {new Date(idea.last_updated_at).toLocaleDateString()}</span>
                    {idea.shelved_at && (
                      <>
                        <span>·</span>
                        <span style={{ color: 'var(--amber-text)' }}>Shelved {new Date(idea.shelved_at).toLocaleDateString()}{idea.shelved_reason ? ` — "${idea.shelved_reason}"` : ''}</span>
                      </>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <button
                    onClick={() => refreshResearch(idea.id, idea.ingredient_name)}
                    title="Re-run Phase A research (keyword + Reddit + science + concepts)"
                    className="text-[11px] px-2.5 py-1 rounded transition-colors"
                    style={{ background: 'var(--blue-muted)', color: 'var(--blue-text)', border: '1px solid rgba(59,130,246,0.3)' }}
                  >
                    ↻ Refresh
                  </button>
                  {idea.shelved_at ? (
                    <button
                      onClick={() => unshelveIdea(idea.id)}
                      title="Move back to Active"
                      className="text-[11px] px-2.5 py-1 rounded transition-colors"
                      style={{ background: 'var(--green-muted)', color: 'var(--green-text)', border: '1px solid rgba(74,222,128,0.3)' }}
                    >
                      Restore
                    </button>
                  ) : (
                    <button
                      onClick={() => shelveIdea(idea.id, idea.ingredient_name)}
                      title="Park this idea — keeps research, removes from Active queue"
                      className="text-[11px] px-2.5 py-1 rounded transition-colors"
                      style={{ background: 'var(--bg-active)', color: 'var(--text-muted)', border: '1px solid var(--border-default)' }}
                    >
                      Shelve
                    </button>
                  )}
                  <Link to={`/discovery/${idea.id}`} className="text-xs px-3 py-1.5 rounded transition-colors" style={{ color: 'var(--text-muted)', background: 'var(--bg-active)' }}>
                    View →
                  </Link>
                </div>
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
