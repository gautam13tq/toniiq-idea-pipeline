import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'

export default function ScreenedPage() {
  const [candidates, setCandidates] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadScreened()
  }, [])

  async function loadScreened() {
    setLoading(true)
    const { data } = await supabase
      .from('idea_candidates')
      .select('*')
      .eq('stage', 'screened')
      .order('last_updated_at', { ascending: false })

    setCandidates(data || [])
    setLoading(false)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full min-h-[60vh]">
        <div className="text-center">
          <div
            className="animate-spin rounded-full h-6 w-6 border-b-2 mx-auto mb-3"
            style={{ borderColor: 'var(--text-faint)' }}
          />
          <p style={{ color: 'var(--text-faint)' }} className="text-sm">Loading...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-5xl">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight" style={{ color: 'var(--text-primary)' }}>
          Screened
        </h1>
        <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>
          Ideas promoted from Discovery for deeper evaluation. Moving an idea here triggers Phase A concept generation.
        </p>
      </div>

      {candidates.length === 0 ? (
        <div
          className="rounded-lg border-2 border-dashed p-12 text-center"
          style={{ borderColor: 'var(--border-default)' }}
        >
          <div className="text-4xl mb-3 opacity-30">◉</div>
          <h3 className="text-base font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>
            No screened ideas yet
          </h3>
          <p className="text-sm max-w-md mx-auto" style={{ color: 'var(--text-faint)' }}>
            Go to <Link to="/" className="underline" style={{ color: 'var(--text-primary)' }}>Discovery</Link> and
            promote promising ideas to the screened stage. This will trigger the Phase A concept research pipeline.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {candidates.map(c => (
            <Link
              key={c.id}
              to={`/discovery/${c.id}`}
              className="block rounded-lg border p-4 transition-colors"
              style={{
                background: 'var(--bg-card)',
                borderColor: 'var(--border-default)',
              }}
            >
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>
                    {c.ingredient_name}
                  </h3>
                  {c.category && (
                    <span
                      className="text-xs mt-1 inline-block px-2 py-0.5 rounded"
                      style={{ background: 'var(--bg-active)', color: 'var(--text-muted)' }}
                    >
                      {c.category}
                    </span>
                  )}
                </div>
                <span className="text-xs" style={{ color: 'var(--text-faint)' }}>
                  {c.last_updated_at ? new Date(c.last_updated_at).toLocaleDateString() : ''}
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
