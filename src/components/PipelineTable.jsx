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
  if (value === null || value === undefined) return <span style={{ color: 'var(--text-faint)' }}>—</span>
  const pct = value * 100
  const isPositive = pct > 0
  const isHigh = Math.abs(pct) > 50
  const color = isPositive
    ? isHigh ? 'var(--green)' : 'rgba(74,222,128,0.7)'
    : isHigh ? 'var(--red)' : 'rgba(248,113,113,0.7)'
  return <span className="font-medium" style={{ color }}>{formatGrowth(value)}</span>
}

function SortHeader({ label, field, filters, setFilters }) {
  const active = filters.sortBy === field
  const next = active && filters.sortDir === 'desc' ? 'asc' : 'desc'
  return (
    <button
      onClick={() => setFilters(prev => ({ ...prev, sortBy: field, sortDir: active ? next : 'desc' }))}
      className="flex items-center gap-1 text-xs font-medium uppercase tracking-wider transition-colors"
      style={{
        color: active ? 'var(--blue-text)' : 'var(--text-faint)',
      }}
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
  raw: { background: 'rgba(100,116,139,0.3)', color: 'var(--text-muted)' },
  screened: { background: 'var(--blue-muted)', color: 'var(--blue-text)' },
  enriched: { background: 'rgba(147,112,219,0.2)', color: 'rgba(196,181,253,1)' },
  scored: { background: 'var(--green-muted)', color: 'var(--green-text)' },
  killed: { background: 'var(--red-muted)', color: 'var(--red-text)' },
}

export default function PipelineTable({ candidates, poeData, datarovaData, picks, filters, setFilters, onSelect, selectedId }) {
  const pickIds = new Set(picks.map(p => p.candidate_id))

  const sourceColors = {
    source_poe: 'var(--blue)',
    source_datarova: 'rgba(147,112,219,1)',
    source_smartscout: 'rgba(20,184,166,1)',
    source_google_trends: 'var(--amber)',
  }

  return (
    <div className="t-card rounded-xl overflow-hidden">
      <div className="overflow-x-auto">
        <table className="t-table">
          <thead>
            <tr style={{ borderBottomColor: 'var(--border-default)' }}>
              <th className="text-left px-4 py-3 w-8"></th>
              <th className="text-left px-4 py-3">
                <SortHeader label="Ingredient" field="name" filters={filters} setFilters={setFilters} />
              </th>
              <th className="text-left px-4 py-3">
                <SortHeader label="Category" field="category" filters={filters} setFilters={setFilters} />
              </th>
              <th className="text-center px-4 py-3">
                <span className="text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-faint)' }}>Stage</span>
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
                <span className="text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-faint)' }}>Flags</span>
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
                  className="cursor-pointer transition-colors"
                  style={{
                    borderBottomColor: 'var(--border-subtle)',
                    background: isSelected ? 'var(--blue-muted)' : 'transparent',
                  }}
                  onMouseEnter={(e) => !isSelected && (e.currentTarget.style.background = 'var(--bg-hover)')}
                  onMouseLeave={(e) => !isSelected && (e.currentTarget.style.background = 'transparent')}
                >
                  <td className="px-4 py-2.5 text-center">
                    {isPick && <span title="Claude's Pick">⭐</span>}
                  </td>
                  <td className="px-4 py-2.5">
                    <span className="font-medium" style={{ color: 'var(--text-primary)' }}>{c.ingredient_name}</span>
                  </td>
                  <td className="px-4 py-2.5">
                    <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{c.category || '—'}</span>
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    <span className="inline-block text-xs font-medium px-2 py-0.5 rounded-full" style={STAGE_COLORS[c.stage] || {}}>
                      {c.stage}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-xs" style={{ color: 'var(--text-body)' }}>
                    {formatVolume(poe?.search_volume_90d)}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-xs">
                    <GrowthBadge value={poe?.search_volume_growth_90d} />
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-xs">
                    <GrowthBadge value={dr?.search_volume_trend} />
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-xs" style={{ color: 'var(--text-body)' }}>
                    {dr?.conversion_rate ? dr.conversion_rate.toFixed(1) + '%' : '—'}
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    <div className="flex justify-center gap-0.5">
                      {[
                        { key: 'source_poe', label: 'P' },
                        { key: 'source_datarova', label: 'D' },
                        { key: 'source_smartscout', label: 'S' },
                        { key: 'source_google_trends', label: 'G' },
                      ].map(s => (
                        <span
                          key={s.key}
                          className="w-4 h-4 rounded text-[9px] font-bold flex items-center justify-center"
                          style={{
                            background: c[s.key] ? sourceColors[s.key] : 'rgba(100,116,139,0.3)',
                            color: c[s.key] ? 'white' : 'var(--text-faint)',
                          }}
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
        <div className="text-center py-12" style={{ color: 'var(--text-muted)' }}>
          No candidates match your filters
        </div>
      )}
    </div>
  )
}
