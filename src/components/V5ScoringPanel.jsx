/**
 * V5ScoringPanel — transparent display of Phase B v5.1 hybrid scoring.
 *
 * Renders for any concept whose concept_scores row has v5 fields populated
 * (competitive_frame, pillar_*_score, pillar_competitive_subsignals,
 *  pillar_growth_details, data_quality_summary, competition_gate).
 *
 * Design goal: every score is auditable. User can see WHY each pillar is
 * what it is, with explicit math and the raw data feeding the score.
 */

import { useState } from 'react'

// ── helpers ─────────────────────────────────────────────────────────────
const fmt = (n) => {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return '—'
  const num = Number(n)
  if (num >= 1_000_000) return (num / 1_000_000).toFixed(1) + 'M'
  if (num >= 1_000) return (num / 1_000).toFixed(1) + 'K'
  return num.toLocaleString()
}
const pct = (n) => (n === null || n === undefined ? '—' : `${Number(n).toFixed(1)}%`)
const dollar = (n) => (n === null || n === undefined ? '—' : `$${Number(n).toFixed(2)}`)

const tierColor = (tier) => {
  switch (tier) {
    case 'launch_priority': return { bg: 'var(--green-muted)', text: 'var(--green-text)', border: 'var(--green)' }
    case 'strong_candidate': return { bg: 'var(--blue-muted)', text: 'var(--blue-text)', border: 'var(--blue)' }
    case 'watchlist': return { bg: 'var(--amber-muted)', text: 'var(--amber-text)', border: 'var(--amber)' }
    case 'needs_work': return { bg: 'var(--amber-muted)', text: 'var(--amber-text)', border: 'var(--amber)' }
    case 'pass': return { bg: 'var(--red-muted)', text: 'var(--red-text)', border: 'var(--red)' }
    default: return { bg: 'var(--bg-hover)', text: 'var(--text-body)', border: 'var(--border-default)' }
  }
}

const scoreColor = (score, max = 10) => {
  const r = score / max
  if (r >= 0.7) return 'var(--green-text)'
  if (r >= 0.5) return 'var(--amber-text)'
  return 'var(--red-text)'
}

// ── PillarCard ──────────────────────────────────────────────────────────
function PillarCard({ title, score, weight, contribution, description, onClick, expanded, capped }) {
  const pct = (score / 10) * 100
  return (
    <button
      onClick={onClick}
      className="border rounded-lg p-4 text-left w-full transition-all hover:opacity-90"
      style={{
        background: expanded ? 'var(--bg-hover)' : 'var(--bg-card)',
        borderColor: expanded ? 'var(--blue)' : 'var(--border-default)',
      }}
    >
      <div className="flex items-baseline justify-between mb-2">
        <h4 className="text-sm font-semibold" style={{ color: 'var(--text-body)' }}>{title}</h4>
        <span className="text-xs" style={{ color: 'var(--text-faint)' }}>{(weight * 100).toFixed(0)}% weight</span>
      </div>
      <div className="flex items-baseline gap-2 mb-2">
        <span className="text-3xl font-bold" style={{ color: scoreColor(score) }}>{Number(score).toFixed(1)}</span>
        <span className="text-sm" style={{ color: 'var(--text-muted)' }}>/ 10</span>
        {capped && (
          <span className="text-xs px-2 py-0.5 rounded" style={{ background: 'var(--red-muted)', color: 'var(--red-text)' }}>
            capped
          </span>
        )}
      </div>
      <div className="w-full h-1.5 rounded-full mb-2" style={{ background: 'var(--bg-active)' }}>
        <div
          className="h-full rounded-full"
          style={{ width: `${pct}%`, background: scoreColor(score) }}
        />
      </div>
      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
        Contributes <span style={{ color: 'var(--text-body)', fontWeight: 600 }}>{contribution.toFixed(1)}</span> to composite
      </p>
      {description && <p className="text-xs mt-2" style={{ color: 'var(--text-faint)' }}>{description}</p>}
      <p className="text-xs mt-2" style={{ color: 'var(--blue-text)' }}>
        {expanded ? '▼ hide details' : '▶ show details'}
      </p>
    </button>
  )
}

