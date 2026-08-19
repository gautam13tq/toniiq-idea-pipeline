import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import PendingActionsBanner from '../components/PendingActionsBanner'
import VocPanel from '../components/VocPanel'

/**
 * Evaluation Page — ideas with scored concepts awaiting a decision.
 *
 * What appears here:
 *   - Active tab: ideas where at least one concept has a composite_score AND
 *     status in ('accepted', 'evaluated') AND idea.shelved_at IS NULL. Legacy
 *     accepted-with-score concepts (from the older Cowork Phase B flow) appear
 *     alongside modern evaluated ones.
 *   - Shelved tab: ideas where shelved_at IS NOT NULL — kept around for later
 *     review, hidden from the main queue.
 *
 * What drops off:
 *   - Once a concept is moved to Development (status=greenlit/in_development),
 *     it's no longer "actionable on Eval page". If that was the only scored
 *     concept on the idea, the idea disappears from this page automatically.
 *   - Rejected concepts are also non-actionable.
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
  const [vocInsights, setVocInsights] = useState({})
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('active') // 'active' | 'shelved'
  const [loadError, setLoadError] = useState(null)

  useEffect(() => { loadData() }, [])

  async function loadData() {
    setLoading(true)
    setLoadError(null)
    // One stage per idea: Evaluation shows idea_candidates at stage='evaluation'
    // (the rollup trigger derives stage from concept status). This page used to
    // select ideas by concept status and ignore stage, which double-listed
    // research-stage ideas that still had an accepted+scored concept.
    const { data: ideasData, error: ideasError } = await supabase
      .from('idea_candidates')
      .select('*')
      .eq('stage', 'evaluation')
      .order('last_updated_at', { ascending: false })
    if (ideasError) {
      // NEVER render a failed query as an empty queue — that reads as "no work"
      // when the truth is "couldn't load" (expired session, auth blip, 5xx).
      setLoadError(ideasError.message || 'Failed to load')
      setIdeas([]); setConcepts([]); setLoading(false)
      return
    }
    const ideaList = ideasData || []
    const ideaIds = ideaList.map(i => i.id)
    const [scoresRes, conceptsRes, vocRes] = await Promise.all([
      supabase.from('concept_scores').select('concept_id,composite_score,recommendation_tier'),
      ideaIds.length
        ? supabase.from('product_concepts').select('*').in('candidate_id', ideaIds).order('rank_within_ingredient')
        : Promise.resolve({ data: [] }),
      ideaIds.length
        ? supabase.from('voc_insights').select('*').in('candidate_id', ideaIds).order('created_at', { ascending: false })
        : Promise.resolve({ data: [] }),
    ])
    const scoreMap = {}
    for (const s of (scoresRes.data || [])) scoreMap[s.concept_id] = s
    setScores(scoreMap)
    const vocMap = {}
    for (const v of (vocRes.data || [])) if (!vocMap[v.candidate_id]) vocMap[v.candidate_id] = v
    setVocInsights(vocMap)
    setConcepts(conceptsRes.data || [])
    setIdeas(ideaList)
    setLoading(false)
  }

  async function updateConceptStatus(conceptId, newStatus) {
    await supabase.from('product_concepts').update({ status: newStatus, decided_at: new Date().toISOString() }).eq('id', conceptId)
    await loadData()
  }

  async function shelveIdea(ideaId, ideaName) {
    const reason = prompt(`Shelve "${ideaName}"? You can restore it later from the Shelved tab.\n\nOptional reason (skip if none):`)
    if (reason === null) return
    const { error } = await supabase.from('idea_candidates').update({
      shelved_at: new Date().toISOString(), shelved_reason: reason || null,
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

  if (loading) {
    return <div className="flex items-center justify-center min-h-[60vh]"><div className="text-sm" style={{ color: 'var(--text-faint)' }}>Loading...</div></div>
  }

  // Filter ideas by tab — every idea here is already stage='evaluation'.
  const activeIdeas = ideas.filter(i => !i.shelved_at)
  const shelvedIdeas = ideas.filter(i => i.shelved_at)
  const visibleIdeas = tab === 'shelved' ? shelvedIdeas : activeIdeas

  return (
    <div className="p-6 max-w-6xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight" style={{ color: 'var(--text-primary)' }}>Evaluation</h1>
        <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>
          {tab === 'shelved'
            ? `${shelvedIdeas.length} shelved idea${shelvedIdeas.length !== 1 ? 's' : ''}. Restore an idea to bring it back to the active queue.`
            : `${activeIdeas.length} idea${activeIdeas.length !== 1 ? 's' : ''} with scored concepts awaiting your decision. Each concept can move to development, get parked, or be rejected.`}
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

      {loadError && (
        <div className="mb-5 px-4 py-3 rounded-md border flex items-center justify-between gap-4" style={{ borderColor: 'var(--red)', background: 'var(--red-muted)', color: 'var(--red-text)' }}>
          <span className="text-sm">Couldn't load the evaluation queue ({loadError}). Your data is intact — this is usually an expired session or a brief backend blip.</span>
          <button onClick={loadData} className="text-xs px-3 py-1.5 rounded flex-shrink-0" style={{ background: 'var(--bg-card)', color: 'var(--text-primary)', border: '1px solid var(--border-default)' }}>Retry</button>
        </div>
      )}

      {visibleIdeas.length === 0 && (
        <div className="text-center py-20 rounded-md border border-dashed" style={{ borderColor: 'var(--border-default)', color: 'var(--text-muted)' }}>
          <div className="text-sm">{tab === 'shelved' ? 'No shelved ideas.' : 'Nothing in evaluation right now.'}</div>
          <div className="text-xs mt-1 opacity-70">{tab === 'shelved' ? 'Ideas you shelve from Active will appear here.' : 'Accept a concept on the Research page to queue Phase B evaluation.'}</div>
        </div>
      )}

      <div className="space-y-6">
        {visibleIdeas.map(idea => {
          const ideaConcepts = concepts.filter(c => c.candidate_id === idea.id)
          return (
            <div key={idea.id} className="rounded-lg border overflow-hidden" style={{ borderColor: 'var(--border-default)', background: 'var(--bg-card)' }}>
              <div className="px-5 py-4 border-b flex items-center justify-between gap-4" style={{ borderColor: 'var(--border-default)' }}>
                <div className="flex-1 min-w-0">
                  <Link to={`/discovery/${idea.id}`} className="text-base font-semibold hover:underline" style={{ color: 'var(--text-primary)' }}>
                    {idea.ingredient_name}
                  </Link>
                  <div className="text-xs mt-0.5 flex items-center gap-3 flex-wrap" style={{ color: 'var(--text-muted)' }}>
                    <span>{idea.category || 'Uncategorized'}</span>
                    <span>·</span>
                    <span>{ideaConcepts.length} concept{ideaConcepts.length !== 1 ? 's' : ''}</span>
                    {idea.shelved_at && (
                      <>
                        <span>·</span>
                        <span style={{ color: 'var(--amber-text)' }}>Shelved {new Date(idea.shelved_at).toLocaleDateString()}{idea.shelved_reason ? ` — "${idea.shelved_reason}"` : ''}</span>
                      </>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
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
                      title="Park this idea — keeps research and scores, removes from Active queue"
                      className="text-[11px] px-2.5 py-1 rounded transition-colors"
                      style={{ background: 'var(--bg-active)', color: 'var(--text-muted)', border: '1px solid var(--border-default)' }}
                    >
                      Shelve
                    </button>
                  )}
                </div>
              </div>
              <VocPanel idea={idea} insight={vocInsights[idea.id]} />
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
                        {/* Move-to-Dev / Park / Reject controls — visible only for actionable concepts */}
                        {score && (concept.status === 'evaluated' || concept.status === 'accepted') && !idea.shelved_at && (
                          <div className="flex-shrink-0 flex items-center gap-1.5">
                            <button onClick={() => updateConceptStatus(concept.id, 'greenlit')} className="text-[11px] px-2.5 py-1 rounded" style={{ background: 'var(--green-muted)', color: 'var(--green-text)', border: '1px solid rgba(74,222,128,0.3)' }} title="Move concept to the Development queue (separate from final launch greenlight)">→ Move to Development</button>
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
