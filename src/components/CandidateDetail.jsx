import { useState } from 'react'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import { supabase } from '../lib/supabase'

const STAGE_ORDER = ['raw', 'screened', 'enriched', 'scored']
const STAGE_LABELS = { raw: 'Raw', screened: 'Screened', enriched: 'Enriched', scored: 'Scored' }
const STAGE_COLORS = {
  raw: 'bg-slate-600',
  screened: 'bg-blue-500',
  enriched: 'bg-purple-500',
  scored: 'bg-green-500',
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
  useState(() => {
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
      <div className="fixed inset-y-0 right-0 w-full max-w-xl bg-slate-900 border-l border-slate-700 z-50 overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-slate-900/95 backdrop-blur-sm border-b border-slate-700/50 px-6 py-4 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-white">{candidate.ingredient_name}</h2>
            <div className="flex items-center gap-2 mt-1">
              {candidate.category && (
                <span className="text-xs px-2 py-0.5 rounded-full bg-slate-700 text-slate-300">{candidate.category}</span>
              )}
              <span className={`text-xs px-2 py-0.5 rounded-full text-white ${STAGE_COLORS[candidate.stage] || 'bg-slate-600'}`}>
                {candidate.stage}
              </span>
              {candidate.source_count > 1 && (
                <span className="text-xs text-slate-400">{candidate.source_count} sources</span>
              )}
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white p-2 rounded-lg hover:bg-slate-800 transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-6 space-y-6">

          {/* Stage Controls */}
          <div>
            <h3 className="text-sm font-semibold text-slate-300 mb-3">Pipeline Stage</h3>
            <div className="flex items-center gap-1 mb-3">
              {STAGE_ORDER.map((stage, i) => (
                <div key={stage} className="flex items-center gap-1">
                  <div className={`w-20 text-center py-1.5 rounded text-xs font-medium ${
                    i <= currentStageIdx
                      ? `${STAGE_COLORS[stage]} text-white`
                      : 'bg-slate-800 text-slate-600'
                  }`}>
                    {STAGE_LABELS[stage]}
                  </div>
                  {i < STAGE_ORDER.length - 1 && (
                    <svg className={`w-4 h-4 ${i < currentStageIdx ? 'text-slate-400' : 'text-slate-700'}`} fill="currentColor" viewBox="0 0 20 20">
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
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg transition-colors"
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
                      className="flex-1 bg-slate-800 border border-red-500/50 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none"
                      autoFocus
                    />
                    <button onClick={kill} className="px-3 py-2 bg-red-600 hover:bg-red-700 text-white text-sm rounded-lg">Kill</button>
                    <button onClick={() => setShowKill(false)} className="px-3 py-2 text-slate-400 text-sm">Cancel</button>
                  </div>
                ) : (
                  <button
                    onClick={() => setShowKill(true)}
                    className="px-4 py-2 bg-slate-800 hover:bg-red-900/30 text-red-400 text-sm font-medium rounded-lg border border-slate-700 hover:border-red-500/30 transition-colors"
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
              <h3 className="text-sm font-semibold text-slate-300 mb-3 flex items-center gap-2">
                Amazon POE Data
                {poe.flagged_high_opportunity && <span className="text-xs">🔥 High Opportunity</span>}
              </h3>
              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: 'Search Vol (90d)', value: formatNum(poe.search_volume_90d) },
                  { label: 'Growth (90d)', value: formatPct(poe.search_volume_growth_90d) },
                  { label: 'Growth (180d)', value: formatPct(poe.search_volume_growth_180d) },
                  { label: 'Avg Price', value: formatUsd(poe.avg_price_usd) },
                  { label: 'Price Range', value: `${formatUsd(poe.min_price_usd)} – ${formatUsd(poe.max_price_usd)}` },
                  { label: 'Top Clicked', value: formatNum(poe.top_clicked_products) },
                  { label: 'Units Sold (360d)', value: `${formatNum(poe.units_sold_lower_360d)} – ${formatNum(poe.units_sold_upper_360d)}` },
                  { label: 'Return Rate', value: formatPct(poe.return_rate) },
                  { label: 'Vol (360d)', value: formatNum(poe.search_volume_360d) },
                ].map(item => (
                  <div key={item.label} className="bg-slate-800/50 rounded-lg px-3 py-2">
                    <div className="text-xs text-slate-500">{item.label}</div>
                    <div className="text-sm text-white font-medium mt-0.5">{item.value}</div>
                  </div>
                ))}
              </div>
              {poe.top_search_term_1 && (
                <div className="mt-3 flex gap-2 flex-wrap">
                  <span className="text-xs text-slate-500">Top terms:</span>
                  {[poe.top_search_term_1, poe.top_search_term_2, poe.top_search_term_3].filter(Boolean).map(t => (
                    <span key={t} className="text-xs bg-slate-800 px-2 py-0.5 rounded text-slate-300">{t}</span>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Datarova Data */}
          {datarova && (
            <div>
              <h3 className="text-sm font-semibold text-slate-300 mb-3">Datarova Keyword Data</h3>
              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: 'Keyword', value: datarova.keyword },
                  { label: 'Ann. Volume', value: formatNum(datarova.search_volume) },
                  { label: 'Growth Trend', value: datarova.search_volume_trend !== null ? formatPct(datarova.search_volume_trend) : '—' },
                  { label: 'Conversion', value: datarova.conversion_rate ? datarova.conversion_rate.toFixed(1) + '%' : '—' },
                  { label: 'Revenue Est', value: datarova.monthly_revenue_est ? '$' + formatNum(Math.round(datarova.monthly_revenue_est)) + '/mo' : '—' },
                ].map(item => (
                  <div key={item.label} className="bg-slate-800/50 rounded-lg px-3 py-2">
                    <div className="text-xs text-slate-500">{item.label}</div>
                    <div className="text-sm text-white font-medium mt-0.5">{item.value}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Differentiation Quick Check */}
          {(candidate.diff_potency !== null || candidate.diff_fit) && (
            <div>
              <h3 className="text-sm font-semibold text-slate-300 mb-3">Differentiation Screen</h3>
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
                    className={`text-xs px-2 py-1 rounded border ${
                      candidate[d.key] === true
                        ? 'bg-green-500/20 text-green-300 border-green-500/30'
                        : candidate[d.key] === false
                        ? 'bg-slate-800 text-slate-600 border-slate-700'
                        : 'bg-slate-800 text-slate-500 border-slate-700/50'
                    }`}
                  >
                    {d.label}
                  </span>
                ))}
                {candidate.diff_green_lights !== null && (
                  <span className="text-xs text-slate-400 self-center ml-1">
                    {candidate.diff_green_lights}/6 green lights
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Claude's Picks for this ingredient */}
          {picks.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-slate-300 mb-3">Claude's Pick History</h3>
              {picks.map(p => (
                <div key={p.id} className="bg-slate-800/50 rounded-lg px-4 py-3 mb-2">
                  <div className="flex justify-between items-center mb-1">
                    <span className="text-xs text-slate-400">Week of {p.week_date} — Rank #{p.rank}</span>
                    {p.feedback_rating && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-slate-700 text-slate-300">{p.feedback_rating}</span>
                    )}
                  </div>
                  <p className="text-sm text-slate-300">{p.rationale}</p>
                  {p.feedback_notes && <p className="text-xs text-slate-500 mt-1">Feedback: {p.feedback_notes}</p>}
                </div>
              ))}
            </div>
          )}

          {/* Notes */}
          <div>
            <h3 className="text-sm font-semibold text-slate-300 mb-3">Notes</h3>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Add notes about this candidate..."
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-3 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 resize-none"
              rows={4}
            />
            <button
              onClick={saveNotes}
              disabled={saving || notes === (candidate.notes || '')}
              className="mt-2 px-4 py-2 bg-slate-700 hover:bg-slate-600 disabled:opacity-40 disabled:hover:bg-slate-700 text-white text-sm rounded-lg transition-colors"
            >
              {saving ? 'Saving...' : 'Save Notes'}
            </button>
          </div>

          {/* Metadata */}
          <div className="border-t border-slate-700/50 pt-4">
            <div className="grid grid-cols-2 gap-2 text-xs text-slate-500">
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
