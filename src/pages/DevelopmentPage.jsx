import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'

const STAGES = [
  { key: 'sourcing', label: 'Sourcing', color: 'var(--blue)' },
  { key: 'formulation', label: 'Formulation', color: 'var(--amber)' },
  { key: 'r_and_d', label: 'R&D', color: 'var(--green)' },
  { key: 'pre_greenlight', label: 'Pre-Greenlight', color: '#a78bfa' },
]

const PRIORITY_COLORS = {
  high: { bg: 'var(--red-muted)', text: 'var(--red-text)', border: 'var(--red)' },
  medium: { bg: 'var(--amber-muted)', text: 'var(--amber-text)', border: 'var(--amber)' },
  low: { bg: 'var(--blue-muted)', text: 'var(--blue-text)', border: 'var(--blue)' },
}

function StageBadge({ stage }) {
  const s = STAGES.find(st => st.key === stage) || { label: stage, color: 'var(--text-muted)' }
  return (
    <span
      className="text-[11px] font-medium px-2 py-0.5 rounded-full border"
      style={{ color: s.color, borderColor: s.color, background: `${s.color}15` }}
    >
      {s.label}
    </span>
  )
}

function PriorityDot({ priority }) {
  const p = PRIORITY_COLORS[priority] || PRIORITY_COLORS.medium
  return (
    <span
      className="inline-block w-2 h-2 rounded-full"
      style={{ background: p.border }}
      title={priority}
    />
  )
}

