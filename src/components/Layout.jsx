import { useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'

const NAV_SECTIONS = [
  {
    label: 'Pipeline',
    items: [
      { path: '/', label: 'Discovery', icon: '◎' },
      { path: '/screened', label: 'Screened', icon: '◉' },
      { path: '/concepts', label: 'Concepts', icon: '◆' },
      { path: '/development', label: 'Development', icon: '▣', badge: 'soon', disabled: true },
      { path: '/greenlit', label: 'Greenlit', icon: '✓', badge: 'soon', disabled: true },
    ]
  },
]

export default function Layout({ children }) {
  const location = useLocation()
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="flex min-h-screen" style={{ background: 'var(--bg-base)' }}>
      {/* Sidebar — collapsed by default, expands on hover or toggle */}
      <aside
        onMouseEnter={() => setExpanded(true)}
        onMouseLeave={() => setExpanded(false)}
        className="flex-shrink-0 flex flex-col border-r sticky top-0 h-screen overflow-hidden"
        style={{
          width: expanded ? 200 : 52,
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
          <NavLink to="/" className="block" style={{ whiteSpace: 'nowrap' }}>
            {expanded ? (
              <h1
                className="text-sm font-bold tracking-widest uppercase"
                style={{ color: 'var(--text-primary)', letterSpacing: '0.15em' }}
              >
                TONIIQ
              </h1>
            ) : (
              <span
                className="text-base font-bold"
                style={{ color: 'var(--text-primary)' }}
              >
                T
              </span>
            )}
          </NavLink>
        </div>

        {/* Navigation */}
        <nav className="flex-1 py-3" style={{ paddingLeft: expanded ? 8 : 6, paddingRight: expanded ? 8 : 6 }}>
          {NAV_SECTIONS.map(section => (
            <div key={section.label} className="mb-4">
              {expanded && (
                <p
                  className="text-[10px] font-semibold uppercase tracking-wider mb-2"
                  style={{
                    color: 'var(--text-faint)',
                    letterSpacing: '0.08em',
                    paddingLeft: 8,
                    opacity: expanded ? 1 : 0,
                    transition: 'opacity 0.15s',
                  }}
                >
                  {section.label}
                </p>
              )}
              <ul className="space-y-0.5">
                {section.items.map(item => {
                  const isActive = item.path === '/'
                    ? location.pathname === '/'
                    : location.pathname.startsWith(item.path)
                  const isDisabled = item.disabled

                  return (
                    <li key={item.path}>
                      {isDisabled ? (
                        <div
                          className="flex items-center rounded text-sm cursor-not-allowed opacity-40"
                          style={{
                            color: 'var(--text-faint)',
                            height: 36,
                            paddingLeft: expanded ? 10 : 0,
                            justifyContent: expanded ? 'flex-start' : 'center',
                            gap: expanded ? 10 : 0,
                          }}
                          title={item.label}
                        >
                          <span className="text-sm flex-shrink-0" style={{ width: 20, textAlign: 'center' }}>{item.icon}</span>
                          {expanded && (
                            <>
                              <span style={{ whiteSpace: 'nowrap' }}>{item.label}</span>
                              {item.badge && (
                                <span
                                  className="ml-auto text-[10px] font-medium px-1.5 py-0.5 rounded"
                                  style={{ background: 'var(--bg-active)', color: 'var(--text-faint)' }}
                                >
                                  {item.badge}
                                </span>
                              )}
                            </>
                          )}
                        </div>
                      ) : (
                        <NavLink
                          to={item.path}
                          end={item.path === '/'}
                          className="flex items-center rounded text-sm transition-colors"
                          style={{
                            background: isActive ? 'var(--bg-active)' : 'transparent',
                            color: isActive ? 'var(--text-primary)' : 'var(--text-muted)',
                            fontWeight: isActive ? 600 : 400,
                            height: 36,
                            paddingLeft: expanded ? 10 : 0,
                            justifyContent: expanded ? 'flex-start' : 'center',
                            gap: expanded ? 10 : 0,
                          }}
                          title={!expanded ? item.label : undefined}
                        >
                          <span className="text-sm flex-shrink-0" style={{ width: 20, textAlign: 'center' }}>{item.icon}</span>
                          {expanded && <span style={{ whiteSpace: 'nowrap' }}>{item.label}</span>}
                        </NavLink>
                      )}
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
        </nav>

        {/* Bottom */}
        {expanded && (
          <div className="px-4 py-3 border-t" style={{ borderColor: 'var(--border-default)' }}>
            <p className="text-[10px]" style={{ color: 'var(--text-faint)' }}>
              v4.1
            </p>
          </div>
        )}
      </aside>

      {/* Main content */}
      <main className="flex-1 min-w-0 overflow-auto">
        {children}
      </main>
    </div>
  )
}
