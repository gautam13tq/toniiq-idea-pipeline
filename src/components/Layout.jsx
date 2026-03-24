import { NavLink, useLocation } from 'react-router-dom'
import { useTheme } from './ThemeProvider'

/* ═══════════════════════════════════════════════════════════
   PIPELINE STAGES — The core navigation hierarchy

   Discovery → Screened → Concepts → Development → Greenlit

   Future: Sourcing, Formulation, Costing will live under Development
   ═══════════════════════════════════════════════════════════ */

const NAV_SECTIONS = [
  {
    label: 'Pipeline',
    items: [
      { path: '/', label: 'Discovery', icon: '◎', description: '453 candidates', badge: null },
      { path: '/screened', label: 'Screened', icon: '◉', description: 'Shortlisted ideas', badge: null },
      { path: '/concepts', label: 'Concepts', icon: '◆', description: 'Phase A + B evaluated', badge: null },
      { path: '/development', label: 'Development', icon: '▣', description: 'Active projects', badge: 'soon', disabled: true },
      { path: '/greenlit', label: 'Greenlit', icon: '✓', description: 'Ready to launch', badge: 'soon', disabled: true },
    ]
  },
]

function ThemeToggle() {
  const { theme, setTheme } = useTheme()
  const modes = [
    { value: 'light', icon: '☀' },
    { value: 'dark', icon: '☾' },
    { value: 'system', icon: '◐' },
  ]
  return (
    <div className="flex items-center gap-0.5 p-0.5 rounded-md" style={{ background: 'var(--bg-tertiary)' }}>
      {modes.map(m => (
        <button
          key={m.value}
          onClick={() => setTheme(m.value)}
          className="px-2 py-1 text-xs rounded transition-all"
          style={{
            background: theme === m.value ? 'var(--bg-elevated)' : 'transparent',
            color: theme === m.value ? 'var(--text-primary)' : 'var(--text-tertiary)',
            boxShadow: theme === m.value ? 'var(--shadow-sm)' : 'none',
          }}
          title={m.value.charAt(0).toUpperCase() + m.value.slice(1)}
        >
          {m.icon}
        </button>
      ))}
    </div>
  )
}

export default function Layout({ children }) {
  const location = useLocation()

  return (
    <div className="flex min-h-screen" style={{ background: 'var(--bg-primary)' }}>
      {/* Sidebar */}
      <aside
        className="w-56 flex-shrink-0 flex flex-col border-r sticky top-0 h-screen overflow-y-auto"
        style={{
          background: 'var(--bg-sidebar)',
          borderColor: 'var(--border-primary)',
        }}
      >
        {/* Logo / Brand */}
        <div className="px-5 py-5 border-b" style={{ borderColor: 'var(--border-primary)' }}>
          <NavLink to="/" className="block">
            <h1
              className="text-base font-bold tracking-widest uppercase"
              style={{ color: 'var(--text-primary)', letterSpacing: '0.15em' }}
            >
              TONIIQ
            </h1>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
              Product Intelligence
            </p>
          </NavLink>
        </div>

        {/* Navigation */}
        <nav className="flex-1 py-4 px-3">
          {NAV_SECTIONS.map(section => (
            <div key={section.label} className="mb-6">
              <p
                className="text-xs font-semibold uppercase tracking-wider px-2 mb-2"
                style={{ color: 'var(--text-tertiary)', letterSpacing: '0.08em' }}
              >
                {section.label}
              </p>
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
                          className="flex items-center gap-2.5 px-2.5 py-2 rounded text-sm cursor-not-allowed opacity-40"
                          style={{ color: 'var(--text-tertiary)' }}
                        >
                          <span className="text-sm w-5 text-center">{item.icon}</span>
                          <span>{item.label}</span>
                          {item.badge && (
                            <span
                              className="ml-auto text-[10px] font-medium px-1.5 py-0.5 rounded"
                              style={{ background: 'var(--bg-tertiary)', color: 'var(--text-tertiary)' }}
                            >
                              {item.badge}
                            </span>
                          )}
                        </div>
                      ) : (
                        <NavLink
                          to={item.path}
                          end={item.path === '/'}
                          className="flex items-center gap-2.5 px-2.5 py-2 rounded text-sm transition-colors"
                          style={{
                            background: isActive ? 'var(--bg-active)' : 'transparent',
                            color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
                            fontWeight: isActive ? 600 : 400,
                          }}
                        >
                          <span className="text-sm w-5 text-center">{item.icon}</span>
                          <span>{item.label}</span>
                        </NavLink>
                      )}
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
        </nav>

        {/* Bottom section */}
        <div
          className="px-4 py-4 border-t space-y-3"
          style={{ borderColor: 'var(--border-primary)' }}
        >
          <ThemeToggle />
          <p className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
            v4.1 — Phase B Complete
          </p>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 min-w-0 overflow-auto">
        {children}
      </main>
    </div>
  )
}
