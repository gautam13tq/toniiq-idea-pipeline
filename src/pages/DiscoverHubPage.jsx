import { NavLink, Navigate, useParams } from 'react-router-dom'
import InboxPage from './InboxPage'
import MarketAtlasPage from './MarketAtlasPage'
import CategoryAtlasPage from './CategoryAtlasPage'
import OpportunityQueuePage from './OpportunityQueuePage'

const TABS = [
  { key: 'signals', label: 'Signals' },
  { key: 'picks', label: 'AI Picks' },
  { key: 'categories', label: 'Categories' },
  { key: 'shortlist', label: 'Shortlist' },
]

const TAB_CONTENT = {
  signals: InboxPage,
  picks: MarketAtlasPage,
  categories: CategoryAtlasPage,
  shortlist: OpportunityQueuePage,
}

export default function DiscoverHubPage() {
  const { tab } = useParams()
  const activeTab = TABS.find(item => item.key === tab)

  if (!activeTab) {
    return <Navigate to="/discover/shortlist" replace />
  }

  const Content = TAB_CONTENT[tab]

  return (
    <div>
      <div
        className="flex gap-1 overflow-x-auto border-b px-6 pt-4"
        style={{ borderColor: 'var(--border-default)' }}
      >
        {TABS.map(item => (
          <NavLink
            key={item.key}
            to={`/discover/${item.key}`}
            className="min-w-max border-b-2 px-4 py-2 text-sm font-medium"
            style={({ isActive }) => ({
              borderBottomColor: isActive ? 'var(--text-primary)' : 'transparent',
              color: isActive ? 'var(--text-primary)' : 'var(--text-muted)',
            })}
          >
            {item.label}
          </NavLink>
        ))}
      </div>
      <Content />
    </div>
  )
}
