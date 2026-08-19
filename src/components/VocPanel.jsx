import { useState } from 'react'
import { supabase } from '../lib/supabase'

/**
 * Voice-of-Customer panel — shown on each Evaluation idea card.
 *
 * Data contract (voc_insights row):
 *   synthesis      JSONB {themes:[{kind, label, asins[], count, review_ids[]}], corpus_size}
 *                  — the agent-readable layer; every theme cites corpus review IDs.
 *   synthesis_md   full narrative report (markdown, human-readable)
 *   acceptance     JSONB mechanical-verification record (what was checked, by whom)
 *   Corpus rows live in voc_review_corpus keyed by (category_slug, review_id).
 *
 * No insight yet → "Run VoC mining" queues a run_voc_mining pending_action;
 * a Claude/Codex session (or, later, an autonomous agent) picks it up.
 */

const KIND_STYLE = {
  purchase_driver: { bg: 'var(--green-muted)', color: 'var(--green-text)', label: 'Why people buy' },
  negative: { bg: 'var(--red-muted)', color: 'var(--red-text)', label: 'Negative themes' },
  unmet_need: { bg: 'var(--amber-muted)', color: 'var(--amber-text)', label: 'Unmet needs' },
}

function ThemeChips({ themes, kind, limit }) {
  const style = KIND_STYLE[kind]
  const list = themes.filter(t => t.kind === kind).sort((a, b) => b.count - a.count)
  const shown = limit ? list.slice(0, limit) : list
  return (
    <div className="flex flex-wrap gap-1.5">
      {shown.map(t => (
        <span key={t.label} className="text-[11px] px-2 py-0.5 rounded-full"
          style={{ background: style.bg, color: style.color }}
          title={`${t.count} reviews · ASINs: ${(t.asins || []).join(', ')}`}>
          {t.label.length > 48 ? t.label.slice(0, 48) + '…' : t.label} <span className="opacity-70">{t.count}</span>
        </span>
      ))}
    </div>
  )
}

export default function VocPanel({ idea, insight }) {
  const [expanded, setExpanded] = useState(false)
  const [showReport, setShowReport] = useState(false)
  const [queued, setQueued] = useState(false)

  async function queueVocMining() {
    const { error } = await supabase.from('pending_actions').insert({
      entity_type: 'idea',
      entity_id: idea.id,
      action: 'run_voc_mining',
      triggered_by: 'ui',
      context: { ingredient_name: idea.ingredient_name },
    })
    if (error) { alert(`Failed to queue: ${error.message}`); return }
    setQueued(true)
  }

  if (!insight) {
    return (
      <div className="px-5 py-2 border-b flex items-center gap-3" style={{ borderColor: 'var(--border-default)', background: 'var(--bg-base)' }}>
        <span className="text-[11px]" style={{ color: 'var(--text-faint)' }}>◈ Voice of Customer — not mined yet</span>
        {queued ? (
          <span className="text-[11px]" style={{ color: 'var(--amber-text)' }}>Queued — a Claude session picks this up</span>
        ) : (
          <button onClick={queueVocMining} className="text-[11px] px-2 py-0.5 rounded"
            style={{ background: 'var(--bg-active)', color: 'var(--text-muted)', border: '1px solid var(--border-default)' }}>
            Run VoC mining
          </button>
        )}
      </div>
    )
  }

  const themes = insight.synthesis?.themes || []
  const acceptance = insight.acceptance || {}

  return (
    <div className="border-b" style={{ borderColor: 'var(--border-default)', background: 'var(--bg-base)' }}>
      <button onClick={() => setExpanded(!expanded)} className="w-full px-5 py-2.5 flex items-center gap-3 text-left">
        <span className="text-[11px] font-semibold uppercase tracking-wider flex-shrink-0" style={{ color: 'var(--text-muted)' }}>
          ◈ Voice of Customer
        </span>
        <span className="text-[11px] flex-shrink-0" style={{ color: 'var(--text-faint)' }}>
          {insight.corpus_size} reviews · {Object.keys(insight.asin_coverage || {}).length} products · verified ✓
        </span>
        {!expanded && <div className="flex-1 min-w-0 overflow-hidden" style={{ maxHeight: 22 }}><ThemeChips themes={themes} kind="negative" limit={2} /></div>}
        <span className="ml-auto text-[11px] flex-shrink-0" style={{ color: 'var(--text-faint)' }}>{expanded ? '▾ collapse' : '▸ expand'}</span>
      </button>

      {expanded && (
        <div className="px-5 pb-4 space-y-3">
          {['purchase_driver', 'negative', 'unmet_need'].map(kind => (
            <div key={kind}>
              <p className="text-[10px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-faint)' }}>
                {KIND_STYLE[kind].label}
              </p>
              <ThemeChips themes={themes} kind={kind} />
            </div>
          ))}

          <div className="flex items-center gap-3 pt-1">
            <button onClick={() => setShowReport(!showReport)} className="text-[11px] px-2.5 py-1 rounded"
              style={{ background: 'var(--bg-active)', color: 'var(--text-muted)', border: '1px solid var(--border-default)' }}>
              {showReport ? 'Hide full report' : 'Read full report'}
            </button>
            <span className="text-[10px]" style={{ color: 'var(--text-faint)' }}>
              {acceptance.corpus_source || ''} · quotes {acceptance.quote_spot_check || 'verified'} · {new Date(insight.created_at).toLocaleDateString()}
            </span>
          </div>

          {showReport && (
            <div className="rounded-md border overflow-y-auto p-4 text-xs leading-relaxed"
              style={{ borderColor: 'var(--border-default)', background: 'var(--bg-card)', color: 'var(--text-muted)', maxHeight: 480, whiteSpace: 'pre-wrap', fontFamily: 'inherit' }}>
              {insight.synthesis_md}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