// ── DemandPillarDetail ──────────────────────────────────────────────────
function DemandPillarDetail({ scores, dataQuality }) {
  const primaryClicks = dataQuality?.demand_primary_clicks
  const totalDataPoints = dataQuality?.demand_total_monthly_data_points
  const rowsWithData = dataQuality?.demand_rows_with_data
  return (
    <div className="border rounded-lg p-4 mt-2" style={{ background: 'var(--bg-card)', borderColor: 'var(--border-default)' }}>
      <h5 className="text-sm font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>Demand pillar — how it's computed</h5>
      <div className="grid grid-cols-3 gap-3 mb-3">
        <Stat label="Primary keyword clicks" value={fmt(primaryClicks)} />
        <Stat label="Keywords with data" value={rowsWithData ?? '—'} />
        <Stat label="Monthly data points" value={totalDataPoints ?? '—'} />
      </div>
      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
        Scoring: primary-keyword click tier (0–4 pts) + aggregate volume (0–3 pts) + conversion intent (0–3 pts).
        Source: Datarova keyword market packet for the inferred buyer-search lane.
      </p>
    </div>
  )
}

// ── GrowthPillarDetail ──────────────────────────────────────────────────
function GrowthPillarDetail({ details }) {
  if (!details) return <NoDataMessage label="growth pillar details" />
  const win = details.windows || {}
  return (
    <div className="border rounded-lg p-4 mt-2" style={{ background: 'var(--bg-card)', borderColor: 'var(--border-default)' }}>
      <h5 className="text-sm font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>Growth pillar — 3-window breakdown</h5>
      <div className="grid grid-cols-3 gap-3 mb-3">
        <WindowStat label="3-month growth" weight="40%" growth={win.growth_3m_pct} score={win.score_3m} />
        <WindowStat label="6-month growth" weight="30%" growth={win.growth_6m_pct} score={win.score_6m} />
        <WindowStat label="12-month (YoY)" weight="30%" growth={win.growth_yoy_pct} score={win.score_yoy} />
      </div>
      {details.trajectory_shape && (
        <div className="text-xs p-2 rounded" style={{ background: 'var(--blue-muted)', color: 'var(--blue-text)' }}>
          <strong>Trajectory:</strong> {details.trajectory_shape}
        </div>
      )}
    </div>
  )
}

function WindowStat({ label, weight, growth, score }) {
  return (
    <div className="border rounded-lg p-3" style={{ background: 'var(--bg-hover)', borderColor: 'var(--border-default)' }}>
      <p className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>{label} <span style={{ color: 'var(--text-faint)' }}>({weight})</span></p>
      <p className="text-lg font-bold" style={{ color: growth >= 0 ? 'var(--green-text)' : 'var(--red-text)' }}>
        {growth !== null && growth !== undefined ? `${growth >= 0 ? '+' : ''}${Number(growth).toFixed(1)}%` : '—'}
      </p>
      {score !== null && score !== undefined && (
        <p className="text-xs mt-1" style={{ color: 'var(--text-faint)' }}>score {Number(score).toFixed(1)}/10</p>
      )}
    </div>
  )
}

// ── CompetitivePillarDetail ─────────────────────────────────────────────
const SUB_SIGNAL_LABELS = {
  review_moat: { label: 'Review moat distribution', weight: 0.25 },
  rev_review_efficiency: { label: 'Revenue / review efficiency', weight: 0.20 },
  bsr_concentration: { label: 'BSR concentration', weight: 0.15 },
  brand_concentration: { label: 'Brand concentration', weight: 0.10 },
  competitor_density: { label: 'Competitor density', weight: 0.10 },
  premium_tier_viability: { label: 'Premium tier viability', weight: 0.10 },
  spec_wedge: { label: 'Spec wedge availability', weight: 0.10 },
}

