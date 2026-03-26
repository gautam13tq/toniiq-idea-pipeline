import { useState, useEffect, useCallback } from 'react'
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

function ProjectCard({ project, onDragStart }) {
  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('text/plain', project.id)
        e.dataTransfer.effectAllowed = 'move'
        onDragStart?.(project.id)
      }}
      className="rounded-lg border p-4 transition-colors cursor-grab active:cursor-grabbing"
      style={{
        background: 'var(--bg-card)',
        borderColor: 'var(--border-default)',
      }}
      onMouseEnter={(e) => e.currentTarget.style.borderColor = 'var(--border-strong)'}
      onMouseLeave={(e) => e.currentTarget.style.borderColor = 'var(--border-default)'}
    >
      <Link
        to={`/development/${project.id}`}
        className="block"
        onClick={(e) => e.stopPropagation()}
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
              COGS: <span style={{ color: 'var(--text-muted)' }}>${Number(project.current_cogs).toFixed(2)}</span>
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
    </div>
  )
}

function StageColumn({ stage, projects, onDrop, onDragStart, dragOverStage }) {
  const isOver = dragOverStage === stage.key

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
      }}
      onDragEnter={(e) => {
        e.preventDefault()
        onDrop?.('enter', stage.key)
      }}
      onDragLeave={(e) => {
        // Only trigger if leaving the column entirely
        if (!e.currentTarget.contains(e.relatedTarget)) {
          onDrop?.('leave', stage.key)
        }
      }}
      onDrop={(e) => {
        e.preventDefault()
        const projectId = e.dataTransfer.getData('text/plain')
        onDrop?.('drop', stage.key, projectId)
      }}
      className="rounded-lg p-2 transition-all min-h-[200px]"
      style={{
        background: isOver ? `${stage.color}10` : 'transparent',
        border: isOver ? `2px dashed ${stage.color}` : '2px dashed transparent',
      }}
    >
      <div className="flex items-center gap-2 mb-3 px-1">
        <span
          className="inline-block w-2 h-2 rounded-full"
          style={{ background: stage.color }}
        />
        <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
          {stage.label}
        </span>
        <span className="text-xs" style={{ color: 'var(--text-faint)' }}>
          {projects.length}
        </span>
      </div>
      <div className="space-y-3">
        {projects.map(project => (
          <ProjectCard key={project.id} project={project} onDragStart={onDragStart} />
        ))}
      </div>
    </div>
  )
}

export default function DevelopmentPage() {
  const [projects, setProjects] = useState([])
  const [loading, setLoading] = useState(true)
  const [viewMode, setViewMode] = useState('kanban') // 'kanban' or 'list'
  const [filterStage, setFilterStage] = useState(null)
  const [dragOverStage, setDragOverStage] = useState(null)
  const [draggingId, setDraggingId] = useState(null)

  useEffect(() => {
    async function load() {
      const { data, error } = await supabase
        .from('development_projects')
        .select('*')
        .order('updated_at', { ascending: false })

      if (!error && data) {
        // Custom priority sort: high > medium > low
        const priorityOrder = { high: 0, medium: 1, low: 2 }
        data.sort((a, b) => (priorityOrder[a.priority] ?? 9) - (priorityOrder[b.priority] ?? 9))
        setProjects(data)
      }
      setLoading(false)
    }
    load()
  }, [])

  const handleDragEvent = useCallback(async (type, stageKey, projectId) => {
    if (type === 'enter') {
      setDragOverStage(stageKey)
    } else if (type === 'leave') {
      setDragOverStage(prev => prev === stageKey ? null : prev)
    } else if (type === 'drop') {
      setDragOverStage(null)
      setDraggingId(null)

      if (!projectId) return

      // Find the project
      const project = projects.find(p => p.id === projectId)
      if (!project || project.stage === stageKey) return

      // Optimistic update
      setProjects(prev => prev.map(p =>
        p.id === projectId ? { ...p, stage: stageKey, updated_at: new Date().toISOString() } : p
      ))

      // Persist to Supabase
      const { error } = await supabase
        .from('development_projects')
        .update({ stage: stageKey, updated_at: new Date().toISOString() })
        .eq('id', projectId)

      if (error) {
        // Revert on failure
        setProjects(prev => prev.map(p =>
          p.id === projectId ? { ...p, stage: project.stage } : p
        ))
        console.error('Failed to update stage:', error)
      }
    }
  }, [projects])

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
        /* Kanban view with drag-and-drop */
        <div className="grid grid-cols-4 gap-4">
          {STAGES.map(stage => (
            <StageColumn
              key={stage.key}
              stage={stage}
              projects={projectsByStage[stage.key] || []}
              onDrop={handleDragEvent}
              onDragStart={setDraggingId}
              dragOverStage={dragOverStage}
            />
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
