function formatVolume(n) {
  if (!n) return '—'
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(0) + 'K'
  return n.toLocaleString()
}

function formatGrowth(decimal) {
  if (decimal === null || decimal === undefined) return '—'
  const pct = decimal * 100
  if (Math.abs(pct) >= 1000) return (pct >= 0 ? '+' : '') + (pct / 1000).toFixed(1) + 'K%'
  return (pct >= 0 ? '+' : '') + pct.toFixed(1) + '%'
}

function GrowthBadge({ value }) {
  if (value === null || value === undefined) return <span className="text-slate-600">—</span>
  const pct = value * 100
  const isPositive = pct > 0
  const isHigh = Math.abs(pct) > 50
  const color = isPositive
    ? isHigh ? 'text-green-400' : 'text-green-500/70'
    : isHigh ? 'text-red-400' : 'text-red-500/70'
  return <span className={`font-medium ${color}`}>{formatGrowth(value)}</span>
}

function SortHeader({ label, field, filters, setFilters }) {
  const active = filters.sortBy === field
  const next = active && filters.sortDir === 'desc' ? 'asc' : 'desc'
  return (
    <button
      onClick={() => setFilters(prev => ({ ...prev, sortBy: field, sortDir: active ? next : 'desc' }))}
      className={`flex items-center gap-1 text-xs font-medium uppercase tracking-wider ${
        active ? 'text-indigo-300' : 'text-slate-500 hover:text-slate-300'
      } transition-colors`}
    >
      {label}
      {active && (
        <svg className={`w-3 h-3 transition-transform ${filters.sortDir === 'asc' ? 'rotate-180' : ''}`} fill="currentColor" viewBox="0 0 20 20">
          <path d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" />
        </svg>
      )}
    </button>
  )
}

const STAGE_COLORS = {
  raw: 'bg-slate-600/30 text-slate-400',
  screened: 'bg-blue-500/20 text-blue-300',
  enriched: 'bg-purple-500/20 text-purple-300',
  scored: 'bg-green-500/20 text-green-300',
  killed: 'bg-red-500/20 text-red-400',
}

export default function PipelineTable({ candidates, poeData, datarovaData, picks, filters, setFilters, onSelect, selectedId }) {
  const pickIds = new Set(picks.map(p => p.candidate_id))

  return (
    <div className="bg-slate-800/30 border border-slate-700/30 rounded-xl overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-700/50">
              <th className="text-left px-4 py-3 w-8"></th>
              <th className="text-left px-4 py-3">
                <SortHeader label="Ingredient" field="name" filters={filters} setFilters={setFilters} />
              </th>
              <th className="text-left px-4 py-3">
                <SortHeader label="Category" field="category" filters={filters} setFilters={setFilters} />
              </th>
              <th className="text-center px-4 py-3">
                <span className="text-xs font-medium uppercase tracking-wider text-slate-500">Stage</span>
              </th>
              <th className="text-right px-4 py-3">
                <SortHeader label="POE Vol (90d)" field="poe_volume" filters={filters} setFilters={setFilters} />
              </th>
              <th className="text-right px-4 py-3">
                <SortHeader label="POE Growth" field="poe_growth" filters={filters} setFilters={setFilters} />
              </th>
              <th className="text-right px-4 py-3">
                <SortHeader label="DR Growth" field="datarova_growth" filters={filters} setFilters={setFilters} />
              </th>
              <th className="text-right px-4 py-3">
                <SortHeader label="Conv %" field="datarova_conv" filters={filters} setFilters={setFilters} />
              </th>
              <th className="text-center px-4 py-3">
                <SortHeader label="Sources" field="sources" filters={filters} setFilters={setFilters} />
              </th>
              <th className="text-center px-4 py-3">
                <span className="text-xs font-medium uppercase tracking-wider text-slate-500">Flags</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {candidates.map(c => {
              const poe = poeData[c.id]
              const dr = datarovaData[c.id]
              const isPick = pickIds.has(c.id)
              const isSelected = c.id === selectedId

              return (
                <tr
                  key={c.id}
                  onClick={() => onSelect(c.id)}
                  className={`border-b border-slate-700/20 cursor-pointer transition-colors ${
                    isSelected ? 'bg-indigo-500/10' : 'hover:bg-slate-800/50'
                  }`}
                >
                  <td className="px-4 py-2.5 text-center">
                    {isPick && <span title="Claude's Pick">⭐</span>}
                  </td>
                  <td className="px-4 py-2.5">
                    <span className="font-medium text-white">{c.ingredient_name}</span>
                  </td>
                  <td className="px-4 py-2.5">
                    <span className="text-slate-400 text-xs">{c.category || '—'}</span>
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    <span className={`inline-block text-xs font-medium px-2 py-0.5 rounded-full ${STAGE_COLORS[c.stage] || ''}`}>
                      {c.stage}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-xs text-slate-300">
                    {formatVolume(poe?.search_volume_90d)}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-xs">
                    <GrowthBadge value={poe?.search_volume_growth_90d} />
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-xs">
                    <GrowthBadge value={dr?.search_volume_trend} />
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-xs text-slate-300">
                    {dr?.conversion_rate ? dr.conversion_rate.toFixed(1) + '%' : '—'}
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    <div className="flex justify-center gap-0.5">
                      {[
                        { key: 'source_poe', label: 'P', color: 'bg-blue-500' },
                        { key: 'source_datarova', label: 'D', color: 'bg-purple-500' },
                        { key: 'source_smartscout', label: 'S', color: 'bg-teal-500' },
                        { key: 'source_google_trends', label: 'G', color: 'bg-yellow-500' },
                      ].map(s => (
                        <span
                          key={s.key}
                          className={`w-4 h-4 rounded text-[9px] font-bold flex items-center justify-center ${
                            c[s.key] ? s.color + ' text-white' : 'bg-slate-700/30 text-slate-600'
                          }`}
                          title={s.key.replace('source_', '')}
                        >
                          {s.label}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    <div className="flex justify-center gap-1">
                      {poe?.flagged_high_opportunity && (
                        <span className="text-xs" title="High Opportunity">🔥</span>
                      )}
                      {c.in_toniiq_catalog && (
                        <span className="text-xs" title="In Catalog">📦</span>
                      )}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {candidates.length === 0 && (
        <div className="text-center py-12 text-slate-500">
          No candidates match your filters
        </div>
      )}
    </div>
  )
}