function CompetitivePillarDetail({ subsignals, dataQuality }) {
  if (!subsignals) return <NoDataMessage label="competitive pillar sub-signals" />
  return (
    <div className="border rounded-lg p-4 mt-2" style={{ background: 'var(--bg-card)', borderColor: 'var(--border-default)' }}>
      <h5 className="text-sm font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>Competitive Landscape — 7 sub-signals</h5>
      <div className="space-y-2 mb-3">
        {Object.entries(SUB_SIGNAL_LABELS).map(([key, meta]) => {
          const s = subsignals[key]
          if (!s) return null
          return (
            <div key={key} className="border rounded p-3" style={{ background: 'var(--bg-hover)', borderColor: 'var(--border-default)' }}>
              <div className="flex items-baseline justify-between mb-1">
                <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{meta.label}</span>
                <div className="flex items-baseline gap-2">
                  <span className="text-lg font-bold" style={{ color: scoreColor(s.score) }}>{Number(s.score).toFixed(1)}</span>
                  <span className="text-xs" style={{ color: 'var(--text-faint)' }}>/10 · {(meta.weight * 100).toFixed(0)}% weight</span>
                </div>
              </div>
              {s.reasoning && (
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{s.reasoning}</p>
              )}
            </div>
          )
        })}
      </div>
      {dataQuality && (
        <div className="text-xs p-2 rounded" style={{ background: 'var(--bg-active)', color: 'var(--text-muted)' }}>
          Data quality: <strong>{dataQuality.included_count}</strong> included · <strong>{dataQuality.adjacent_count ?? 0}</strong> adjacent · <strong>{dataQuality.excluded_count ?? 0}</strong> excluded ·
          Keepa coverage <strong>{pct(dataQuality.keepa_coverage_pct)}</strong> ·
          monthly_sold coverage <strong>{pct(dataQuality.monthly_sold_badge_pct)}</strong>
        </div>
      )}
    </div>
  )
}

// ── DiffPillarDetail ────────────────────────────────────────────────────
function DiffPillarDetail({ scores }) {
  const vectors = scores?.diff_vector_details
  const vectorsAvailable = scores?.diff_vectors_available
  return (
    <div className="border rounded-lg p-4 mt-2" style={{ background: 'var(--bg-card)', borderColor: 'var(--border-default)' }}>
      <h5 className="text-sm font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>Toniiq Differentiation — vectors</h5>
      {vectorsAvailable !== null && vectorsAvailable !== undefined && (
        <p className="text-xs mb-3" style={{ color: 'var(--text-muted)' }}>
          <strong>{vectorsAvailable}</strong> differentiation vectors scored ≥6/10 (out of 7 tested)
        </p>
      )}
      {vectors && typeof vectors === 'object' ? (
        <div className="space-y-2">
          {Object.entries(vectors).map(([key, v]) => (
            <div key={key} className="border rounded p-3" style={{ background: 'var(--bg-hover)', borderColor: 'var(--border-default)' }}>
              <div className="flex items-baseline justify-between mb-1">
                <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{key.replace(/_/g, ' ')}</span>
                <span className="text-lg font-bold" style={{ color: scoreColor(typeof v === 'object' ? v.score : v) }}>
                  {Number(typeof v === 'object' ? v.score : v).toFixed(1)}
                </span>
              </div>
              {typeof v === 'object' && v.reasoning && (
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{v.reasoning}</p>
              )}
            </div>
          ))}
        </div>
      ) : (
        <NoDataMessage label="differentiation vector details (v5.1 backend redesign pending)" />
      )}
    </div>
  )
}

