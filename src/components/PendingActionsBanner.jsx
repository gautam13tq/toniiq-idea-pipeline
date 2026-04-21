import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

/**
 * PendingActionsBanner
 * Shows open pending_actions for an entity (idea or concept) or globally.
 * This is the UI side of the UI↔LLM bridge: when Gautam makes a decision in
 * the UI, a pending_action is queued; when Claude runs the next session,
 * it reads pending_actions and executes them.
 */

const ACTION_LABELS = {
  run_phase_a: { label: 'Research pending', icon: '◎', color: 'amber' },
  run_phase_b: { label: 'Evaluation pending', icon: '◉', color: 'amber' },
  review_concepts: { label: 'Concepts awaiting your decision', icon: '◆', color: 'blue' },
  decide_greenlight: { label: 'Ready for greenlight decision', icon: '✓', color: 'blue' },
  create_dev_folder: { label: 'Development folder setup pending', icon: '▣', color: 'amber' },
}

const COLOR_STYLE = {
  amber: { bg: 'var(--amber-muted)', text: 'var(--amber-text)', border: 'rgba(251,191,36,0.3)' },
  blue: { bg: 'var(--blue-muted)', text: 'var(--blue-text)', border: 'rgba(59,130,246,0.3)' },
  green: { bg: 'var(--green-muted)', text: 'var(--green-text)', border: 'rgba(74,222,128,0.3)' },
}

export default function PendingActionsBanner({ entityType = null, entityId = null, scope = 'global' }) {
  const [actions, setActions] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadActions()
  }, [entityType, entityId, scope])

  async function loadActions() {
    let q = supabase
      .from('pending_actions')
      .select('*')
      .in('status', ['pending', 'in_progress'])
      .order('created_at', { ascending: false })

    if (entityType && entityId) {
      q = q.eq('entity_type', entityType).eq('entity_id', entityId)
    }

    const { data } = await q
    setActions(data || [])
    setLoading(false)
  }

  async function dismissAction(id) {
    await supabase.from('pending_actions').update({
      status: 'cancelled',
      completed_at: new Date().toISOString(),
    }).eq('id', id)
    setActions(prev => prev.filter(a => a.id !== id))
  }

  if (loading || actions.length === 0) return null

  // Group by action type
  const byAction = actions.reduce((acc, a) => {
    acc[a.action] = acc[a.action] || []
    acc[a.action].push(a)
    return acc
  }, {})

  return (
    <div className="mb-4 space-y-2">
      {Object.entries(byAction).map(([action, items]) => {
        const meta = ACTION_LABELS[action] || { label: action, icon: '•', color: 'blue' }
        const style = COLOR_STYLE[meta.color]
        return (
          <div
            key={action}
            className="flex items-center justify-between rounded-md px-4 py-3 text-sm"
            style={{ background: style.bg, color: style.text, border: `1px solid ${style.border}` }}
          >
            <div className="flex items-center gap-3">
              <span style={{ fontSize: 16 }}>{meta.icon}</span>
              <div>
                <div className="font-medium">{meta.label}</div>
                <div className="text-xs opacity-80">
                  {items.length === 1
                    ? (items[0].context?.ingredient_name || items[0].context?.concept_name || '')
                    : `${items.length} items pending`}
                </div>
              </div>
            </div>
            {scope !== 'item' && (
              <div className="text-[11px] opacity-70">
                {items.length > 1 ? `${items.length} queued` : 'Queued for Claude session'}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
