import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

// Shelf scorer v1 (agreed 8 Nov 2026). Shows only rows written by a validated run; every score carries its run id,
// caps and flags. Strong at 60; a capped shelf is held at 59.9 and says why.
const TIER_COLOR = { strong: 'var(--green-text)', watchlist: 'var(--amber-text, #b7791f)', 'needs work': 'var(--text-muted)', pass: 'var(--text-muted)', ineligible: 'var(--red-text)' }

export default function ShelfScoresPanel() {
  const [rows, setRows] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    supabase.from('shelf_scores').select('*').eq('scoring_version', 'shelf-v1').order('published_at', { ascending: false })
      .then(({ data, error }) => {
        if (error) { setError(error.message); return }
        const latest = new Map()
        for (const r of data || []) if (!latest.has(r.shelf_keyword)) latest.set(r.shelf_keyword, r)
        setRows([...latest.values()].sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || (b.raw ?? -1) - (a.raw ?? -1)))
      })
  }, [])

  if (error) return <div className="mb-5 text-xs" style={{ color: 'var(--red-text)' }}>Shelf scores could not load: {error}</div>
  if (!rows) return null
  return (
    <div className="mb-6 rounded-lg border" style={{ borderColor: 'var(--border-default)', background: 'var(--bg-card)' }}>
      <div className="px-5 py-3 border-b text-sm font-medium" style={{ borderColor: 'var(--border-default)' }}>
        Amazon shelf scores <span className="text-xs font-normal" style={{ color: 'var(--text-muted)' }}>(scorer v1, strong at 60, validated runs only)</span>
      </div>
      {rows.length === 0 ? (
        <div className="px-5 py-4 text-xs" style={{ color: 'var(--text-muted)' }}>No validated shelf scores yet.</div>
      ) : (
        <table className="w-full text-xs">
          <thead><tr style={{ color: 'var(--text-muted)' }}>
            <th className="text-left px-5 py-2">Shelf</th><th className="text-right px-2">Score</th><th className="text-left px-2">Tier</th>
            <th className="text-right px-2">D</th><th className="text-right px-2">G</th><th className="text-right px-2">C</th><th className="text-right px-2">Diff</th>
            <th className="text-left px-2">Caps and flags</th><th className="text-left px-5">Run</th>
          </tr></thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.run_id} className="border-t" style={{ borderColor: 'var(--border-default)' }}>
                <td className="px-5 py-2">{r.shelf_keyword}</td>
                <td className="text-right px-2">{r.score ?? '—'}{r.soft?.length ? <span title={`raw ${r.raw}`}> (raw {Number(r.raw).toFixed(1)})</span> : null}</td>
                <td className="px-2" style={{ color: TIER_COLOR[r.tier] }}>{r.tier}</td>
                <td className="text-right px-2">{r.D ?? '—'}</td><td className="text-right px-2">{r.G ?? '—'}</td>
                <td className="text-right px-2">{r.C != null ? Number(r.C).toFixed(2) : '—'}</td>
                <td className="text-right px-2">{r.Diff != null ? Number(r.Diff).toFixed(2) : '—'}</td>
                <td className="px-2">{[...(r.hard || []), ...(r.soft || []), ...(r.info || [])].join(', ') || '—'}</td>
                <td className="px-5 font-mono" style={{ color: 'var(--text-muted)' }}>{r.run_id}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