function ProjectCard({ project }) {
  return (
    <Link
      to={`/development/${project.id}`}
      className="block rounded-lg border p-4 transition-colors"
      style={{
        background: 'var(--bg-card)',
        borderColor: 'var(--border-default)',
      }}
      onMouseEnter={(e) => e.currentTarget.style.borderColor = 'var(--border-strong)'}
      onMouseLeave={(e) => e.currentTarget.style.borderColor = 'var(--border-default)'}
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <PriorityDot priority={project.priority} />
          <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
            {project.name}
          </h3>
        </div>
        <StageBadge stage={project.stage} />
      </div>

      {/* Current focus */}
      {project.current_focus && (
        <p className="text-xs mb-3 line-clamp-2" style={{ color: 'var(--text-muted)' }}>
          {project.current_focus}
        </p>
      )}

      {/* Metrics row */}
      <div className="flex items-center gap-4 text-[11px]" style={{ color: 'var(--text-faint)' }}>
        {project.phase_b_composite_score && (
          <span title="Phase B Composite Score">
            Score: <span style={{ color: 'var(--text-muted)' }}>{project.phase_b_composite_score}</span>
          </span>
        )}
        {project.current_cogs && (
          <span title="Current COGS">
            COGS: <span style={{ color: 'var(--text-muted)' }}>${project.current_cogs.toFixed(2)}</span>
          </span>
        )}
        {project.current_ingredient_count && (
          <span title="Ingredients">
            <span style={{ color: 'var(--text-muted)' }}>{project.current_ingredient_count}</span> ingredients
          </span>
        )}
        {project.format && (
          <span style={{ color: 'var(--text-muted)' }}>{project.format}</span>
        )}
      </div>

      {/* Updated timestamp */}
      <div className="mt-3 text-[10px]" style={{ color: 'var(--text-faint)' }}>
        Updated {new Date(project.updated_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
      </div>
    </Link>
  )
}

export default function DevelopmentPage() {
  const [projects, setProjects] = useState([])
  const [loading, setLoading] = useState(true)
  const [viewMode, setViewMode] = useState('kanban') // 'kanban' or 'list'
  const [filterStage, setFilterStage] = useState(null)

  useEffect(() => {
    async function load() {
      const { data, error } = await supabase
        .from('development_projects')
        .select('*')
        .order('priority', { ascending: true })
        .order('updated_at', { ascending: false })

      if (!error && data) setProjects(data)
      setLoading(false)
    }
    load()
  }, [])

  const filteredProjects = filterStage
    ? projects.filter(p => p.stage === filterStage)
    : projects

  const projectsByStage = STAGES.reduce((acc, stage) => {
    acc[stage.key] = projects.filter(p => p.stage === stage.key)
    return acc
  }, {})

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold" style={{ color: 'var(--text-primary)' }}>Development</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>
            {projects.length} active project{projects.length !== 1 ? 's' : ''}
          </p>
        </div>

        <div className="flex items-center gap-3">
          {/* View toggle */}
          <div
            className="flex rounded-lg border overflow-hidden"
            style={{ borderColor: 'var(--border-default)' }}
          >
            <button
              onClick={() => setViewMode('kanban')}
              className="px-3 py-1.5 text-xs font-medium transition-colors"
              style={{
                background: viewMode === 'kanban' ? 'var(--bg-active)' : 'transparent',
                color: viewMode === 'kanban' ? 'var(--text-primary)' : 'var(--text-muted)',
              }}
            >
              Board
            </button>
            <button
              onClick={() => setViewMode('list')}
              className="px-3 py-1.5 text-xs font-medium transition-colors"
              style={{
                background: viewMode === 'list' ? 'var(--bg-active)' : 'transparent',
                color: viewMode === 'list' ? 'var(--text-primary)' : 'var(--text-muted)',
              }}
            >
              List
            </button>
          </div>
        </div>
      </div>

      {/* Stats bar */}
      <div
        className="flex items-center gap-6 px-4 py-3 rounded-lg border mb-6"
        style={{ background: 'var(--bg-raised)', borderColor: 'var(--border-subtle)' }}
      >
        {STAGES.map(stage => {
          const count = projectsByStage[stage.key]?.length || 0
          return (
            <button
              key={stage.key}
              onClick={() => setFilterStage(filterStage === stage.key ? null : stage.key)}
              className="flex items-center gap-2 transition-opacity"
              style={{ opacity: filterStage && filterStage !== stage.key ? 0.4 : 1 }}
            >
              <span
                className="inline-block w-2 h-2 rounded-full"
                style={{ background: stage.color }}
              />
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                {stage.label}
              </span>
              <span className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>
                {count}
              </span>
            </button>
          )
        })}
        {filterStage && (
          <button
            onClick={() => setFilterStage(null)}
            className="ml-auto text-[11px]"
            style={{ color: 'var(--text-faint)' }}
          >
            Clear filter
          </button>
        )}
      </div>

      {loading ? (
        <div className="text-center py-20 text-sm" style={{ color: 'var(--text-muted)' }}>
          Loading projects...
        </div>
      ) : projects.length === 0 ? (
        <div className="text-center py-20">
          <p className="text-sm mb-2" style={{ color: 'var(--text-muted)' }}>No development projects yet</p>
          <p className="text-xs" style={{ color: 'var(--text-faint)' }}>
            Promote a concept from the Concepts page to start development, or add projects via Cowork.
          </p>
        </div>
      ) : viewMode === 'kanban' ? (
        /* Kanban view */
        <div className="grid grid-cols-4 gap-4">
          {STAGES.map(stage => (
            <div key={stage.key}>
              <div className="flex items-center gap-2 mb-3 px-1">
                <span
                  className="inline-block w-2 h-2 rounded-full"
                  style={{ background: stage.color }}
                />
                <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
                  {stage.label}
                </span>
                <span className="text-xs" style={{ color: 'var(--text-faint)' }}>
                  {projectsByStage[stage.key]?.length || 0}
                </span>
              </div>
              <div className="space-y-3">
                {(projectsByStage[stage.key] || []).map(project => (
                  <ProjectCard key={project.id} project={project} />
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        /* List view */
        <div className="space-y-2">
          {filteredProjects.map(project => (
            <ProjectCard key={project.id} project={project} />
          ))}
        </div>
      )}
    </div>
  )
}
