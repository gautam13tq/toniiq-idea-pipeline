import { useEffect, useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { useAuth } from '../lib/AuthContext'
import { supabase } from '../lib/supabase'

const NAV_SECTIONS = [
  {
    label: 'Source Selection',
    items: [
      { path: '/inbox', label: 'Inbox', icon: '□', countType: 'inboxUniverse' },
      { path: '/market', label: 'Market Atlas', icon: '△' },
      { path: '/category-atlas', label: 'Category Atlas', icon: '◈', countType: 'categoryAtlas' },
      { path: '/opportunities', label: 'Opportunities', icon: '◇', countType: 'opportunities' },
    ]
  },
  {
    label: 'Lifecycle',
    items: [
      { path: '/research', label: 'Research', icon: '◎', countStage: 'research' },
      { path: '/evaluation', label: 'Evaluation', icon: '◉', countStage: 'evaluation' },
      { path: '/development', label: 'Development', icon: '▣', countStage: 'development' },
      { path: '/archive', label: 'Archive', icon: '◇', countStage: 'archive' },
    ]
  },
]

export default function Layout({ children }) {
  const location = useLocation()
  const { user, signOut } = useAuth()
  const [expanded, setExpanded] = useState(false)
  const [stageCounts, setStageCounts] = useState({})
  const [pendingCount, setPendingCount] = useState(0)
  const [opportunityCount, setOpportunityCount] = useState(0)
  const [inboxUniverseCount, setInboxUniverseCount] = useState(0)
  const [categoryAtlasCount, setCategoryAtlasCount] = useState(0)

  useEffect(() => {
    let ignore = false

    async function fetchCounts() {
      const { data } = await supabase.from('idea_candidates').select('stage')
      const counts = {}
      for (const row of (data || [])) counts[row.stage] = (counts[row.stage] || 0) + 1
      const { count } = await supabase.from('pending_actions').select('*', { count: 'exact', head: true }).in('status', ['pending', 'in_progress'])
      const { count: openOpportunities } = await supabase
        .from('opportunity_reviews')
        .select('*', { count: 'exact', head: true })
        .in('status', ['new', 'reviewing', 'queued_research', 'researching', 'watching'])
      const { data: latestSnapshot } = await supabase
        .from('poe_snapshots')
        .select('import_date')
        .order('import_date', { ascending: false })
        .limit(1)
        .single()
      let latestCount = 0
      if (latestSnapshot?.import_date) {
        const { count: countLatest } = await supabase
          .from('poe_snapshots')
          .select('*', { count: 'exact', head: true })
          .eq('import_date', latestSnapshot.import_date)
        latestCount = countLatest || 0
      }
      const { data: latestCategoryImport } = await supabase
        .from('category_atlas_imports')
        .select('id')
        .eq('status', 'completed')
        .order('generated_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      let latestCategoryCount = 0
      if (latestCategoryImport?.id) {
        const { count: countCategoryEntries } = await supabase
          .from('category_atlas_entries')
          .select('*', { count: 'exact', head: true })
          .eq('import_id', latestCategoryImport.id)
        latestCategoryCount = countCategoryEntries || 0
      }

      if (ignore) return
      setStageCounts(counts)
      setPendingCount(count || 0)
      setOpportunityCount(openOpportunities || 0)
      setInboxUniverseCount(latestCount)
      setCategoryAtlasCount(latestCategoryCount)
    }

    fetchCounts()
    return () => { ignore = true }
  }, [location.pathname])

  return (
    <div className="flex min-h-screen" style={{ background: 'var(--bg-base)' }}>
      <aside
        onMouseEnter={() => setExpanded(true)}
        onMouseLeave={() => setExpanded(false)}
        className="flex-shrink-0 flex flex-col border-r sticky top-0 h-screen overflow-hidden"
        style={{
          width: expanded ? 220 : 52,
          background: 'var(--bg-sidebar)',
          borderColor: 'var(--border-default)',
          transition: 'width 0.2s cubic-bezier(0.4,0,0.2,1)',
          zIndex: 30,
        }}
      >
        {/* Logo */}
        <div
          className="flex items-center border-b"
          style={{
            borderColor: 'var(--border-default)',
            height: 52,
            paddingLeft: expanded ? 16 : 0,
            justifyContent: expanded ? 'flex-start' : 'center',
            transition: 'padding 0.2s',
          }}
        >
          <NavLink to="/opportunities" className="block" style={{ whiteSpace: 'nowrap' }}>
            {expanded ? (
              <h1 className="text-sm font-bold tracking-widest uppercase" style={{ color: 'var(--text-primary)', letterSpacing: '0.15em' }}>
                TONIIQ
              </h1>
            ) : (
              <span className="text-base font-bold" style={{ color: 'var(--text-primary)' }}>T</span>
            )}
          </NavLink>
        </div>

        {pendingCount > 0 && !expanded && (
          <div className="flex justify-center pt-2">
            <div className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold"
              style={{ background: 'var(--amber-muted)', color: 'var(--amber-text)' }}
              title={`${pendingCount} pending actions`}>
              {pendingCount}
            </div>
          </div>
        )}

        <nav className="flex-1 py-3" style={{ paddingLeft: expanded ? 8 : 6, paddingRight: expanded ? 8 : 6 }}>
          {NAV_SECTIONS.map(section => (
            <div key={section.label} className="mb-4">
              {expanded && (
                <p className="text-[10px] font-semibold uppercase tracking-wider mb-2"
                  style={{ color: 'var(--text-faint)', letterSpacing: '0.08em', paddingLeft: 8 }}>
                  {section.label}
                </p>
              )}
              <ul className="space-y-0.5">
                {section.items.map(item => {
                  const isActive = location.pathname.startsWith(item.path)
                  const count = item.countType === 'pending'
                    ? pendingCount
                    : item.countType === 'opportunities'
                      ? opportunityCount
                      : item.countType === 'inboxUniverse'
                        ? inboxUniverseCount
                        : item.countType === 'categoryAtlas'
                          ? categoryAtlasCount
                        : stageCounts[item.countStage]
                  return (
                    <li key={item.path}>
                      <NavLink
                        to={item.path}
                        className="flex items-center rounded text-sm transition-colors"
                        style={{
                          background: isActive ? 'var(--bg-active)' : 'transparent',
                          color: isActive ? 'var(--text-primary)' : 'var(--text-muted)',
                          fontWeight: isActive ? 600 : 400,
                          height: 36,
                          paddingLeft: expanded ? 10 : 0,
                          paddingRight: expanded ? 10 : 0,
                          justifyContent: expanded ? 'flex-start' : 'center',
                          gap: expanded ? 10 : 0,
                        }}
                        title={!expanded ? `${item.label} (${count || 0})` : undefined}
                      >
                        <span className="text-sm flex-shrink-0" style={{ width: 20, textAlign: 'center' }}>{item.icon}</span>
                        {expanded && (
                          <>
                            <span style={{ whiteSpace: 'nowrap' }}>{item.label}</span>
                            {count != null && count > 0 && (
                              <span className="ml-auto text-[10px] tabular-nums" style={{ color: 'var(--text-faint)' }}>{count}</span>
                            )}
                          </>
                        )}
                      </NavLink>
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}

          {expanded && pendingCount > 0 && (
            <div className="mb-4">
              <p className="text-[10px] font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--text-faint)', letterSpacing: '0.08em', paddingLeft: 8 }}>
                Queue
              </p>
              <div className="px-2.5 py-2 rounded text-xs" style={{ background: 'var(--amber-muted)', color: 'var(--amber-text)' }}>
                {pendingCount} action{pendingCount !== 1 ? 's' : ''} pending
                <div className="text-[10px] mt-0.5 opacity-80">Claude picks up next session</div>
              </div>
            </div>
          )}
        </nav>

        {expanded && (
          <div className="px-4 py-3 border-t" style={{ borderColor: 'var(--border-default)' }}>
            {user && (
              <div className="flex items-center justify-between mb-1">
                <p className="text-[11px] truncate" style={{ color: 'var(--text-muted)' }}>{user.email?.split('@')[0]}</p>
                <button
                  onClick={signOut}
                  className="text-[10px] px-1.5 py-0.5 rounded transition-colors"
                  style={{ color: 'var(--text-faint)', background: 'transparent' }}
                  onMouseEnter={(e) => { e.target.style.background = 'var(--bg-active)'; e.target.style.color = 'var(--text-muted)' }}
                  onMouseLeave={(e) => { e.target.style.background = 'transparent'; e.target.style.color = 'var(--text-faint)' }}
                >Sign out</button>
              </div>
            )}
            <p className="text-[10px]" style={{ color: 'var(--text-faint)' }}>v6.1 · category atlas</p>
          </div>
        )}
      </aside>

      <main className="flex-1 min-w-0 overflow-auto">{children}</main>
    </div>
  )
}