// ── Frame + DataQuality + Gate cards ────────────────────────────────────
function CompetitiveFrameCard({ frame }) {
  if (!frame) return null
  return (
    <div className="border rounded-lg p-4" style={{ background: 'var(--blue-muted)', borderColor: 'var(--blue)' }}>
      <h4 className="text-sm font-semibold mb-2" style={{ color: 'var(--blue-text)' }}>Competitive Frame</h4>
      <div className="grid grid-cols-3 gap-3 mb-2">
        <div>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Frame</p>
          <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{frame.frame || '—'}</p>
        </div>
        <div>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Hero ingredient</p>
          <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{frame.hero_ingredient || '—'}</p>
        </div>
        {frame.delivery_modifier && (
          <div>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Delivery modifier</p>
            <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{frame.delivery_modifier}</p>
          </div>
        )}
      </div>
      {frame.reasoning && (
        <p className="text-xs italic" style={{ color: 'var(--text-body)' }}>{frame.reasoning}</p>
      )}
      {frame.primary_lane_query && (
        <p className="text-xs mt-2" style={{ color: 'var(--text-muted)' }}>
          Primary lane query: <code style={{ background: 'var(--bg-active)', padding: '2px 6px', borderRadius: '3px' }}>{frame.primary_lane_query}</code>
        </p>
      )}
    </div>
  )
}

function DataQualityCard({ summary, gateStatus }) {
  if (!summary) return null
  const passed = gateStatus === 'passed'
  return (
    <div className="border rounded-lg p-4" style={{
      background: passed ? 'var(--green-muted)' : 'var(--red-muted)',
      borderColor: passed ? 'var(--green)' : 'var(--red)',
    }}>
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-sm font-semibold" style={{ color: passed ? 'var(--green-text)' : 'var(--red-text)' }}>
          Data Quality
        </h4>
        <span className="text-xs font-bold px-2 py-1 rounded" style={{
          background: passed ? 'var(--green)' : 'var(--red)',
          color: 'var(--text-inverse)',
        }}>
          {gateStatus || 'unknown'}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div><span style={{ color: 'var(--text-muted)' }}>Included competitors:</span> <strong>{summary.included_count ?? 0}</strong></div>
        <div><span style={{ color: 'var(--text-muted)' }}>Keepa coverage:</span> <strong>{pct(summary.keepa_coverage_pct)}</strong></div>
        <div><span style={{ color: 'var(--text-muted)' }}>monthly_sold coverage:</span> <strong>{pct(summary.monthly_sold_badge_pct)}</strong></div>
        <div><span style={{ color: 'var(--text-muted)' }}>Discovery candidates:</span> <strong>{summary.discovery_result_count ?? 0}</strong></div>
      </div>
    </div>
  )
}

function CompetitionGateCard({ gate }) {
  if (!gate || !gate.caps_applied || gate.caps_applied.length === 0) return null
  return (
    <div className="border rounded-lg p-4" style={{ background: 'var(--amber-muted)', borderColor: 'var(--amber)' }}>
      <h4 className="text-sm font-semibold mb-2" style={{ color: 'var(--amber-text)' }}>Competition Gate Caps Applied</h4>
      <ul className="text-xs space-y-1" style={{ color: 'var(--text-body)' }}>
        {gate.caps_applied.map((cap, i) => (
          <li key={i}>• {typeof cap === 'string' ? cap : cap.reason || JSON.stringify(cap)}</li>
        ))}
      </ul>
      {gate.tier_cap && (
        <p className="text-xs mt-2" style={{ color: 'var(--text-muted)' }}>
          Recommendation tier capped at <strong>{gate.tier_cap}</strong>
        </p>
      )}
    </div>
  )
}

// ── small helpers ──────────────────────────────────────────────────────
function Stat({ label, value }) {
  return (
    <div className="border rounded p-2" style={{ background: 'var(--bg-hover)', borderColor: 'var(--border-default)' }}>
      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{label}</p>
      <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{value}</p>
    </div>
  )
}

function NoDataMessage({ label }) {
  return (
    <p className="text-xs p-3 rounded" style={{ background: 'var(--bg-hover)', color: 'var(--text-faint)' }}>
      No data available for {label}.
    </p>
  )
}

