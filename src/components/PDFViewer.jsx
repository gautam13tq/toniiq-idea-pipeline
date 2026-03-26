import { useState } from 'react'

export default function PDFViewer({ url, filename, onClose }) {
  const [error, setError] = useState(false)

  if (!url) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0, 0, 0, 0.7)' }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-4xl h-[90vh] flex flex-col rounded-lg border"
        style={{ background: 'var(--bg-base)', borderColor: 'var(--border-default)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-6 py-4 border-b"
          style={{ borderColor: 'var(--border-default)' }}
        >
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <span className="text-sm" style={{ color: 'var(--text-muted)' }}>📄</span>
            <h2 className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>
              {filename}
            </h2>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="px-3 py-1.5 text-xs font-medium rounded transition-colors"
              style={{
                background: 'var(--bg-active)',
                color: 'var(--text-primary)',
              }}
              onMouseEnter={(e) => e.target.style.opacity = '0.8'}
              onMouseLeave={(e) => e.target.style.opacity = '1'}
            >
              Download
            </a>
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-xs font-medium rounded transition-colors"
              style={{
                background: 'transparent',
                color: 'var(--text-muted)',
              }}
              onMouseEnter={(e) => {
                e.target.style.background = 'var(--bg-active)'
                e.target.style.color = 'var(--text-primary)'
              }}
              onMouseLeave={(e) => {
                e.target.style.background = 'transparent'
                e.target.style.color = 'var(--text-muted)'
              }}
            >
              Close
            </button>
          </div>
        </div>

        {/* PDF Viewer */}
        <div className="flex-1 overflow-auto">
          {error ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <p className="text-sm mb-2" style={{ color: 'var(--text-muted)' }}>
                  Unable to display PDF preview
                </p>
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs px-3 py-1.5 rounded transition-colors inline-block"
                  style={{
                    background: 'var(--bg-active)',
                    color: 'var(--text-primary)',
                  }}
                >
                  Open in new tab
                </a>
              </div>
            </div>
          ) : (
            <iframe
              src={url}
              title={filename}
              className="w-full h-full border-0"
              onError={() => setError(true)}
            />
          )}
        </div>
      </div>
    </div>
  )
}
