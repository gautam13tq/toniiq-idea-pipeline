import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'

/**
 * Development — a read-only list of concepts that have been moved into
 * development. This is intentionally simple: Toniiq tracks actual NPD work
 * in Notion + local iCloud folders, not in this app. This page exists
 * purely so Gautam has visibility over which concepts are "in flight."
 *
 * NOTE on terminology: the underlying DB status is `greenlit` for legacy
 * reasons, but the UI says "Pending dev" / "Move to Development" because
 * "greenlight" in Toniiq's process is the FINAL launch approval, not the
 * decision to start development work.
 */

const STATUS_META = {
  greenlit: { label: 'Pending dev', bg: 'var(--green-muted)', text: 'var(--green-text)', description: 'Approved for development. No active work logged yet.' },
  in_development: { label: 'In development', bg: 'var(--blue-muted)', text: 'var(--blue-text)', description: 'Active NPD work (Notion + local folders).' },
}

export default function DevelopmentPage() {
  const [concepts, setConcepts] = useState([])
  const [ideas, setIdeas] = useState({})
  const [loading, setLoading] = useState(true)

  useEffect(() => { loadData() }, [])

  async function loadData() {
    const { data: conceptsData } = await supabase
      .from('product_concepts')
      .select('*')
      .in('status', ['greenlit', 'in_development'])
      .order('updated_at', { ascending: false })

    const ideaIds = [...new Set((conceptsData || []).map(c => c.candidate_id))]
    const { data: ideasData } = ideaIds.length > 0
      ? await supabase.from('idea_candidates').select('id,ingredient_name,category').in('id', ideaIds)
      : { data: [] }

    const ideaMap = {}
    for (const i of (ideasData || [])) ideaMap[i.id] = i
    setConcepts(conceptsData || [])
    setIdeas(ideaMap)
    setLoading(false)
  }

  async function markInDevelopment(conceptId) {
    await supabase.from('product_concepts').update({ status: 'in_development', updated_at: new Date().toISOString() }).eq('id', conceptId)
    loadData()
  }

  async function returnToEvaluation(conceptId) {
    if (!confirm('Return this concept to Evaluation? (resets status to evaluated)')) return
    await supabase.from('product_concepts').update({ status: 'evaluated', updated_at: new Date().toISOString() }).eq('id', conceptId)
    loadData()
  }

  if (loading) return <div className="p-6 text-sm" style={{ color: 'var(--text-faint)' }}>Loading...</div>

  const greenlit = concepts.filter(c => c.status === 'greenlit')
  const inDev = concepts.filter(c => c.status === 'in_development')

  return (
    <div className="p-6 max-w-5xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight" style={{ color: 'var(--text-primary)' }}>Development</h1>
        <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>
          Concepts we've committed to. Actual development work (sourcing, formulation, costing) happens in Notion + local folders — this page is just a visibility layer.
        </p>
      </div>

      {concepts.length === 0 ? (
        <div className="text-center py-20 rounded-md border border-dashed" style={{ borderColor: 'var(--border-default)', color: 'var(--text-muted)' }}>
          <div className="text-sm">No concepts in development yet.</div>
          <div className="text-xs mt-1 opacity-70">Click "Move to Development" on a scored concept (Evaluation page or concept detail) to send it here.</div>
        </div>
      ) : (
        <div className="space-y-8">
          {/* Pending-dev section — newly approved for development, not yet in active dev */}
          {greenlit.length > 0 && (
            <section>
              <div className="flex items-center gap-2 mb-3">
                <h2 className="text-sm font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Pending dev</h2>
                <span className="text-xs" style={{ color: 'var(--text-faint)' }}>{greenlit.length}</span>
              </div>
              <p className="text-xs mb-3" style={{ color: 'var(--text-faint)' }}>
                Approved for development but no active work logged yet. Click "Mark in development" once you've created the Notion card and local folder.
              </p>
              <ConceptList concepts={greenlit} ideas={ideas} onMarkInDev={markInDevelopment} onReturnToEval={returnToEvaluation} />
            </section>
          )}

          {/* In development section */}
          {inDev.length > 0 && (
            <section>
              <div className="flex items-center gap-2 mb-3">
                <h2 className="text-sm font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>In development</h2>
                <span className="text-xs" style={{ color: 'var(--text-faint)' }}>{inDev.length}</span>
              </div>
              <p className="text-xs mb-3" style={{ color: 'var(--text-faint)' }}>
                Active NPD work. Detailed tracking lives in Notion New Product Pipeline + `Toniiq/Product Development/{'{Product}'}/` folder.
              </p>
              <ConceptList concepts={inDev} ideas={ideas} onReturnToEval={returnToEvaluation} />
            </section>
          )}
        </div>
      )}
    </div>
  )
}

function ConceptList({ concepts, ideas, onMarkInDev, onReturnToEval }) {
  return (
    <div className="rounded-lg border divide-y" style={{ borderColor: 'var(--border-default)', background: 'var(--bg-card)' }}>
      {concepts.map(concept => {
        const idea = ideas[concept.candidate_id]
        const meta = STATUS_META[concept.status]
        return (
          <div key={concept.id} className="px-5 py-4">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <Link to={`/concepts/${concept.id}`} className="text-sm font-semibold hover:underline" style={{ color: 'var(--text-primary)' }}>
                    {concept.concept_name}
                  </Link>
                  <span className="text-[10px] px-1.5 py-0.5 rounded font-medium" style={{ background: meta.bg, color: meta.text }}>
                    {meta.label}
                  </span>
                </div>
                <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  {idea && (
                    <Link to={`/discovery/${concept.candidate_id}`} className="hover:underline">
                      {idea.ingredient_name}
                    </Link>
                  )}
                  {idea?.category && <span> · {idea.category}</span>}
                  {concept.format && <span> · {concept.format}</span>}
                  {concept.target_dosage && <span> · {concept.target_dosage}</span>}
                </div>
                {concept.positioning_angle && (
                  <p className="text-xs mt-1.5 line-clamp-2" style={{ color: 'var(--text-muted)' }}>
                    {concept.positioning_angle}
                  </p>
                )}
              </div>
              <div className="flex-shrink-0 flex flex-col items-end gap-1.5">
                {concept.status === 'greenlit' && onMarkInDev && (
                  <button
                    onClick={() => onMarkInDev(concept.id)}
                    className="text-[11px] px-2.5 py-1 rounded"
                    style={{ background: 'var(--blue-muted)', color: 'var(--blue-text)', border: '1px solid rgba(59,130,246,0.3)' }}
                  >
                    Mark in development →
                  </button>
                )}
                {onReturnToEval && (
                  <button
                    onClick={() => onReturnToEval(concept.id)}
                    className="text-[10px] px-2 py-0.5 rounded"
                    style={{ background: 'var(--bg-active)', color: 'var(--text-faint)' }}
                  >
                    ↩ Return to Evaluation
                  </button>
                )}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
