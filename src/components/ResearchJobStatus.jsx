import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

/**
 * ResearchJobStatus — live status indicator for a Phase A research job.
 * Polls pending_actions every 5 seconds while in_progress to show which
 * step (Datarova / Reddit / Science / Synthesis) is currently running.
 */

const STEP_ORDER = ['datarova', 'reddit', 'science', 'synthesis']
const STEP_LABEL = {
  datarova: 'Keywords',
  reddit: 'Reddit',
  science: 'Science',
  synthesis: 'Synthesis',
}

export default function ResearchJobStatus({ candidateId, compact = false }) {
  const [action, setAction] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let timer
    async function poll() {
      const { data } = await supabase
        .from('pending_actions')
        .select('*')
        .eq('entity_id', candidateId)
        .eq('action', 'run_phase_a')
        .order('created_at', { ascending: false })
        .limit(1)
      setAction(data?.[0] || null)
      setLoading(false)
      // Re-poll every 5s while still running
      if (data?.[0] && ['pending', 'in_progress'].includes(data[0].status)) {
        timer = setTimeout(poll, 5000)
      }
    }
    poll()
    return () => timer && clearTimeout(timer)
  }, [candidateId])

  if (loading || !action) return null
  if (action.status === 'completed' || action.status === 'cancelled') return null

  const ctx = action.context || {}
  const steps = STEP_ORDER.map(s => ({
    key: s,
    label: STEP_LABEL[s],
    status: ctx[s] || (action.status === 'pending' ? 'pending' : 'pending'),
  }))

  if (compact) {
    // Single line: "Research running · Reddit..."
    const current = steps.find(s => s.status === 'running') || steps.find(s => s.status !== 'done')
    return (
      <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--amber-text)' }}>
        <span className="inline-block w-2 h-2 rounded-full animate-pulse" style={{ background: 'var(--amber)' }} />
        {action.status === 'failed'
          ? <span style={{ color: 'var(--red-text)' }}>Failed: {action.notes || 'unknown'}</span>
          : <span>Research running · {current ? current.label : 'starting...'}</span>}
      </div>
    )
  }

  return (
    <div className="rounded-md px-3 py-2 text-xs" style={{ background: 'var(--amber-muted)', color: 'var(--amber-text)', border: '1px solid rgba(251,191,36,0.3)' }}>
      <div className="font-medium mb-1.5 flex items-center gap-2">
        <span className="inline-block w-2 h-2 rounded-full animate-pulse" style={{ background: 'var(--amber)' }} />
        {action.status === 'failed' ? `Research failed: ${action.notes || 'unknown error'}` : 'Research in progress'}
      </div>
      <div className="flex items-center gap-2">
        {steps.map((s, i) => (
          <div key={s.key} className="flex items-center gap-1">
            <span style={{ fontSize: 12 }}>
              {s.status === 'done' ? '✓' : s.status === 'running' ? '◉' : s.status === 'failed' ? '✕' : '○'}
            </span>
            <span style={{ opacity: s.status === 'done' ? 0.7 : 1, fontWeight: s.status === 'running' ? 600 : 400 }}>
              {s.label}
            </span>
            {i < steps.length - 1 && <span style={{ opacity: 0.3 }}>→</span>}
          </div>
        ))}
      </div>
    </div>
  )
}
