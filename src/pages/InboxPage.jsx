import { useEffect, useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'

/**
 * Inbox — raw ideas not yet screened. 800+ candidates, so this page is a
 * searchable/filterable list with bulk-promote to "run Phase A" queue.
 */

export default function InboxPage() {
  const [ideas, setIdeas] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('all')
  const [flaggedOnly, setFlaggedOnly] = useState(false)
  const [poeMap, setPoeMap] = useState({})

  useEffect(() => { loadData() }, [])

  async function loadData() {
    const [ideasRes, poeRes] = await Promise.all([
      supabase.from('idea_candidates').select('*').eq('stage', 'inbox').order('last_updated_at', { ascending: false }),
      supabase.from('poe_snapshots').select('candidate_id,search_volume_90d,search_volume_growth_90d,flagged_high_opportunity,avg_price_usd,import_date'),
    ])
    setIdeas(ideasRes.data || [])
    const pm = {}
    for (const r of (poeRes.data || [])) {
      if (!pm[r.candidate_id] || r.import_date > pm[r.candidate_id].import_date) pm[r.candidate_id] = r
    }
    setPoeMap(pm)
    setLoading(false)
  }

  const categories = useMemo(() => ['all', ...Array.from(new Set(ideas.map(i => i.category).filter(Boolean))).sort()], [ideas])

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim()
    return ideas.filter(i => {
      if (q && !i.ingredient_name.toLowerCase().includes(q)) return false
      if (category !== 'all' && i.category !== category) return false
      if (flaggedOnly && !poeMap[i.id]?.flagged_high_opportunity) return false
      return true
    }).slice(0, 500) // cap render for perf
  }, [ideas, search, category, flaggedOnly, poeMap])

  async function promoteToPhaseA(idea) {
    if (!confirm(`Queue Phase A research for "${idea.ingredient_name}"?`)) return
    await supabase.from('pending_actions').insert({
      entity_type: 'idea',
      entity_id: idea.id,
      action: 'run_phase_a',
      triggered_by: 'ui',
      context: { ingredient_name: idea.ingredient_name },
    })
    alert(`Queued. Claude will run Phase A on "${idea.ingredient_name}" in the next Cowork session.`)
  }

  if (loading) return <div className="p-6 text-sm" style={{ color: 'var(--text-faint)' }}>Loading inbox...</div>

  return (
    <div className="p-6 max-w-6xl">
      <div className="mb-5">
        <h1 className="text-2xl font-bold tracking-tight" style={{ color: 'var(--text-primary)' }}>Inbox</h1>
        <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>
          {ideas.length} raw idea{ideas.length !== 1 ? 's' : ''} waiting to be screened. Promote to Phase A and Claude will run keyword + Reddit + science research.
        </p>
      </div>

      {/* Filters */}
      <div className="mb-4 flex items-center gap-3 flex-wrap">
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search ingredients..."
          className="px-3 py-1.5 text-sm rounded border"
          style={{ borderColor: 'var(--border-default)', background: 'var(--bg-card)', color: 'var(--text-primary)', width: 240 }}
        />
        <select
          value={category}
          onChange={e => setCategory(e.target.value)}
          className="px-3 py-1.5 text-sm rounded border"
          style={{ borderColor: 'var(--border-default)', background: 'var(--bg-card)', color: 'var(--text-primary)' }}
        >
          {categories.map(c => <option key={c} value={c}>{c === 'all' ? 'All categories' : c}</option>)}
        </select>
        <label className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--text-muted)' }}>
          <input type="checkbox" checked={flaggedOnly} onChange={e => setFlaggedOnly(e.target.checked)} />
          High-opp only
        </label>
        <div className="text-xs ml-auto" style={{ color: 'var(--text-faint)' }}>
          {filtered.length} shown{filtered.length !== ideas.length && ` (of ${ideas.length})`}
        </div>
      </div>

      {/* List */}
      <div className="rounded-lg border overflow-hidden" style={{ borderColor: 'var(--border-default)', background: 'var(--bg-card)' }}>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wider" style={{ color: 'var(--text-faint)', background: 'var(--bg-active)' }}>
              <th className="px-4 py-2.5">Ingredient</th>
              <th className="px-4 py-2.5">Category</th>
              <th className="px-4 py-2.5 text-right">POE Vol 90d</th>
              <th className="px-4 py-2.5 text-right">Growth</th>
              <th className="px-4 py-2.5"></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(idea => {
              const poe = poeMap[idea.id]
              return (
                <tr key={idea.id} className="border-t" style={{ borderColor: 'var(--border-default)' }}>
                  <td className="px-4 py-2.5">
                    <Link to={`/discovery/${idea.id}`} className="font-medium hover:underline" style={{ color: 'var(--text-primary)' }}>
                      {idea.ingredient_name}
                    </Link>
                    {poe?.flagged_high_opportunity && <span className="ml-2 text-[10px] px-1 rounded" style={{ background: 'var(--amber-muted)', color: 'var(--amber-text)' }}>★</span>}
                  </td>
                  <td className="px-4 py-2.5 text-xs" style={{ color: 'var(--text-muted)' }}>{idea.category || '—'}</td>
                  <td className="px-4 py-2.5 text-right text-xs tabular-nums" style={{ color: 'var(--text-muted)' }}>{poe?.search_volume_90d?.toLocaleString() || '—'}</td>
                  <td className="px-4 py-2.5 text-right text-xs tabular-nums" style={{ color: 'var(--text-muted)' }}>{poe?.search_volume_growth_90d != null ? `${Math.round(poe.search_volume_growth_90d * 100)}%` : '—'}</td>
                  <td className="px-4 py-2.5 text-right">
                    <button onClick={() => promoteToPhaseA(idea)} className="text-[11px] px-2 py-1 rounded" style={{ background: 'var(--blue-muted)', color: 'var(--blue-text)', border: '1px solid rgba(59,130,246,0.3)' }}>
                      → Run Phase A
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
