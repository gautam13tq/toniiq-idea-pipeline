import { NavLink, Navigate, useParams } from 'react-router-dom'
import EvaluationPage from './EvaluationPage'
import ResearchPage from './ResearchPage'
import ArchivePage from './ArchivePage'

const TABS = [
  { key: 'decide', label: 'Decide' },
  { key: 'research', label: 'In Research' },
  { key: 'archive', label: 'Archive' },
]

const TAB_CONTENT = {
  decide: EvaluationPage,
  research: ResearchPage,
  archive: ArchivePage,
}

export default function PipelinePage() {
  const { tab } = useParams()
  const activeTab = TABS.find(item => item.key === tab)

  if (!activeTab) {
    return <Navigate to="/pipeline/decide" replace />
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
            to={`/pipeline/${item.key}`}
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
