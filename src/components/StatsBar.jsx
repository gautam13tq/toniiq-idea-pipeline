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
    { label: 'Total', value: total, color: 'text-white' },
    { label: 'High Opp', value: flagged, color: 'text-green-400' },
    { label: 'Multi-Source', value: multiSource, color: 'text-blue-400' },
    { label: 'Growing (DR)', value: topGrowth.length, color: 'text-amber-400' },
  ]

  return (
    <div className="grid grid-cols-4 gap-3 mb-4">
      {stats.map(s => (
        <div key={s.label} className="bg-slate-800/50 border border-slate-700/30 rounded-lg px-4 py-3">
          <div className={`text-2xl font-bold ${s.color}`}>{s.value}</div>
          <div className="text-xs text-slate-400 mt-0.5">{s.label}</div>
        </div>
      ))}
    </div>
  )
}