function TierBadgeBig({ tier, score }) {
  const c = tierColor(tier)
  return (
    <div className="inline-flex items-center gap-3 px-4 py-2 rounded-lg border" style={{ background: c.bg, borderColor: c.border }}>
      <span className="text-2xl font-bold" style={{ color: c.text }}>{score ? Number(score).toFixed(1) : '—'}</span>
      <div>
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>composite</p>
        <p className="text-sm font-semibold" style={{ color: c.text }}>{tier || '—'}</p>
      </div>
    </div>
  )
}

// ── main panel ─────────────────────────────────────────────────────────
export default function V5ScoringPanel({ scores }) {
  const [expanded, setExpanded] = useState(null) // 'demand' | 'growth' | 'competitive' | 'diff' | null

  if (!scores) return null

  const frame = scores.competitive_frame
  const isV5 = frame && scores.pillar_competitive_score !== null && scores.pillar_competitive_score !== undefined

  // If not v5 row, render nothing (legacy panels handle pre-v5)
  if (!isV5) return null

  const pillarData = [
    { key: 'demand', title: 'Market Demand', score: scores.pillar_demand_score, weight: 0.20, description: 'How big is the market?' },
    { key: 'growth', title: 'Market Growth', score: scores.pillar_growth_score, weight: 0.15, description: 'Is the market growing?' },
    { key: 'competitive', title: 'Competitive Landscape', score: scores.pillar_competitive_score, weight: 0.35, description: 'Is it winnable?' },
    { key: 'diff', title: 'Toniiq Differentiation', score: scores.pillar_diff_score, weight: 0.30, description: 'Can we differentiate?' },
  ]

  const composite = scores.composite_score
  const tier = scores.recommendation_tier
  const gateStatus = scores.quality_gate_status
  const competitionGate = scores.competition_gate
  const dataQuality = scores.data_quality_summary
  const subsignals = scores.pillar_competitive_subsignals
  const growthDetails = scores.pillar_growth_details

  return (
    <div className="border rounded-lg p-6 mb-6" style={{ background: 'var(--bg-card)', borderColor: 'var(--border-default)' }}>
      {/* Header */}
      <div className="flex items-start justify-between mb-4">
        <div>
          <h3 className="text-lg font-bold mb-1" style={{ color: 'var(--text-primary)' }}>v5.1 Scoring Breakdown</h3>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            Every score below is auditable. Click a pillar card to see how it was reached.
          </p>
        </div>
        <TierBadgeBig tier={tier} score={composite} />
      </div>

      {/* Frame + Data Quality + Gate */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <CompetitiveFrameCard frame={frame} />
        <DataQualityCard summary={dataQuality} gateStatus={gateStatus} />
        <CompetitionGateCard gate={competitionGate} />
      </div>

      {/* 4 pillar cards */}
      <div className="grid grid-cols-4 gap-3 mb-4">
        {pillarData.map((p) => (
          <PillarCard
            key={p.key}
            title={p.title}
            score={p.score}
            weight={p.weight}
            contribution={Number(p.score) * p.weight * 10}
            description={p.description}
            expanded={expanded === p.key}
            onClick={() => setExpanded(expanded === p.key ? null : p.key)}
          />
        ))}
      </div>

      {/* Expanded detail */}
      {expanded === 'demand' && <DemandPillarDetail scores={scores} dataQuality={dataQuality} />}
      {expanded === 'growth' && <GrowthPillarDetail details={growthDetails} />}
      {expanded === 'competitive' && <CompetitivePillarDetail subsignals={subsignals} dataQuality={dataQuality} />}
      {expanded === 'diff' && <DiffPillarDetail scores={scores} />}

      {/* Composite math reminder */}
      <div className="text-xs p-3 rounded mt-4" style={{ background: 'var(--bg-active)', color: 'var(--text-muted)' }}>
        <strong>Composite math:</strong> demand × 20% + growth × 15% + competitive × 35% + differentiation × 30%, all ×10.
        Currently: {pillarData.map(p => `${Number(p.score).toFixed(1)}×${(p.weight*100).toFixed(0)}%`).join(' + ')}
        {` = ${composite ? Number(composite).toFixed(2) : '—'}`}
      </div>
    </div>
  )
}
