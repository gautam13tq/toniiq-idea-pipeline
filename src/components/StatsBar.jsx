export default function StatsBar({ candidates, poeData, datarovaData }) {
  const total = candidates.length
  const withPoe = candidates.filter(c => c.source_poe).length
  const withDatarova = candidates.filter(c => c.source_datarova).length
  const flagged = Object.values(poeData).filter(p => p.flagged_high_opportunity).length
  const multiSource = candidates.filter(c => (c.source_count || 0) >= 2).length

  // Top growth candidates
  const topGrowth = candidates
    .filter(c => datarovaData[c.id]?.search_volume_trend > 0)
    .sort((a, b) => (datarovaData[b.id]?.search_volume_trend || 0) - (datarovaData[a.id]?.search_volume_trend || 0))

  const stats = [
    { label: 'Total', value: total, color: 'var(--text-primary)' },
    { label: 'High Opp', value: flagged, color: 'var(--green)' },
    { label: 'Multi-Source', value: multiSource, color: 'var(--blue)' },
    { label: 'Growing (DR)', value: topGrowth.length, color: 'var(--amber)' },
  ]

  return (
    <div className="grid grid-cols-4 gap-3 mb-4">
      {stats.map(s => (
        <div key={s.label} className="rounded-lg px-4 py-3" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)' }}>
          <div className="text-2xl font-bold" style={{ color: s.color }}>{s.value}</div>
          <div className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{s.label}</div>
        </div>
      ))}
    </div>
  )
}
