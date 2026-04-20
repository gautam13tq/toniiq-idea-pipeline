import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'

export default function ArchivePage() {
  const [ideas, setIdeas] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.from('idea_candidates').select('*').eq('stage', 'archive').order('last_updated_at', { ascending: false }).then(({ data }) => {
      setIdeas(data || [])
      setLoading(false)
    })
  }, [])

  async function restore(id) {
    await supabase.from('idea_candidates').update({ stage: 'inbox', last_updated_at: new Date().toISOString() }).eq('id', id)
    setIdeas(ideas.filter(i => i.id !== id))
  }

  return (
    <div className="p-6 max-w-5xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight" style={{ color: 'var(--text-primary)' }}>Archive</h1>
        <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>
          {ideas.length} archived idea{ideas.length !== 1 ? 's' : ''}. Kept for dedup. Quarterly sweep purges research data older than 12 months.
        </p>
      </div>
      {loading ? (
        <div className="text-sm" style={{ color: 'var(--text-faint)' }}>Loading...</div>
      ) : ideas.length === 0 ? (
        <div className="text-center py-20 rounded-md border border-dashed" style={{ borderColor: 'var(--border-default)', color: 'var(--text-muted)' }}>
          <div className="text-sm">Nothing archived yet.</div>
        </div>
      ) : (
        <div className="rounded-lg border divide-y" style={{ borderColor: 'var(--border-default)', background: 'var(--bg-card)' }}>
          {ideas.map(idea => (
            <div key={idea.id} className="px-5 py-3 flex items-center justify-between">
              <div>
                <Link to={`/discovery/${idea.id}`} className="text-sm font-medium hover:underline" style={{ color: 'var(--text-primary)' }}>{idea.ingredient_name}</Link>
                <div className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{idea.category || 'Uncategorized'} · {new Date(idea.last_updated_at).toLocaleDateString()}</div>
              </div>
              <button onClick={() => restore(idea.id)} className="text-[11px] px-2.5 py-1 rounded" style={{ background: 'var(--bg-active)', color: 'var(--text-muted)' }}>Restore to Inbox</button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
