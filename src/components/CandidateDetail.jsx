import { useState, useEffect } from 'react'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import { supabase } from '../lib/supabase'

const STAGE_ORDER = ['raw', 'screened', 'enriched', 'scored']
const STAGE_LABELS = { raw: 'Raw', screened: 'Screened', enriched: 'Enriched', scored: 'Scored' }
const STAGE_COLORS = {
  raw: { background: 'rgba(100,116,139,1)' },
  screened: { background: 'var(--blue)' },
  enriched: { background: 'rgba(147,112,219,1)' },
  scored: { background: 'var(--green)' },
}

function formatNum(n) {
  if (!n) return '—'
  return n.toLocaleString()
}

function formatPct(d) {
  if (d === null || d === undefined) return '—'
  return (d * 100).toFixed(1) + '%'
}

function formatUsd(n) {
  if (!n) return '—'
  return '$' + n.toFixed(2)
}

export default function CandidateDetail({ candidate, poe, datarova, picks, onClose, onUpdate }) {
  const [notes, setNotes] = useState(candidate.notes || '')
  const [saving, setSaving] = useState(false)
  const [killReason, setKillReason] = useState('')
  const [showKill, setShowKill] = useState(false)
  const [poeHistory, setPoeHistory] = useState(null)
  const [datarovaHistory, setDatarovaHistory] = useState(null)

  // Load history on mount
  useEffect(() => {
    if (candidate.id) {
      supabase.from('poe_snapshots')
        .select('*')
        .eq('candidate_id', candidate.id)
        .order('import_date')
        .then(({ data }) => setPoeHistory(data || []))

      supabase.from('datarova_snapshots')
        .select('*')
        .eq('candidate_id', candidate.id)
        .then(({ data }) => setDatarovaHistory(data || []))
    }
  }, [candidate.id])

  async function saveNotes() {
    setSaving(true)
    await onUpdate({ notes })
    setSaving(false)
  }

  function promote() {
    const idx = STAGE_ORDER.indexOf(candidate.stage)
    if (idx < STAGE_ORDER.length - 1) {
      onUpdate({ stage: STAGE_ORDER[idx + 1] })
    }
  }

  function kill() {
    if (killReason.trim()) {
      onUpdate({ stage: 'killed', killed_reason: killReason })
      setShowKill(false)
    }
  }

  const currentStageIdx = STAGE_ORDER.indexOf(candidate.stage)

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/50 z-40" onClick={onClose} />

      {/* Panel */}
      <div className="fixed inset-y-0 right-0 w-full max-w-xl z-50 overflow-y-auto" style={{ background: 'var(--bg-base)', borderLeft: '1px solid var(--border-default)' }}>
        {/* Header */}
        <div className="sticky top-0 backdrop-blur-sm border-b px-6 py-4 flex items-center justify-between" style={{ background: 'rgba(9,9,11,0.95)', borderBottomColor: 'var(--border-default)' }}>
          <div>
            <h2 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>{candidate.ingredient_name}</h2>
            <div className="flex items-center gap-2 mt-1">
              {candidate.category && (
                <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: 'var(--bg-active)', color: 'var(--text-body)' }}>{candidate.category}</span>
              )}
              <span className="text-xs px-2 py-0.5 rounded-full text-white" style={STAGE_COLORS[candidate.stage] || { background: 'rgba(100,116,139,1)' }}>
                {candidate.stage}
              </span>
              {candidate.source_count > 1 && (
                <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{candidate.source_count} sources</span>
              )}
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg transition-colors" style={{ color: 'var(--text-muted)', backgroundColor: 'transparent' }} onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-primary)'; e.currentTarget.style.backgroundColor = 'var(--bg-hover)'; }} onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)'; e.currentTarget.style.backgroundColor = 'transparent'; }}>
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-6 space-y-6">

          {/* Stage Controls */}
          <div>
            <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--text-body)' }}>Pipeline Stage</h3>
            <div className="flex items-center gap-1 mb-3">
              {STAGE_ORDER.map((stage, i) => (
                <div key={stage} className="flex items-center gap-1">
                  <div className="w-20 text-center py-1.5 rounded text-xs font-medium text-white" style={
                    i <= currentStageIdx
                      ? STAGE_COLORS[stage]
                      : { background: 'var(--bg-hover)', color: 'var(--text-faint)' }
                  }>
                    {STAGE_LABELS[stage]}
                  </div>
                  {i < STAGE_ORDER.length - 1 && (
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20" style={{ color: i < currentStageIdx ? 'var(--text-muted)' : 'var(--text-faint)' }}>
                      <path d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" />
                    </svg>
                  )}
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              {currentStageIdx < STAGE_ORDER.length - 1 && candidate.stage !== 'killed' && (
                <button
                  onClick={promote}
                  className="px-4 py-2 text-white text-sm font-medium rounded-lg transition-colors"
                  style={{ background: 'var(--accent)', color: 'var(--text-inverse)' }}
                >
                  Promote to {STAGE_LABELS[STAGE_ORDER[currentStageIdx + 1]]}
                </button>
              )}
              {candidate.stage !== 'killed' && (
                showKill ? (
                  <div className="flex gap-2 items-center flex-1">
                    <input
                      type="text"
                      placeholder="Kill reason..."
                      value={killReason}
                      onChange={e => setKillReason(e.target.value)}
                      className="t-input flex-1"
                      style={{ borderColor: 'rgba(248,113,113,0.5)' }}
                      autoFocus
                    />
                    <button onClick={kill} className="px-3 py-2 text-white text-sm rounded-lg transition-colors" style={{ background: 'var(--red)' }}>Kill</button>
                    <button onClick={() => setShowKill(false)} className="px-3 py-2 text-sm" style={{ color: 'var(--text-muted)' }}>Cancel</button>
                  </div>
                ) : (
                  <button
                    onClick={() => setShowKill(true)}
                    className="px-4 py-2 text-sm font-medium rounded-lg border transition-colors"
                    style={{ background: 'var(--bg-hover)', color: 'var(--red)', borderColor: 'var(--border-default)' }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(248,113,113,0.1)'; e.currentTarget.style.borderColor = 'rgba(248,113,113,0.3)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--bg-hover)'; e.currentTarget.style.borderColor = 'var(--border-default)'; }}
                  >
                    Kill
                  </button>
                )
              )}
            </div>
          </div>

          {/* POE Data */}
          {poe && (
            <div>
              <h3 className="text-sm font-semibold mb-3 flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                <span style={{ color: 'var(--blue)' }}>◆</span> Amazon POE Data
                {poe.flagged_high_opportunity && (
                  <span className="text-xs px-2 py-0.5 rounded" style={{ background: 'var(--green-muted)', color: 'var(--green-text)' }}>🔥 High Opportunity</span>
                )}
              </h3>
              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: 'Search Vol (90d)', value: formatNum(poe.search_volume_90d), color: 'var(--blue-text)' },
                  { label: 'Growth (90d)', value: formatPct(poe.search_volume_growth_90d), color: poe.search_volume_growth_90d > 0 ? 'var(--green-text)' : 'var(--red-text)' },
                  { label: 'Growth (180d)', value: formatPct(poe.search_volume_growth_180d), color: poe.search_volume_growth_180d > 0 ? 'var(--green-text)' : 'var(--red-text)' },
                  { label: 'Avg Price', value: formatUsd(poe.avg_price_usd), color: 'var(--text-primary)' },
                  { label: 'Price Range', value: `${formatUsd(poe.min_price_usd)} – ${formatUsd(poe.max_price_usd)}` },
                  { label: 'Top Clicked', value: formatNum(poe.top_clicked_products) },
                  { label: 'Units Sold (360d)', value: `${formatNum(poe.units_sold_lower_360d)} – ${formatNum(poe.units_sold_upper_360d)}`, color: 'var(--amber-text)' },
                  { label: 'Return Rate', value: formatPct(poe.return_rate), color: poe.return_rate > 0.1 ? 'var(--red-text)' : 'var(--green-text)' },
                  { label: 'Vol (360d)', value: formatNum(poe.search_volume_360d), color: 'var(--blue-text)' },
                ].map(item => (
                  <div key={item.label} className="rounded-lg px-3 py-2" style={{ background: 'var(--bg-hover)' }}>
                    <div className="text-xs" style={{ color: 'var(--text-faint)' }}>{item.label}</div>
                    <div className="text-sm font-medium mt-0.5" style={{ color: item.color || 'var(--text-primary)' }}>{item.value}</div>
                  </div>
                ))}
              </div>
              {poe.top_search_term_1 && (
                <div className="mt-3 flex gap-2 flex-wrap">
                  <span className="text-xs" style={{ color: 'var(--text-faint)' }}>Top terms:</span>
                  {[poe.top_search_term_1, poe.top_search_term_2, poe.top_search_term_3].filter(Boolean).map(t => (
                    <span key={t} className="text-xs px-2 py-0.5 rounded" style={{ background: 'var(--bg-hover)', color: 'var(--text-body)' }}>{t}</span>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Datarova Data */}
          {datarova && (
            <div>
              <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--text-primary)' }}><span style={{ color: 'var(--amber)' }}>◆</span> Datarova Keyword Data</h3>
              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: 'Keyword', value: datarova.keyword },
                  { label: 'Ann. Volume', value: formatNum(datarova.search_volume), color: 'var(--blue-text)' },
                  { label: 'Growth Trend', value: datarova.search_volume_trend !== null ? formatPct(datarova.search_volume_trend) : '—', color: datarova.search_volume_trend > 0 ? 'var(--green-text)' : datarova.search_volume_trend < 0 ? 'var(--red-text)' : null },
                  { label: 'Conversion', value: datarova.conversion_rate ? datarova.conversion_rate.toFixed(1) + '%' : '—', color: datarova.conversion_rate > 10 ? 'var(--green-text)' : datarova.conversion_rate > 5 ? 'var(--amber-text)' : null },
                  { label: 'Revenue Est', value: datarova.monthly_revenue_est ? '$' + formatNum(Math.round(datarova.monthly_revenue_est)) + '/mo' : '—', color: 'var(--green-text)' },
                ].map(item => (
                  <div key={item.label} className="rounded-lg px-3 py-2" style={{ background: 'var(--bg-hover)' }}>
                    <div className="text-xs" style={{ color: 'var(--text-faint)' }}>{item.label}</div>
                    <div className="text-sm font-medium mt-0.5" style={{ color: item.color || 'var(--text-primary)' }}>{item.value}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Differentiation Quick Check */}
          {(candidate.diff_potency !== null || candidate.diff_fit) && (
            <div>
              <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--text-body)' }}>Differentiation Screen</h3>
              <div className="flex gap-2 flex-wrap">
                {[
                  { key: 'diff_potency', label: 'Potency' },
                  { key: 'diff_branded_ingredient', label: 'Branded' },
                  { key: 'diff_purity', label: 'Purity' },
                  { key: 'diff_stack', label: 'Stack' },
                  { key: 'diff_liposync', label: 'LipoSync' },
                  { key: 'diff_format_fit', label: 'Format' },
                ].map(d => (
                  <span
                    key={d.key}
                    className="text-xs px-2 py-1 rounded border"
                    style={
                      candidate[d.key] === true
                        ? { background: 'var(--green-muted)', color: 'var(--green-text)', border: '1px solid rgba(74,222,128,0.3)' }
                        : candidate[d.key] === false
                        ? { background: 'var(--bg-hover)', color: 'var(--text-faint)', border: '1px solid var(--border-default)' }
                        : { background: 'var(--bg-hover)', color: 'var(--text-muted)', border: '1px solid rgba(100,116,139,0.3)' }
                    }
                  >
                    {d.label}
                  </span>
                ))}
                {candidate.diff_green_lights !== null && (
                  <span className="text-xs self-center ml-1" style={{ color: 'var(--text-muted)' }}>
                    {candidate.diff_green_lights}/6 green lights
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Claude's Picks for this ingredient */}
          {picks.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--text-body)' }}>Claude's Pick History</h3>
              {picks.map(p => (
                <div key={p.id} className="rounded-lg px-4 py-3 mb-2" style={{ background: 'var(--bg-hover)' }}>
                  <div className="flex justify-between items-center mb-1">
                    <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Week of {p.week_date} — Rank #{p.rank}</span>
                    {p.feedback_rating && (
                      <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: 'var(--bg-active)', color: 'var(--text-body)' }}>{p.feedback_rating}</span>
                    )}
                  </div>
                  <p className="text-sm" style={{ color: 'var(--text-body)' }}>{p.rationale}</p>
                  {p.feedback_notes && <p className="text-xs mt-1" style={{ color: 'var(--text-faint)' }}>Feedback: {p.feedback_notes}</p>}
                </div>
              ))}
            </div>
          )}

          {/* Notes */}
          <div>
            <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--text-body)' }}>Notes</h3>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Add notes about this candidate..."
              className="t-input w-full px-4 py-3 resize-none"
              rows={4}
            />
            <button
              onClick={saveNotes}
              disabled={saving || notes === (candidate.notes || '')}
              className="mt-2 px-4 py-2 text-sm rounded-lg transition-colors"
              style={{
                background: 'var(--bg-active)',
                color: 'var(--text-primary)',
                opacity: saving || notes === (candidate.notes || '') ? 0.4 : 1,
              }}
              onMouseEnter={(e) => !((saving || notes === (candidate.notes || '')) ? true : false) && (e.currentTarget.style.background = 'var(--bg-hover)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--bg-active)')}
            >
              {saving ? 'Saving...' : 'Save Notes'}
            </button>
          </div>

          {/* Metadata */}
          <div className="border-t pt-4" style={{ borderTopColor: 'var(--border-default)' }}>
            <div className="grid grid-cols-2 gap-2 text-xs" style={{ color: 'var(--text-faint)' }}>
              <div>First surfaced: {new Date(candidate.first_surfaced_at).toLocaleDateString()}</div>
              <div>Last updated: {new Date(candidate.last_updated_at).toLocaleDateString()}</div>
              <div>Week: {candidate.surfaced_week}</div>
              <div>ID: {candidate.id.slice(0, 8)}</div>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
