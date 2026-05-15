export default function FilterBar({ filters, setFilters, categories, resultCount }) {
  const update = (key, value) => setFilters(prev => ({ ...prev, [key]: value }))

  return (
    <div className="flex items-center gap-3 mb-4 flex-wrap">
      {/* Search */}
      <div className="relative flex-1 min-w-[200px] max-w-sm">
        <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ color: 'var(--text-faint)' }}>
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input
          type="text"
          placeholder="Search ingredients..."
          value={filters.search}
          onChange={e => update('search', e.target.value)}
          className="t-input w-full pl-9 pr-4"
        />
      </div>

      {/* Category */}
      <select
        value={filters.category}
        onChange={e => update('category', e.target.value)}
        className="t-input"
      >
        {categories.map(c => <option key={c} value={c}>{c}</option>)}
      </select>

      {/* Stage */}
      <select
        value={filters.stage}
        onChange={e => update('stage', e.target.value)}
        className="t-input"
      >
        <option value="all">All Stages</option>
        <option value="inbox">Inbox</option>
        <option value="research">Research</option>
        <option value="evaluation">Evaluation</option>
        <option value="development">Development</option>
        <option value="archive">Archive</option>
      </select>

      {/* Toggle buttons */}
      <button
        onClick={() => update('flaggedOnly', !filters.flaggedOnly)}
        className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium border transition-colors ${
          filters.flaggedOnly
            ? 'score-green'
            : ''
        }`}
        style={
          !filters.flaggedOnly ? {
            background: 'var(--bg-card)',
            color: 'var(--text-muted)',
            border: '1px solid var(--border-default)',
          } : {}
        }
      >
        <span className="text-xs">🔥</span> High Opp Only
      </button>

      <button
        onClick={() => update('showPicks', !filters.showPicks)}
        className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium border transition-colors ${
          filters.showPicks
            ? 'score-amber'
            : ''
        }`}
        style={
          !filters.showPicks ? {
            background: 'var(--bg-card)',
            color: 'var(--text-muted)',
            border: '1px solid var(--border-default)',
          } : {}
        }
      >
        <span className="text-xs">⭐</span> Claude's Picks
      </button>

      {/* Result count */}
      <div className="text-sm ml-auto" style={{ color: 'var(--text-muted)' }}>
        {resultCount} results
      </div>
    </div>
  )
}
