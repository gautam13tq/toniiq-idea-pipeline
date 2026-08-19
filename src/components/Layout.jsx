import { useEffect, useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { useAuth } from '../lib/AuthContext'
import { supabase } from '../lib/supabase'

const NAV_ITEMS = [
  { path: '/discover', label: 'Discover', icon: '◇', countType: 'opportunities' },
  { path: '/pipeline', label: 'Pipeline', icon: '◎', countType: 'pipeline' },
  { path: '/development', label: 'Development', icon: '▣', countType: 'activeDev' },
]

export default function Layout({ children }) {
  const location = useLocation()
  const { user, signOut } = useAuth()
  const [expanded, setExpanded] = useState(false)
  const [stageCounts, setStageCounts] = useState({})
  const [greenlightCount, setGreenlightCount] = useState(0)
  const [opportunityCount, setOpportunityCount] = useState(0)
  const [activeDevCount, setActiveDevCount] = useState(0)

  useEffect(() => {
    let ignore = false

    async function fetchCounts() {
      const { data } = await supabase.from('idea_candidates').select('stage')
      const counts = {}
      for (const row of (data || [])) counts[row.stage] = (counts[row.stage] || 0) + 1
      // Count client-side from plain GET reads. Exact-count / HEAD requests
      // intermittently 503 at the edge on the shared warehouse project, which
      // was blanking these sidebar badges; plain GETs are reliable here.
      const { data: pendingRows } = await supabase
        .from('pending_actions')
        .select('status')
        .eq('action', 'decide_greenlight')
        .eq('status', 'pending')

      const { data: openOppRows } = await supabase
        .from('opportunity_reviews')
        .select('status')
        .in('status', ['new', 'reviewing', 'queued_research', 'researching', 'watching'])

      const { data: activeDevRows } = await supabase
        .from('npd_registry_products')
        .select('id')
        .eq('queue', 'Active Development')

      if (ignore) return
      setStageCounts(counts)
      setGreenlightCount(pendingRows?.length || 0)
      setOpportunityCount(openOppRows?.length || 0)
      setActiveDevCount(activeDevRows?.length || 0)
    }

    fetchCounts()
    return () => { ignore = true }
  }, [location.pathname])

  function getCount(item) {
    if (item.countType === 'opportunities') return opportunityCount
    if (item.countType === 'activeDev') return activeDevCount
    if (item.countType === 'pipeline') {
      return (stageCounts.research || 0) + (stageCounts.evaluation || 0)
    }
    return null
  }

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
          <NavLink to="/pipeline" className="block" style={{ whiteSpace: 'nowrap' }}>
            {expanded ? (
              <h1 className="text-sm font-bold tracking-widest uppercase" style={{ color: 'var(--text-primary)', letterSpacing: '0.15em' }}>
                TONIIQ
              </h1>
            ) : (
              <span className="text-base font-bold" style={{ color: 'var(--text-primary)' }}>T</span>
            )}
          </NavLink>
        </div>

        {greenlightCount > 0 && !expanded && (
          <div className="flex justify-center pt-2">
            <div className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold"
              style={{ background: 'var(--amber-muted)', color: 'var(--amber-text)' }}
              title={`${greenlightCount} greenlight decision${greenlightCount !== 1 ? 's' : ''}`}>
              {greenlightCount}
            </div>
          </div>
        )}

        <nav className="flex-1 py-3" style={{ paddingLeft: expanded ? 8 : 6, paddingRight: expanded ? 8 : 6 }}>
          <ul className="space-y-0.5">
            {NAV_ITEMS.map(item => {
              const isActive = location.pathname.startsWith(item.path)
              const count = getCount(item)
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

          {expanded && greenlightCount > 0 && (
            <div className="mb-4 mt-4">
              <p className="text-[10px] font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--text-faint)', letterSpacing: '0.08em', paddingLeft: 8 }}>
                Queue
              </p>
              <NavLink
                to="/pipeline/decide"
                className="block px-2.5 py-2 rounded text-xs"
                style={{ background: 'var(--amber-muted)', color: 'var(--amber-text)' }}
              >
                {greenlightCount} greenlight decision{greenlightCount !== 1 ? 's' : ''}
                <div className="text-[10px] mt-0.5 opacity-80">Claude picks up next session</div>
              </NavLink>
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
