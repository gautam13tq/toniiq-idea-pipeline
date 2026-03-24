export default function FilterBar({ filters, setFilters, categories, resultCount }) {
  const update = (key, value) => setFilters(prev => ({ ...prev, [key]: value }))

  return (
    <div className="flex items-center gap-3 mb-4 flex-wrap">
      {/* Search */}
      <div className="relative flex-1 min-w-[200px] max-w-sm">
        <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input
          type="text"
          placeholder="Search ingredients..."
          value={filters.search}
          onChange={e => update('search', e.target.value)}
          className="w-full bg-slate-800 border border-slate-700 rounded-lg pl-9 pr-4 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 transition-colors"
        />
      </div>

      {/* Category */}
      <select
        value={filters.category}
        onChange={e => update('category', e.target.value)}
        className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
      >
        {categories.map(c => <option key={c} value={c}>{c}</option>)}
      </select>

      {/* Stage */}
      <select
        value={filters.stage}
        onChange={e => update('stage', e.target.value)}
        className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
      >
        <option value="all">All Stages</option>
        <option value="raw">Raw</option>
        <option value="screened">Screened</option>
        <option value="enriched">Enriched</option>
        <option value="scored">Scored</option>
      </select>

      {/* Toggle buttons */}
      <button
        onClick={() => update('flaggedOnly', !filters.flaggedOnly)}
        className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium border transition-colors ${
          filters.flaggedOnly
            ? 'bg-green-500/20 text-green-300 border-green-500/30'
            : 'bg-slate-800 text-slate-400 border-slate-700 hover:text-white'
        }`}
      >
        <span className="text-xs">🔥</span> High Opp Only
      </button>

      <button
        onClick={() => update('showPicks', !filters.showPicks)}
        className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium border transition-colors ${
          filters.showPicks
            ? 'bg-amber-500/20 text-amber-300 border-amber-500/30'
            : 'bg-slate-800 text-slate-400 border-slate-700 hover:text-white'
        }`}
      >
        <span className="text-xs">⭐</span> Claude's Picks
      </button>

      {/* Result count */}
      <div className="text-sm text-slate-500 ml-auto">
        {resultCount} results
      </div>
    </div>
  )
}
