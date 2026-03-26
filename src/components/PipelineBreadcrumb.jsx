import { Link } from 'react-router-dom'

export default function PipelineBreadcrumb({ candidate, concept, project, current = 'discovery' }) {
  return (
    <div
      className="flex items-center gap-1 text-sm mb-4 pb-3 border-b"
      style={{
        color: 'var(--text-muted)',
        borderColor: 'var(--border-subtle)',
      }}
    >
      {/* Root: Pipeline */}
      <Link
        to="/"
        className="font-medium transition-colors hover:underline"
        style={{ color: 'var(--blue-text)' }}
      >
        Pipeline
      </Link>

      {/* Level 1: Candidate/Discovery */}
      {candidate && (
        <>
          <span style={{ color: 'var(--text-faint)' }}>›</span>
          {current === 'discovery' ? (
            <span
              className="font-semibold"
              style={{ color: 'var(--text-primary)' }}
            >
              {candidate.ingredient_name}
            </span>
          ) : (
            <Link
              to={`/discovery/${candidate.id}`}
              className="transition-colors hover:underline"
              style={{ color: 'var(--blue-text)' }}
            >
              {candidate.ingredient_name}
            </Link>
          )}
        </>
      )}

      {/* Level 2: Concept */}
      {concept && (
        <>
          <span style={{ color: 'var(--text-faint)' }}>›</span>
          {current === 'concept' ? (
            <span
              className="font-semibold"
              style={{ color: 'var(--text-primary)' }}
            >
              {concept.concept_name}
            </span>
          ) : (
            <Link
              to={`/concepts/${concept.id}`}
              className="transition-colors hover:underline"
              style={{ color: 'var(--blue-text)' }}
            >
              {concept.concept_name}
            </Link>
          )}
        </>
      )}

      {/* Level 3: Development Project */}
      {project && (
        <>
          <span style={{ color: 'var(--text-faint)' }}>›</span>
          {current === 'development' ? (
            <span
              className="font-semibold"
              style={{ color: 'var(--text-primary)' }}
            >
              {project.name}
            </span>
          ) : (
            <Link
              to={`/development/${project.id}`}
              className="transition-colors hover:underline"
              style={{ color: 'var(--blue-text)' }}
            >
              {project.name}
            </Link>
          )}
        </>
      )}
    </div>
  )
}
