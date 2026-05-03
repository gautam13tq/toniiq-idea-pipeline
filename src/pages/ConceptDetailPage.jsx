import { useState, useEffect } from 'react'
import { Link, useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Cell } from 'recharts'
import PipelineBreadcrumb from '../components/PipelineBreadcrumb'

/* ═══════════════════════════════════════════════════════════
   SHARED UTILITY COMPONENTS
   ═══════════════════════════════════════════════════════════ */

function ConfidenceBar({ score, max = 10 }) {
  const scoreNum = typeof score === 'number' ? score : parseFloat(score) || 0
  const percentage = Math.min(100, Math.max(0, (scoreNum / max) * 100))
  let color = 'var(--red)'
  if (percentage >= 85) color = 'var(--green)'
  else if (percentage >= 70) color = 'var(--green)'
  else if (percentage >= 50) color = 'var(--amber)'
  return (
    <div className="flex items-center gap-3">
      <div className="flex-1 h-3 rounded-full overflow-hidden max-w-sm" style={{ background: 'var(--bg-active)' }}>
        <div className="h-full transition-all duration-300" style={{ width: `${percentage}%`, background: color }} />
      </div>
      <span className="text-2xl font-bold w-12" style={{ color: 'var(--text-primary)' }}>{scoreNum.toFixed(max === 100 ? 0 : 1)}</span>
    </div>
  )
}

function ActionButton({ onClick, disabled, children, variant = 'primary' }) {
  const baseClass = 'px-4 py-2 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed'
  let variantStyle = {}

  if (variant === 'success') {
    variantStyle = { background: 'var(--green)', color: 'var(--text-inverse)' }
  } else if (variant === 'danger') {
    variantStyle = { background: 'var(--red)', color: 'var(--text-inverse)' }
  } else if (variant === 'secondary') {
    variantStyle = { background: 'var(--bg-hover)', color: 'var(--text-primary)' }
  } else {
    variantStyle = { background: 'var(--accent)', color: 'var(--text-inverse)' }
  }

  return (
    <button onClick={onClick} disabled={disabled} className={baseClass} style={variantStyle}>
      {children}
    </button>
  )
}

function formatNumber(n) {
  if (!n && n !== 0) return '—'
  if (typeof n === 'string') n = parseFloat(n)
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K'
  return n.toLocaleString()
}

function StatCard({ label, value, subtext, color }) {
  return (
    <div className="rounded-lg p-3" style={{ background: 'var(--bg-hover)' }}>
      <p className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>{label}</p>
      <p className="text-lg font-bold" style={{ color: color || 'var(--text-primary)' }}>{value}</p>
      {subtext && <p className="text-xs mt-0.5" style={{ color: 'var(--text-faint)' }}>{subtext}</p>}
    </div>
  )
}

function SectionHeader({ icon, title, badge }) {
  return (
    <div className="flex items-center justify-between mb-4">
      <h3 className="text-lg font-semibold flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
        <span className="text-xl">{icon}</span>
        {title}
      </h3>
      {badge && (
        <span className={`text-sm font-bold px-3 py-1 rounded-full ${badge.class}`}>
          {badge.text}
        </span>
      )}
    </div>
  )
}

function ScoreBadge({ score, max = 10, size = 'md' }) {
  const pct = (score / max) * 100
  const color = pct >= 80 ? 'var(--green-text)' : pct >= 60 ? 'var(--green-text)' : pct >= 40 ? 'var(--amber-text)' : 'var(--red-text)'
  const bgColor = pct >= 80 ? 'var(--green-muted)' : pct >= 60 ? 'var(--green-muted)' : pct >= 40 ? 'var(--amber-muted)' : 'var(--red-muted)'
  const sizeClass = size === 'lg' ? 'text-4xl w-20 h-20' : size === 'md' ? 'text-2xl w-14 h-14' : 'text-lg w-10 h-10'
  return (
    <div className={`${sizeClass} rounded-full flex items-center justify-center`} style={{ background: bgColor }}>
      <span className="font-bold" style={{ color }}>{score}</span>
    </div>
  )
}

function TierBadge({ tier }) {
  const tiers = {
    immediate_launch: { label: 'Immediate Launch', class: 'border', bgStyle: { background: 'var(--green-muted)', color: 'var(--green-text)', borderColor: 'var(--green)' } },
    launch_priority: { label: 'Launch Priority', class: 'border', bgStyle: { background: 'var(--green-muted)', color: 'var(--green-text)', borderColor: 'var(--green)' } },
    strong_candidate: { label: 'Strong Candidate', class: 'border', bgStyle: { background: 'var(--blue-muted)', color: 'var(--blue-text)', borderColor: 'var(--blue)' } },
    needs_work: { label: 'Needs Work', class: 'border', bgStyle: { background: 'var(--amber-muted)', color: 'var(--amber-text)', borderColor: 'var(--amber)' } },
    conditional: { label: 'Conditional', class: 'border', bgStyle: { background: 'var(--amber-muted)', color: 'var(--amber-text)', borderColor: 'var(--amber)' } },
    hold: { label: 'Hold', class: 'border', bgStyle: { background: 'var(--amber-muted)', color: 'var(--amber-text)', borderColor: 'var(--amber)' } },
    pass: { label: 'Pass', class: 'border', bgStyle: { background: 'var(--red-muted)', color: 'var(--red-text)', borderColor: 'var(--red)' } },
    deprioritize: { label: 'Deprioritize', class: 'border', bgStyle: { background: 'var(--red-muted)', color: 'var(--red-text)', borderColor: 'var(--red)' } },
    kill: { label: 'Kill', class: 'border', bgStyle: { background: 'var(--red-muted)', color: 'var(--red-text)', borderColor: 'var(--red)' } },
  }
  // Normalize: handle UPPERCASE or mixed-case tiers
  const normalizedTier = tier ? tier.toLowerCase().replace(/\s+/g, '_') : ''
  const t = tiers[normalizedTier] || { label: tier, class: 'border', bgStyle: { background: 'var(--bg-hover)', color: 'var(--text-body)', borderColor: 'var(--border-default)' } }
  return (
    <span className={`text-sm font-bold px-4 py-1.5 rounded-full ${t.class}`} style={t.bgStyle}>
      {t.label}
    </span>
  )
}

// Highlight numbers, percentages in signal text
function highlightSignal(text) {
  if (!text) return text
  const parts = text.split(/(\+?\d[\d,.]*%|\d[\d,.]*K|\d[\d,.]*M|\d[\d,.]+ clicks(?:\/mo)?|\d[\d,.]+% conversion)/g)
  return parts.map((part, i) => {
    if (/\+?\d[\d,.]*%/.test(part) || /\d[\d,.]*[KM]/.test(part) || /clicks/.test(part) || /conversion/.test(part)) {
      const isGrowth = part.startsWith('+') || part.includes('growth')
      return <span key={i} className="font-semibold" style={{ color: isGrowth ? 'var(--green-text)' : 'var(--text-primary)' }}>{part}</span>
    }
    return part
  })
}

function SignalList({ signals, color = 'var(--blue-text)' }) {
  if (!signals || signals.length === 0) return null
  return (
    <div className="space-y-2">
      {signals.map((signal, i) => (
        <div key={i} className="flex items-start gap-2 text-sm">
          <span className="mt-0.5 flex-shrink-0" style={{ color }}>•</span>
          <span style={{ color: 'var(--text-body)' }}>{typeof signal === 'string' ? highlightSignal(signal) : highlightSignal(signal.signal || signal.finding || signal.theme || signal.pain || signal.note || signal.angle || signal.quote || signal.data || signal.support || (typeof signal === 'object' ? Object.entries(signal).filter(([,v]) => v != null && v !== '').map(([k,v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : (typeof v === 'object' ? Object.values(v).join(' · ') : String(v))}`).join(' · ') : String(signal)))}</span>
        </div>
      ))}
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════
   PHASE A EVIDENCE PANELS (existing, cleaned up)
   ═══════════════════════════════════════════════════════════ */

function KeywordEvidencePanel({ evidence }) {
  if (!evidence || Object.keys(evidence).length === 0) return null
  const { total_monthly_clicks, growth_yoy_pct, growth_3m_pct, primary_keyword_clicks, key_signals = [] } = evidence

  return (
    <div className="border rounded-lg p-6" style={{ background: 'var(--bg-card)', borderColor: 'var(--border-default)' }}>
      <SectionHeader icon="📊" title="Keyword Evidence" />
      {(total_monthly_clicks || growth_yoy_pct || growth_3m_pct) && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
          {total_monthly_clicks && <StatCard label="Monthly Clicks" value={formatNumber(total_monthly_clicks)} />}
          {primary_keyword_clicks && <StatCard label="Primary Keyword" value={formatNumber(primary_keyword_clicks)} />}
          {growth_3m_pct && <StatCard label="3-Month Growth" value={`${parseFloat(growth_3m_pct) > 0 ? '+' : ''}${growth_3m_pct}%`} color={parseFloat(growth_3m_pct) > 0 ? 'var(--green-text)' : 'var(--red-text)'} />}
          {growth_yoy_pct && <StatCard label="Year-over-Year" value={`${parseFloat(growth_yoy_pct) > 0 ? '+' : ''}${growth_yoy_pct}%`} color={parseFloat(growth_yoy_pct) > 0 ? 'var(--green-text)' : 'var(--red-text)'} />}
        </div>
      )}
      {key_signals.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold mb-3" style={{ color: 'var(--text-body)' }}>Key Signals</h4>
          <SignalList signals={key_signals} />
        </div>
      )}
    </div>
  )
}

function RedditEvidencePanel({ evidence }) {
  if (!evidence || Object.keys(evidence).length === 0) return null
  const { reddit_score, key_signals = [] } = evidence
  return (
    <div className="border rounded-lg p-6" style={{ background: 'var(--bg-card)', borderColor: 'var(--border-default)' }}>
      <SectionHeader icon="💬" title="Reddit Research" badge={reddit_score ? { text: `${reddit_score}/10`, class: 'border', style: { background: 'var(--amber-muted)', color: 'var(--amber-text)', borderColor: 'var(--amber)' } } : null} />
      <SignalList signals={key_signals} color="var(--amber-text)" />
    </div>
  )
}

function ScienceEvidencePanel({ evidence }) {
  if (!evidence || Object.keys(evidence).length === 0) return null
  const { key_signals = [] } = evidence
  return (
    <div className="border rounded-lg p-6" style={{ background: 'var(--bg-card)', borderColor: 'var(--border-default)' }}>
      <SectionHeader icon="🧪" title="Science Evidence" />
      <SignalList signals={key_signals} color="#c084fc" />
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════
   PHASE B: COMPOSITE SCORE HERO
   ═══════════════════════════════════════════════════════════ */

function CompositeScoreHero({ scores }) {
  if (!scores) return null

  // 4-pillar scoring framework
  const w = scores.composite_weights || {}
  const pillars = [
    { key: 'market_size', label: 'Market Size', icon: '📊', color: '#6366f1', defaultWeight: 0.20, defaultScore: scores.amazon_competitive_score || 0 },
    { key: 'rev_review_ratio', label: 'Rev/Review Ratio', icon: '💰', color: '#10b981', defaultWeight: 0.30, defaultScore: scores.amazon_competitive_score || 0 },
    { key: 'category_growth', label: 'Category Growth', icon: '📈', color: '#3b82f6', defaultWeight: 0.20, defaultScore: scores.google_trends_score || 0 },
    { key: 'differentiation_potential', label: 'Differentiation', icon: '🎯', color: '#a855f7', defaultWeight: 0.30, defaultScore: scores.differentiation_score || 0 },
  ]

  const pillarData = pillars.map(p => {
    const data = w[p.key] || {}
    const score = data.score ?? p.defaultScore
    const weight = data.weight ?? p.defaultWeight
    return { ...p, score, weight, weighted: score * weight * 10, description: data.description || '' }
  })

  const radarData = pillarData.map(p => ({ dimension: p.label, score: p.score, fullMark: 10 }))
  const barData = pillarData.map(p => ({
    name: `${p.label} (${Math.round(p.weight * 100)}%)`,
    score: p.score,
    weighted: p.weighted,
    fill: p.color,
  }))

  return (
    <div className="border rounded-xl p-8 mb-6" style={{ background: 'var(--bg-card)', borderColor: 'var(--border-default)' }}>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold mb-1" style={{ color: 'var(--text-primary)' }}>Evaluation</h2>
          <p style={{ color: 'var(--text-muted)' }}>Composite score from 4 strategic pillars</p>
        </div>
        <div className="flex items-center gap-4">
          <TierBadge tier={scores.recommendation_tier} />
          <div className="text-right">
            <p className="text-5xl font-bold" style={{ color: 'var(--text-primary)' }}>{parseFloat(scores.composite_score).toFixed(0)}</p>
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>/ 100</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-8">
        {/* Radar Chart */}
        <div className="flex items-center justify-center">
          <ResponsiveContainer width="100%" height={280}>
            <RadarChart data={radarData} cx="50%" cy="50%" outerRadius="75%">
              <PolarGrid stroke="#334155" />
              <PolarAngleAxis dataKey="dimension" tick={{ fill: '#94a3b8', fontSize: 12 }} />
              <PolarRadiusAxis angle={90} domain={[0, 10]} tick={{ fill: '#64748b', fontSize: 10 }} />
              <Radar name="Score" dataKey="score" stroke="#818cf8" fill="#818cf8" fillOpacity={0.25} strokeWidth={2} />
            </RadarChart>
          </ResponsiveContainer>
        </div>

        {/* Weighted Bar Chart */}
        <div>
          <h4 className="text-sm font-semibold mb-3" style={{ color: 'var(--text-body)' }}>Weighted Contribution</h4>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={barData} layout="vertical" margin={{ left: 10, right: 20 }}>
              <XAxis type="number" domain={[0, 30]} tick={{ fill: '#64748b', fontSize: 11 }} />
              <YAxis dataKey="name" type="category" width={140} tick={{ fill: '#94a3b8', fontSize: 11 }} />
              <Tooltip
                contentStyle={{ backgroundColor: 'var(--bg-card)', border: '1px solid #27272a', borderRadius: '8px' }}
                labelStyle={{ color: '#e2e8f0' }}
                formatter={(val) => [`${val.toFixed(1)} pts`, 'Weighted']}
              />
              <Bar dataKey="weighted" radius={[0, 4, 4, 0]}>
                {barData.map((entry, i) => (
                  <Cell key={i} fill={entry.fill} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Pillar Descriptions */}
      <div className="grid grid-cols-2 gap-3 mt-6 pt-6" style={{ borderTop: '1px solid var(--border-default)' }}>
        {pillarData.map(p => (
          <div key={p.key} className="rounded-lg p-3" style={{ background: 'var(--bg-hover)' }}>
            <div className="flex items-center justify-between mb-1">
              <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{p.icon} {p.label}</span>
              <span className="text-sm font-bold" style={{ color: p.color }}>{p.score}/10</span>
            </div>
            {p.description && <p className="text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>{p.description}</p>}
          </div>
        ))}
      </div>

      {/* Assessment */}
      {scores.overall_assessment && (
        <div className="mt-4 pt-4" style={{ borderTop: '1px solid var(--border-default)' }}>
          <p className="leading-relaxed" style={{ color: 'var(--text-body)' }}>{scores.overall_assessment}</p>
        </div>
      )}
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════
   PHASE B: DIMENSION DETAIL PANELS
   ═══════════════════════════════════════════════════════════ */

// Extract brand name from Amazon product title
function extractBrand(title) {
  if (!title) return '—'
  // Check for "by Brand" at end
  const byMatch = title.match(/\bby\s+([A-Z][A-Za-z'']+(?:\s+[A-Z][A-Za-z'']+){0,2})\s*$/)
  if (byMatch) return byMatch[1]
  // Known brand patterns at start of title
  const brandPatterns = [
    /^(Doctor's\s+Best)\b/i, /^(Double\s+Wood)\b/i, /^(NOW\s+Foods)\b/i, /^(NOW)\b/,
    /^(Nutricost)\b/i, /^(Jarrow\s+Formulas)\b/i, /^(Source\s+Naturals)\b/i,
    /^(Life\s+Extension)\b/i, /^(Pure\s+Encapsulations)\b/i, /^(Thorne)\b/i,
    /^(Sports\s+Research)\b/i, /^(Healthy\s+Origins)\b/i, /^(Sundown)\b/i,
    /^(Nature's\s+Way)\b/i, /^(Swanson)\b/i, /^(Bulk\s+Supplements)\b/i,
    /^(Garden\s+of\s+Life)\b/i, /^(Micro\s+Ingredients)\b/i, /^(Vimergy)\b/i,
    /^(Codeage)\b/i, /^(Vital\s+Vitamins)\b/i, /^(Puretality)\b/i,
  ]
  for (const pat of brandPatterns) {
    const m = title.match(pat)
    if (m) return m[1]
  }
  // Heuristic: first word(s) before common supplement keywords
  const genericWords = /^(nattokinase|serrapeptase|liposomal|supplement|enzyme|premium|advanced|maximum|ultra|high|extra|organic|pure|natural|potent|spike|best|new|4-in-1|5-in-1|red|nattokinase\s|liquid|vegan|daily)$/i
  const kwMatch = title.match(/^(.+?)\s+(?:Nattokinase|Serrapeptase|Liposomal|Supplement|Enzyme|Premium|Advanced|Maximum|Ultra|High|Extra)/i)
  if (kwMatch) {
    const candidate = kwMatch[1].trim()
    if (candidate.length > 1 && candidate.length <= 30 && /^[A-Z]/.test(candidate) && !genericWords.test(candidate)) {
      return candidate
    }
  }
  return '—'
}

// Calculate revenue-to-reviews ratio for a set of products
function calcRevReviewMetrics(products) {
  if (!products || products.length === 0) return null
  const withRevenue = products.map(p => {
    const price = parseFloat(p.price) || 0
    const sales = p.monthly_sales || p.salesVolume || 0
    const reviews = p.reviews || p.countReview || 0
    const revenue = price * sales
    return { ...p, revenue, reviews: reviews, revPerReview: reviews > 0 ? revenue / reviews : 0 }
  })
  const top3 = withRevenue.slice(0, 3)
  const top10 = withRevenue.slice(0, 10)

  const avgRR = (arr) => {
    const valid = arr.filter(p => p.revPerReview > 0)
    if (valid.length === 0) return 0
    return valid.reduce((sum, p) => sum + p.revPerReview, 0) / valid.length
  }
  const totalRev = (arr) => arr.reduce((sum, p) => sum + p.revenue, 0)

  return {
    top3RevPerReview: avgRR(top3),
    top10RevPerReview: avgRR(top10),
    top3TotalRevenue: totalRev(top3),
    top10TotalRevenue: totalRev(top10),
    products: withRevenue,
  }
}

function CompetitiveResearchPanel({ data }) {
  if (!data) return null
  const topProducts = Array.isArray(data.top_products) ? data.top_products : []
  const directCompetitors = Array.isArray(data.direct_competitors) ? data.direct_competitors : []
  const positioningGaps = Array.isArray(data.positioning_gaps) ? data.positioning_gaps : []
  const opportunitySignals = Array.isArray(data.opportunity_signals) ? data.opportunity_signals : []
  const riskFactors = Array.isArray(data.risk_factors) ? data.risk_factors : []

  const metrics = calcRevReviewMetrics(topProducts)

  return (
    <div className="border rounded-lg p-6 col-span-2" style={{ background: 'var(--bg-card)', borderColor: 'var(--border-default)' }}>
      <SectionHeader
        icon="🏪"
        title="Amazon Competitive Landscape"
        badge={{ text: `${data.opportunity_score}/10 opportunity`, class: data.opportunity_score >= 7 ? 'border' : 'border', style: data.opportunity_score >= 7 ? { background: 'var(--green-muted)', color: 'var(--green-text)', borderColor: 'var(--green)' } : { background: 'var(--amber-muted)', color: 'var(--amber-text)', borderColor: 'var(--amber)' } }}
      />

      {/* Revenue & Rev/Review Hero Metrics */}
      {metrics && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
          <div className="border rounded-lg p-3" style={{ background: 'var(--blue-muted)', borderColor: 'var(--blue)' }}>
            <p className="text-xs mb-1 font-medium" style={{ color: 'var(--blue-text)' }}>Rev/Review — Top 3</p>
            <p className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>${metrics.top3RevPerReview.toFixed(0)}</p>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-faint)' }}>Higher = easier to enter</p>
          </div>
          <div className="border rounded-lg p-3" style={{ background: 'var(--blue-muted)', borderColor: 'var(--blue)' }}>
            <p className="text-xs mb-1 font-medium" style={{ color: 'var(--blue-text)' }}>Rev/Review — Top 10</p>
            <p className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>${metrics.top10RevPerReview.toFixed(0)}</p>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-faint)' }}>Your entry target zone</p>
          </div>
          <div className="rounded-lg p-3" style={{ background: 'var(--bg-hover)' }}>
            <p className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Top 3 Monthly Rev</p>
            <p className="text-lg font-bold text-emerald-400">${formatNumber(metrics.top3TotalRevenue)}</p>
          </div>
          <div className="rounded-lg p-3" style={{ background: 'var(--bg-hover)' }}>
            <p className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Top 10 Monthly Rev</p>
            <p className="text-lg font-bold text-emerald-300">${formatNumber(metrics.top10TotalRevenue)}</p>
          </div>
        </div>
      )}

      {/* Standard Metrics */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-6">
        <StatCard label="Total Competitors" value={data.total_competitors || '—'} />
        <StatCard label="Median Price" value={data.median_price ? `$${parseFloat(data.median_price).toFixed(2)}` : '—'} />
        <StatCard label="Price Range" value={data.price_range_low && data.price_range_high ? `$${parseFloat(data.price_range_low).toFixed(0)}–$${parseFloat(data.price_range_high).toFixed(0)}` : '—'} />
        <StatCard label="Avg Rating" value={data.avg_rating ? `${parseFloat(data.avg_rating).toFixed(1)}★` : '—'} />
        <StatCard label="10K+ Review Moats" value={data.products_with_10k_reviews ?? '—'} />
      </div>

      {/* Top Products Table — with brand, links, revenue, rev/review */}
      {metrics && metrics.products.length > 0 && (
        <div className="mb-6">
          <h4 className="text-sm font-semibold mb-3" style={{ color: 'var(--text-body)' }}>Top Products by Sales Volume</h4>
          <div className="overflow-x-auto max-h-96 overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10" style={{ background: 'var(--bg-card)' }}>
                <tr style={{ borderBottom: '1px solid var(--border-default)' }}>
                  <th className="text-left py-2 px-2 font-medium w-8" style={{ color: 'var(--text-muted)' }}>#</th>
                  <th className="text-left py-2 px-2 font-medium w-28" style={{ color: 'var(--text-muted)' }}>Brand</th>
                  <th className="text-left py-2 px-2 font-medium" style={{ color: 'var(--text-muted)' }}>Product</th>
                  <th className="text-right py-2 px-2 font-medium w-16" style={{ color: 'var(--text-muted)' }}>Price</th>
                  <th className="text-right py-2 px-2 font-medium w-20" style={{ color: 'var(--text-muted)' }}>Sales/mo</th>
                  <th className="text-right py-2 px-2 font-medium w-24" style={{ color: 'var(--text-muted)' }}>Revenue/mo</th>
                  <th className="text-right py-2 px-2 font-medium w-20" style={{ color: 'var(--text-muted)' }}>Reviews</th>
                  <th className="text-right py-2 px-2 font-medium w-20" style={{ color: 'var(--text-muted)' }}>Rev/Review</th>
                  <th className="text-right py-2 px-2 font-medium w-14" style={{ color: 'var(--text-muted)' }}>Rating</th>
                </tr>
              </thead>
              <tbody>
                {metrics.products.slice(0, 15).map((p, i) => {
                  const title = p.title || p.name || p.productDescription || '—'
                  const brand = p.brand && p.brand !== 'Generic' && p.brand !== 'Generic Liposomal' ? p.brand : extractBrand(title)
                  const amazonUrl = p.url || (p.asin ? `https://amazon.com/dp/${p.asin}` : null)
                  const isTop3 = i < 3
                  return (
                    <tr key={i} className="hover:opacity-80" style={{ borderBottom: '1px solid var(--border-default)', background: isTop3 ? 'var(--bg-hover)' : 'transparent' }}>
                      <td className="py-2 px-2 font-mono" style={{ color: 'var(--text-faint)' }}>{i + 1}</td>
                      <td className="py-2 px-2 font-medium text-xs" style={{ color: 'var(--blue-text)' }}>{brand}</td>
                      <td className="py-2 px-2 max-w-xs">
                        {amazonUrl ? (
                          <a
                            href={amazonUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="transition-colors truncate block"
                            style={{ color: 'var(--text-primary)' }}
                            title={title}
                            onClick={(e) => e.stopPropagation()}
                          >
                            {title.slice(0, 55)}{title.length > 55 ? '…' : ''}
                            <span style={{ color: 'var(--blue)' }} className="ml-1 text-xs">↗</span>
                          </a>
                        ) : (
                          <span className="truncate block" style={{ color: 'var(--text-primary)' }} title={title}>{title.slice(0, 55)}</span>
                        )}
                      </td>
                      <td className="py-2 px-2 text-right" style={{ color: 'var(--text-body)' }}>${parseFloat(p.price || 0).toFixed(2)}</td>
                      <td className="py-2 px-2 text-right font-medium" style={{ color: 'var(--green-text)' }}>{formatNumber(p.monthly_sales || p.salesVolume)}</td>
                      <td className="py-2 px-2 text-right" style={{ color: 'var(--green)' }}>${formatNumber(p.revenue)}</td>
                      <td className="py-2 px-2 text-right" style={{ color: 'var(--text-muted)' }}>{formatNumber(p.reviews)}</td>
                      <td className={`py-2 px-2 text-right font-medium`} style={{ color: p.revPerReview >= 100 ? 'var(--green-text)' : p.revPerReview >= 50 ? 'var(--amber-text)' : 'var(--red-text)' }}>
                        {p.reviews > 0 ? `$${p.revPerReview.toFixed(0)}` : '—'}
                      </td>
                      <td className="py-2 px-2 text-right" style={{ color: 'var(--amber-text)' }}>{p.rating ? parseFloat(p.rating).toFixed(1) : '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <p className="text-xs mt-2" style={{ color: 'var(--text-faint)' }}>Rev/Review = (Price × Monthly Sales) / Reviews. <span style={{ color: 'var(--green-text)' }}>Green ≥ $100</span> (attractive) · <span style={{ color: 'var(--amber-text)' }}>Yellow ≥ $50</span> · <span style={{ color: 'var(--red-text)' }}>Red &lt; $50</span> (review moat)</p>
        </div>
      )}

      {/* Positioning Gaps — rendered as structured cards */}
      <div className="grid grid-cols-2 gap-6">
        <div>
          {positioningGaps.length > 0 && (
            <div className="mb-4">
              <h4 className="text-sm font-semibold mb-3" style={{ color: 'var(--green-text)' }}>Positioning Gaps</h4>
              <div className="space-y-3">
                {positioningGaps.map((gap, i) => {
                  if (typeof gap === 'string') {
                    return (
                      <div key={i} className="flex items-start gap-2 text-sm">
                        <span className="mt-0.5 flex-shrink-0" style={{ color: 'var(--green-text)' }}>•</span>
                        <span style={{ color: 'var(--text-body)' }}>{gap}</span>
                      </div>
                    )
                  }
                  // Structured gap object: { gap, angle, evidence }
                  return (
                    <div key={i} className="rounded-lg p-3 border-l-2" style={{ background: 'var(--bg-hover)', borderColor: 'var(--green)' }}>
                      <p className="text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>{gap.gap || gap.name || '—'}</p>
                      {gap.angle && <p className="text-xs mb-1" style={{ color: 'var(--green-text)' }}>Angle: {gap.angle}</p>}
                      {gap.evidence && <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{gap.evidence}</p>}
                    </div>
                  )
                })}
              </div>
            </div>
          )}
          {opportunitySignals.length > 0 && (
            <div>
              <h4 className="text-sm font-semibold mb-2" style={{ color: 'var(--green-text)' }}>Opportunity Signals</h4>
              <SignalList signals={opportunitySignals} color="var(--green-text)" />
            </div>
          )}
        </div>
        <div>
          {data.differentiation_assessment && (
            <div className="mb-4">
              <h4 className="text-sm font-semibold mb-2" style={{ color: 'var(--text-body)' }}>Differentiation</h4>
              <p className="text-sm" style={{ color: 'var(--text-body)' }}>{data.differentiation_assessment}</p>
            </div>
          )}
          {data.premium_tier_analysis && (
            <div className="mb-4">
              <h4 className="text-sm font-semibold mb-2" style={{ color: 'var(--text-body)' }}>Premium Tier</h4>
              <p className="text-sm" style={{ color: 'var(--text-body)' }}>{data.premium_tier_analysis}</p>
            </div>
          )}
          {riskFactors.length > 0 && (
            <div>
              <h4 className="text-sm font-semibold mb-2" style={{ color: 'var(--red-text)' }}>Risk Factors</h4>
              <SignalList signals={riskFactors} color="var(--red-text)" />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function TikTokResearchPanel({ data }) {
  if (!data) return null
  const queryBreakdown = Array.isArray(data.query_breakdown) ? data.query_breakdown : []
  const topHashtags = Array.isArray(data.top_hashtags) ? data.top_hashtags : []
  const contentThemes = Array.isArray(data.content_themes) ? data.content_themes : []
  const creatorTiers = data.creator_tiers || {}
  const keySignals = Array.isArray(data.key_signals) ? data.key_signals : []

  const lifecycleColors = {
    emerging: { background: 'var(--blue-muted)', color: 'var(--blue-text)' },
    growing: { background: 'var(--green-muted)', color: 'var(--green-text)' },
    mainstream: { background: 'var(--amber-muted)', color: 'var(--amber-text)' },
    declining: { background: 'var(--red-muted)', color: 'var(--red-text)' },
  }

  return (
    <div className="border rounded-lg p-6" style={{ background: 'var(--bg-card)', borderColor: 'var(--border-default)' }}>
      <SectionHeader
        icon="🎵"
        title="TikTok Trend Analysis"
        badge={{ text: `${data.tiktok_score}/10`, class: 'border', style: data.tiktok_score >= 7 ? { background: 'var(--green-muted)', color: 'var(--green-text)', borderColor: 'var(--green)' } : { background: 'var(--amber-muted)', color: 'var(--amber-text)', borderColor: 'var(--amber)' } }}
      />

      {/* Key Metrics */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-6">
        <StatCard label="Total Videos" value={data.total_videos || '—'} subtext={`${data.organic_videos || 0} organic / ${data.ad_videos || 0} ads`} />
        <StatCard label="Total Plays" value={formatNumber(data.total_plays)} color="var(--red-text)" />
        <StatCard label="Total Likes" value={formatNumber(data.total_likes)} />
        <StatCard label="Shares + Saves" value={formatNumber((data.total_shares || 0) + (data.total_saves || 0))} color="var(--blue-text)" />
        <StatCard label="Avg Engagement" value={data.avg_engagement_rate ? `${parseFloat(data.avg_engagement_rate).toFixed(1)}%` : '—'} />
      </div>

      <div className="grid grid-cols-2 gap-6 mb-4">
        {/* Trend Lifecycle */}
        <div>
          <div className="flex items-center gap-3 mb-4">
            <h4 className="text-sm font-semibold" style={{ color: 'var(--text-body)' }}>Trend Lifecycle</h4>
            {data.trend_lifecycle && (
              <span className="text-xs font-medium px-2 py-0.5 rounded-full" style={lifecycleColors[data.trend_lifecycle] || { background: 'var(--bg-hover)', color: 'var(--text-body)' }}>
                {data.trend_lifecycle}
              </span>
            )}
          </div>

          {/* Query Breakdown */}
          {queryBreakdown.length > 0 && (
            <div className="space-y-2 mb-4">
              <h4 className="text-xs font-semibold uppercase" style={{ color: 'var(--text-muted)' }}>By Search Query</h4>
              {queryBreakdown.map((q, i) => (
                <div key={i} className="flex items-center justify-between text-sm rounded px-3 py-2" style={{ background: 'var(--bg-hover)' }}>
                  <span className="truncate max-w-[200px]" style={{ color: 'var(--text-body)' }}>{q.query || q.keyword}</span>
                  <div className="flex items-center gap-3 text-xs">
                    <span style={{ color: 'var(--red-text)' }}>{formatNumber(q.total_plays || q.plays)} plays</span>
                    <span style={{ color: 'var(--text-muted)' }}>{q.video_count || q.videos} videos</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Hashtags + Creator Tiers */}
        <div>
          {topHashtags.length > 0 && (
            <div className="mb-4">
              <h4 className="text-xs font-semibold uppercase mb-2" style={{ color: 'var(--text-muted)' }}>Top Hashtags</h4>
              <div className="flex flex-wrap gap-1.5">
                {topHashtags.slice(0, 12).map((tag, i) => {
                  const name = typeof tag === 'string' ? tag : tag.name || tag.hashtag
                  const count = typeof tag === 'object' ? tag.count || tag.video_count : null
                  return (
                    <span key={i} className="text-xs px-2 py-1 rounded border" style={{ background: 'var(--red-muted)', color: 'var(--red-text)', borderColor: 'var(--red)' }}>
                      #{name}{count ? ` (${count})` : ''}
                    </span>
                  )
                })}
              </div>
            </div>
          )}

          {Object.keys(creatorTiers).length > 0 && (
            <div>
              <h4 className="text-xs font-semibold uppercase mb-2" style={{ color: 'var(--text-muted)' }}>Creator Tiers</h4>
              <div className="grid grid-cols-3 gap-2">
                {Object.entries(creatorTiers).map(([tier, val]) => {
                  // Handle both simple counts and nested objects
                  const displayVal = typeof val === 'number' ? val
                    : typeof val === 'object' && val !== null
                      ? (val.count != null ? val.count : val.percentage != null ? `${val.percentage}%` : val.total != null ? val.total : '—')
                      : String(val)
                  return (
                    <div key={tier} className="rounded p-2 text-center" style={{ background: 'var(--bg-hover)' }}>
                      <p className="text-xs capitalize" style={{ color: 'var(--text-muted)' }}>{tier.replace(/_/g, ' ')}</p>
                      <p className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>{displayVal}</p>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Key Signals */}
      {keySignals.length > 0 && (
        <div className="pt-4" style={{ borderTop: '1px solid var(--border-default)' }}>
          <h4 className="text-sm font-semibold mb-2" style={{ color: 'var(--text-body)' }}>Key Signals</h4>
          <SignalList signals={keySignals} color="var(--red-text)" />
        </div>
      )}

      {data.overall_assessment && (
        <div className="mt-4 pt-4" style={{ borderTop: '1px solid var(--border-default)' }}>
          <p className="text-sm" style={{ color: 'var(--text-body)' }}>{data.overall_assessment}</p>
        </div>
      )}
    </div>
  )
}

function GoogleTrendsPanel({ data }) {
  if (!data) return null
  const keySignals = Array.isArray(data.key_signals) ? data.key_signals : []
  const relatedQueries = Array.isArray(data.related_queries) ? data.related_queries : []
  const dirColors = {
    rising: 'var(--green-text)',
    stable: 'var(--amber-text)',
    declining: 'var(--red-text)',
  }

  return (
    <div className="border rounded-lg p-6" style={{ background: 'var(--bg-card)', borderColor: 'var(--border-default)' }}>
      <SectionHeader
        icon="📈"
        title="Google Trends Validation"
        badge={{ text: `${data.google_trends_score}/10`, class: 'border', style: data.google_trends_score >= 7 ? { background: 'var(--green-muted)', color: 'var(--green-text)', borderColor: 'var(--green)' } : { background: 'var(--amber-muted)', color: 'var(--amber-text)', borderColor: 'var(--amber)' } }}
      />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <StatCard
          label="YoY Growth"
          value={data.yoy_growth_pct ? `+${parseFloat(data.yoy_growth_pct).toFixed(0)}%` : '—'}
          color="var(--green-text)"
        />
        <StatCard
          label="Trend Direction"
          value={data.trend_direction || '—'}
          color={dirColors[data.trend_direction] || 'var(--text-primary)'}
        />
        <StatCard label="Peak Interest" value={data.peak_interest_date || '—'} />
        <StatCard
          label="Current vs Peak"
          value={data.current_vs_peak_pct ? `${parseFloat(data.current_vs_peak_pct).toFixed(0)}%` : '—'}
        />
      </div>

      {data.cross_platform_validation && (
        <div className="mb-4 rounded-lg p-3" style={{ background: 'var(--bg-hover)' }}>
          <h4 className="text-xs font-semibold uppercase mb-1" style={{ color: 'var(--text-muted)' }}>Cross-Platform Validation</h4>
          <p className="text-sm" style={{ color: 'var(--text-body)' }}>{data.cross_platform_validation}</p>
        </div>
      )}

      {keySignals.length > 0 && (
        <div className="mb-4">
          <h4 className="text-sm font-semibold mb-2" style={{ color: 'var(--text-body)' }}>Key Signals</h4>
          <SignalList signals={keySignals} color="var(--green-text)" />
        </div>
      )}

      {relatedQueries.length > 0 && (
        <div className="mb-4">
          <h4 className="text-xs font-semibold uppercase mb-2" style={{ color: 'var(--text-muted)' }}>Related Queries</h4>
          <div className="flex flex-wrap gap-1.5">
            {relatedQueries.slice(0, 10).map((q, i) => {
              const name = typeof q === 'string' ? q : q.query || q.term
              return (
                <span key={i} className="text-xs px-2 py-1 rounded border" style={{ background: 'var(--green-muted)', color: 'var(--green-text)', borderColor: 'var(--green)' }}>
                  {name}
                </span>
              )
            })}
          </div>
        </div>
      )}

      {data.data_source && (
        <p className="text-xs mt-2" style={{ color: 'var(--text-faint)' }}>Data source: {data.data_source}</p>
      )}
    </div>
  )
}

function DifferentiationPanel({ scores }) {
  if (!scores || !scores.diff_total) return null
  const vectorDetails = Array.isArray(scores.diff_vector_details) ? scores.diff_vector_details : []

  const vectors = [
    { name: 'Concentration/Potency', icon: '💪' },
    { name: 'Branded/Patented', icon: '🏷️' },
    { name: 'Purity/Standardization', icon: '🔬' },
    { name: 'Multi-Pathway/Stack', icon: '🔗' },
    { name: 'CFU/Strain Specificity', icon: '🦠' },
    { name: 'Bioavailability/Delivery', icon: '🚀' },
  ]

  const diffTotal = scores.diff_total
  const isAutoKill = diffTotal <= 3

  return (
    <div className="border rounded-lg p-6" style={{ background: 'var(--bg-card)', borderColor: 'var(--border-default)' }}>
      <SectionHeader
        icon="⚡"
        title="Differentiation Scoring"
        badge={{
          text: `${diffTotal}/12`,
          class: 'border',
          style: isAutoKill ? { background: 'var(--red-muted)', color: 'var(--red-text)', borderColor: 'var(--red)' } : diffTotal >= 10 ? { background: 'var(--green-muted)', color: 'var(--green-text)', borderColor: 'var(--green)' } : diffTotal >= 7 ? { background: 'var(--green-muted)', color: 'var(--green-text)', borderColor: 'var(--green)' } : { background: 'var(--amber-muted)', color: 'var(--amber-text)', borderColor: 'var(--amber)' }
        }}
      />

      {isAutoKill && (
        <div className="border rounded-lg p-3 mb-4 text-sm" style={{ background: 'var(--red-muted)', color: 'var(--red-text)', borderColor: 'var(--red)' }}>
          ⚠️ AUTO-KILL: Score ≤3/12 — category doesn't support Toniiq's premium approach
        </div>
      )}

      {/* 4-Layer Breakdown */}
      <div className="grid grid-cols-4 gap-3 mb-6">
        {[
          { label: 'Vectors Available', value: scores.diff_vectors_available, max: 5, description: 'How many of the 6 differentiation vectors are available (capped at 5)' },
          { label: 'Competitive Gap', value: scores.diff_competitive_gap, max: 3, description: '0 = crowded premium lane, 3 = wide open for Toniiq' },
          { label: 'Form Factor Fit', value: scores.diff_form_factor_fit, max: 2, description: '0 = poor format fit, 2 = ideal for capsule/powder' },
          { label: 'Pricing Headroom', value: scores.diff_pricing_headroom, max: 2, description: '0 = no room above $25, 2 = strong $25-45 premium positioning' },
        ].map((item, i) => {
          const val = item.value ?? '—'
          const pct = typeof val === 'number' ? (val / item.max) * 100 : 0
          const color = pct >= 80 ? 'var(--green-text)' : pct >= 60 ? 'var(--amber-text)' : 'var(--red-text)'
          return (
            <div key={i} className="rounded-lg p-3" style={{ background: 'var(--bg-hover)' }} title={item.description}>
              <p className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>{item.label}</p>
              <p className="text-2xl font-bold text-center" style={{ color: typeof val === 'number' ? color : 'var(--text-primary)' }}>
                {val}<span className="text-sm" style={{ color: 'var(--text-faint)' }}>/{item.max}</span>
              </p>
            </div>
          )
        })}
      </div>

      {/* 6 Vectors Checklist */}
      {vectorDetails.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-sm font-semibold mb-2" style={{ color: 'var(--text-body)' }}>6-Vector Assessment</h4>
          {vectorDetails.map((v, i) => {
            const vectorMeta = vectors[i] || { name: v.vector || v.name || `Vector ${i + 1}`, icon: '•' }
            const available = v.available || v.status === 'available' || v.score === true
            return (
              <div key={i} className="flex items-start gap-3 text-sm rounded px-3 py-2" style={{ background: 'var(--bg-hover)' }}>
                <span className="flex-shrink-0 text-lg">{available ? '✅' : '❌'}</span>
                <div>
                  <span className="font-medium" style={{ color: 'var(--text-primary)' }}>{vectorMeta.icon} {v.vector || v.name || vectorMeta.name}</span>
                  {v.justification && <p className="mt-0.5" style={{ color: 'var(--text-muted)' }}>{v.justification}</p>}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function NextStepsPanel({ scores }) {
  if (!scores) return null
  const nextSteps = Array.isArray(scores.next_steps) ? scores.next_steps : []
  const opportunitySignals = Array.isArray(scores.opportunity_signals) ? scores.opportunity_signals : []
  const riskFactors = Array.isArray(scores.risk_factors) ? scores.risk_factors : []

  if (nextSteps.length === 0 && opportunitySignals.length === 0 && riskFactors.length === 0) return null

  return (
    <div className="border rounded-lg p-6" style={{ background: 'var(--bg-card)', borderColor: 'var(--border-default)' }}>
      <SectionHeader icon="🎯" title="Signals & Next Steps" />
      <div className="grid grid-cols-3 gap-6">
        {opportunitySignals.length > 0 && (
          <div>
            <h4 className="text-sm font-semibold mb-2" style={{ color: 'var(--green-text)' }}>Opportunities</h4>
            <SignalList signals={opportunitySignals} color="var(--green-text)" />
          </div>
        )}
        {riskFactors.length > 0 && (
          <div>
            <h4 className="text-sm font-semibold mb-2" style={{ color: 'var(--red-text)' }}>Risks</h4>
            <SignalList signals={riskFactors} color="var(--red-text)" />
          </div>
        )}
        {nextSteps.length > 0 && (
          <div>
            <h4 className="text-sm font-semibold mb-2" style={{ color: 'var(--blue-text)' }}>Next Steps</h4>
            <SignalList signals={nextSteps} color="var(--blue-text)" />
          </div>
        )}
      </div>
    </div>
  )
}


/* ═══════════════════════════════════════════════════════════
   EVIDENCE BUILDER FUNCTIONS
   ═══════════════════════════════════════════════════════════ */

function buildKeywordEvidence(datarovaData, fallback) {
  if (!datarovaData) return fallback
  return {
    total_monthly_clicks: datarovaData.total_monthly_clicks,
    growth_yoy_pct: datarovaData.growth_yoy_clicks_pct,
    growth_3m_pct: datarovaData.growth_3m_clicks_pct,
    primary_keyword_clicks: datarovaData.primary_keyword_clicks,
    key_signals: [
      `${datarovaData.total_related_keywords} keywords tracked with ${Number(datarovaData.avg_conversion_rate || 0).toFixed(1)}% avg conversion`,
      `${formatNumber(datarovaData.total_monthly_sales)} monthly sales across the category`,
      datarovaData.opportunity_summary,
    ].filter(Boolean),
  }
}

function buildRedditEvidence(redditResearchData, fallback) {
  if (!redditResearchData) return fallback
  return {
    reddit_score: redditResearchData.reddit_score,
    key_signals: [
      `${Number((redditResearchData.sentiment_ratio || 0) * 100).toFixed(0)}% positive sentiment across ${redditResearchData.total_posts_analyzed} posts`,
      redditResearchData.score_justification,
      ...(Array.isArray(redditResearchData.underserved_needs)
        ? redditResearchData.underserved_needs.slice(0, 2).map(n => `Unmet need: ${typeof n === 'string' ? n : n.need || n}`)
        : []),
    ].filter(Boolean),
  }
}

function buildScienceEvidence(scienceResearchData, fallback) {
  if (!scienceResearchData) return fallback
  return {
    key_signals: [
      ...(Array.isArray(scienceResearchData.novel_angles)
        ? scienceResearchData.novel_angles.map(a => (typeof a === 'string' ? a : a.angle || a.description || a.support || Object.values(a).filter(v => typeof v === 'string').join(' — ')))
        : []),
      ...(Array.isArray(scienceResearchData.bioavailability_notes)
        ? scienceResearchData.bioavailability_notes.slice(0, 2).map(n => (typeof n === 'string' ? n : [n.note, n.source ? `(${n.source})` : null].filter(Boolean).join(' ') || Object.values(n).filter(v => typeof v === 'string').join(' — ')))
        : []),
      scienceResearchData.safety_notes ? `Safety: ${scienceResearchData.safety_notes.slice(0, 120)}...` : null,
    ].filter(Boolean),
  }
}

/* ═══════════════════════════════════════════════════════════
   MAIN PAGE COMPONENT
   ═══════════════════════════════════════════════════════════ */
export default function ConceptDetailPage() {
  const { conceptId } = useParams()
  const navigate = useNavigate()
  const [concept, setConcept] = useState(null)
  const [candidate, setCandidate] = useState(null)
  const [linkedIngredients, setLinkedIngredients] = useState([])
  const [allConcepts, setAllConcepts] = useState([])
  // Phase B state
  const [competitiveResearch, setCompetitiveResearch] = useState(null)
  const [tiktokResearch, setTiktokResearch] = useState(null)
  const [googleTrends, setGoogleTrends] = useState(null)
  const [conceptScores, setConceptScores] = useState(null)
  // Phase A enrichment data
  const [datarovaData, setDatarovaData] = useState(null)
  const [redditResearchData, setRedditResearchData] = useState(null)
  const [scienceResearchData, setScienceResearchData] = useState(null)
  // Development project link
  const [devProject, setDevProject] = useState(null)
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [activeTab, setActiveTab] = useState('overview') // 'overview' | 'evaluation'

  useEffect(() => {
    loadData()
  }, [conceptId])

  async function loadData() {
    setLoading(true)
    try {
      // Load the concept
      const { data: conceptData, error: conceptError } = await supabase
        .from('product_concepts')
        .select('*')
        .eq('id', conceptId)
        .single()

      if (conceptError) throw conceptError
      setConcept(conceptData)

      // Load the primary candidate
      if (conceptData.candidate_id) {
        const { data: candidateData } = await supabase
          .from('idea_candidates')
          .select('*')
          .eq('id', conceptData.candidate_id)
          .single()
        if (candidateData) setCandidate(candidateData)
      }

      // Load linked ingredients
      const { data: linksData } = await supabase
        .from('concept_ingredient_links')
        .select('candidate_id, role')
        .eq('concept_id', conceptId)

      if (linksData && linksData.length > 0) {
        const linkedCandidateIds = linksData.map(l => l.candidate_id)
        const { data: linkedCandidates } = await supabase
          .from('idea_candidates')
          .select('id, ingredient_name, category')
          .in('id', linkedCandidateIds)

        if (linkedCandidates) {
          const withRoles = linkedCandidates.map(c => ({
            ...c,
            role: linksData.find(l => l.candidate_id === c.id)?.role || 'primary',
          }))
          withRoles.sort((a, b) => (a.role === 'primary' ? -1 : 1))
          setLinkedIngredients(withRoles)
        }
      }

      // Load sibling concepts
      const { data: allConceptsData } = await supabase
        .from('product_concepts')
        .select('id, concept_name, confidence_score')
        .eq('candidate_id', conceptData.candidate_id)
        .order('confidence_score', { ascending: false })

      setAllConcepts(allConceptsData || [])

      // ── Phase B data ──
      const { data: compData } = await supabase
        .from('concept_competitive_research')
        .select('*')
        .eq('concept_id', conceptId)
        .order('researched_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      setCompetitiveResearch(compData)

      const { data: tiktokData } = await supabase
        .from('concept_tiktok_research')
        .select('*')
        .eq('concept_id', conceptId)
        .order('researched_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      setTiktokResearch(tiktokData)

      const { data: trendsData } = await supabase
        .from('concept_google_trends')
        .select('*')
        .eq('concept_id', conceptId)
        .order('researched_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      setGoogleTrends(trendsData)

      const { data: scoresData } = await supabase
        .from('concept_scores')
        .select('*')
        .eq('concept_id', conceptId)
        .order('scored_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      setConceptScores(scoresData)

      // ── Load Phase A enrichment data from enrichment tables ──
      if (conceptData.candidate_id) {
        const { data: darovaData } = await supabase
          .from('datarova_enrichments')
          .select('*')
          .eq('candidate_id', conceptData.candidate_id)
          .order('enriched_at', { ascending: false })
          .limit(1)
          .maybeSingle()
        setDatarovaData(darovaData)

        const { data: redditData } = await supabase
          .from('reddit_concept_research')
          .select('*')
          .eq('candidate_id', conceptData.candidate_id)
          .order('researched_at', { ascending: false })
          .limit(1)
          .maybeSingle()
        setRedditResearchData(redditData)

        const { data: scienceData } = await supabase
          .from('science_concept_research')
          .select('*')
          .eq('candidate_id', conceptData.candidate_id)
          .order('researched_at', { ascending: false })
          .limit(1)
          .maybeSingle()
        setScienceResearchData(scienceData)
      }

      // ── Load development project link ──
      const { data: devProjectData } = await supabase
        .from('development_projects')
        .select('id, name, stage')
        .eq('concept_id', conceptId)
        .maybeSingle()
      if (devProjectData) setDevProject(devProjectData)

    } catch (err) {
      console.error('Error loading concept:', err)
      setMessage('Error loading concept')
    } finally {
      setLoading(false)
    }
  }

  async function updateStatus(newStatus) {
    setActionLoading(true)
    try {
      const { error } = await supabase
        .from('product_concepts')
        .update({
          status: newStatus,
          decided_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', conceptId)

      if (error) throw error
      setConcept(prev => ({ ...prev, status: newStatus, decided_at: new Date().toISOString() }))
      setMessage(`Status updated to "${newStatus}"`)
      setTimeout(() => setMessage(''), 3000)
    } catch (err) {
      console.error('Error updating status:', err)
      setMessage('Error updating status')
    } finally {
      setActionLoading(false)
    }
  }

  if (loading) {
    return (
      <div style={{ background: 'var(--bg-base)', minHeight: '100vh' }}>
        <Header />
        <div className="flex items-center justify-center min-h-[calc(100vh-64px)]">
          <div className="text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 mx-auto mb-4" style={{ borderColor: 'var(--blue-text)' }} />
            <p style={{ color: 'var(--text-muted)' }}>Loading concept...</p>
          </div>
        </div>
      </div>
    )
  }

  if (!concept) {
    return (
      <div style={{ background: 'var(--bg-base)', minHeight: '100vh' }}>
        <Header />
        <div className="flex items-center justify-center min-h-[calc(100vh-64px)]">
          <div className="text-center">
            <p style={{ color: 'var(--text-muted)' }}>Concept not found</p>
            <Link to="/concepts" className="mt-2 inline-block" style={{ color: 'var(--blue-text)' }}>Back to concepts</Link>
          </div>
        </div>
      </div>
    )
  }

  const hasPhaseB = !!(competitiveResearch || tiktokResearch || googleTrends || conceptScores)
  const currentIndex = allConcepts.findIndex(c => c.id === conceptId)
  const prevConcept = currentIndex > 0 ? allConcepts[currentIndex - 1] : null
  const nextConcept = currentIndex < allConcepts.length - 1 ? allConcepts[currentIndex + 1] : null

  const ingredients = Array.isArray(concept.key_ingredients)
    ? concept.key_ingredients.map(ing => {
        if (typeof ing === 'string') return { ingredient: ing, dose: '—', role: '—', notes: '' }
        return ing
      })
    : concept.key_ingredients && typeof concept.key_ingredients === 'object'
      ? Object.entries(concept.key_ingredients).map(([name, data]) => ({
          ingredient: name,
          ...(typeof data === 'object' ? data : { dose: data }),
        }))
      : []

  return (
    <div style={{ background: 'var(--bg-base)', minHeight: '100vh' }}>
      {/* Page Header */}
      <div className="px-6 pt-5 pb-4" style={{ borderColor: 'var(--border-subtle)' }}>
        <PipelineBreadcrumb candidate={candidate} concept={concept} current="concept" />
        <h1 className="text-2xl font-bold tracking-tight" style={{ color: 'var(--text-primary)' }}>
          {concept.concept_name}
        </h1>
        {devProject && (
          <p className="text-sm mt-2" style={{ color: 'var(--text-muted)' }}>
            <Link to={`/development/${devProject.id}`} style={{ color: 'var(--blue-text)' }}>
              View in Development →
            </Link>
          </p>
        )}
      </div>

      <div className="px-6 py-6">
        {/* Tab navigation */}
        {hasPhaseB && (
          <div className="flex rounded-lg p-1 mb-8 w-fit" style={{ background: 'var(--bg-active)' }}>
            <button
              onClick={() => setActiveTab('overview')}
              className="px-4 py-2 rounded-md text-sm font-medium transition-colors"
              style={{
                background: activeTab === 'overview' ? 'var(--accent)' : 'transparent',
                color: activeTab === 'overview' ? 'var(--text-inverse)' : 'var(--text-muted)',
              }}
            >
              Concept Overview
            </button>
            <button
              onClick={() => setActiveTab('evaluation')}
              className="px-4 py-2 rounded-md text-sm font-medium transition-colors flex items-center gap-2"
              style={{
                background: activeTab === 'evaluation' ? 'var(--accent)' : 'transparent',
                color: activeTab === 'evaluation' ? 'var(--text-inverse)' : 'var(--text-muted)',
              }}
            >
              Evaluation
              {conceptScores && (
                <span className="text-xs px-2 py-0.5 rounded-full" style={{
                  background: parseFloat(conceptScores.composite_score) >= 70 ? 'var(--green-muted)' : 'var(--amber-muted)',
                  color: parseFloat(conceptScores.composite_score) >= 70 ? 'var(--green-text)' : 'var(--amber-text)',
                }}>
                  {parseFloat(conceptScores.composite_score).toFixed(0)}
                </span>
              )}
            </button>
          </div>
        )}

        {/* ── OVERVIEW TAB ── */}
        {activeTab === 'overview' && (
          <>
            <div className="grid grid-cols-3 gap-6 mb-8">
              {/* Left column */}
              <div className="col-span-2">
                <div className="border rounded-lg p-8 mb-6" style={{ background: 'var(--bg-card)', borderColor: 'var(--border-default)' }}>
                  <div className="mb-6">
                    <div className="flex items-start justify-between mb-4">
                      <div>
                        <div className="flex items-center gap-3 mb-2">
                          <h1 className="text-3xl font-bold" style={{ color: 'var(--text-primary)' }}>{concept.concept_name}</h1>
                          {hasPhaseB && (
                            <span className="text-xs font-medium px-2 py-1 rounded-full border" style={{ background: 'var(--blue-muted)', color: 'var(--blue-text)', borderColor: 'var(--blue)' }}>
                              Phase B
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 flex-wrap">
                          {linkedIngredients.map(ing => (
                            <Link
                              key={ing.id}
                              to={`/discovery/${ing.id}`}
                              className="inline-flex items-center gap-1.5 text-sm px-3 py-1 rounded-full border transition-all"
                              style={{
                                background: 'var(--bg-hover)',
                                color: 'var(--text-body)',
                                borderColor: 'var(--border-default)',
                              }}
                            >
                              {ing.ingredient_name}
                              {ing.role === 'secondary' && <span className="text-xs" style={{ color: 'var(--text-faint)' }}>(secondary)</span>}
                              <span style={{ color: 'var(--text-faint)' }}>→</span>
                            </Link>
                          ))}
                          {linkedIngredients.length === 0 && candidate && (
                            <Link
                              to={`/discovery/${candidate.id}`}
                              className="inline-flex items-center gap-1.5 text-sm px-3 py-1 rounded-full border transition-all"
                              style={{
                                background: 'var(--bg-hover)',
                                color: 'var(--text-body)',
                                borderColor: 'var(--border-default)',
                              }}
                            >
                              {candidate.ingredient_name}
                              <span style={{ color: 'var(--text-faint)' }}>→</span>
                            </Link>
                          )}
                        </div>
                      </div>
                      <span className="text-xs font-bold px-3 py-1.5 rounded-full flex-shrink-0" style={{
                        background: concept.status === 'accepted' ? 'var(--green-muted)' : concept.status === 'rejected' ? 'var(--red-muted)' : 'var(--bg-hover)',
                        color: concept.status === 'accepted' ? 'var(--green-text)' : concept.status === 'rejected' ? 'var(--red-text)' : 'var(--text-body)',
                      }}>
                        {concept.status}
                      </span>
                    </div>

                    {/* Show composite score if available, else confidence score */}
                    <div className="mb-6">
                      {conceptScores ? (
                        <div>
                          <div className="flex items-center gap-4 mb-1">
                            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Composite Score</p>
                            <TierBadge tier={conceptScores.recommendation_tier} />
                          </div>
                          <ConfidenceBar score={parseFloat(conceptScores.composite_score)} max={100} />
                        </div>
                      ) : (
                        <div>
                          <p className="text-sm mb-2" style={{ color: 'var(--text-muted)' }}>Confidence Score (Phase A)</p>
                          <ConfidenceBar score={concept.confidence_score} />
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="pt-6" style={{ borderTop: '1px solid var(--border-default)' }}>
                    <h2 className="text-lg font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>Positioning Angle</h2>
                    {concept.positioning_angle ? (
                      <p className="text-lg italic leading-relaxed" style={{ color: 'var(--text-body)' }}>"{concept.positioning_angle}"</p>
                    ) : (
                      <p style={{ color: 'var(--text-faint)' }}>No positioning angle provided</p>
                    )}
                  </div>
                </div>

                {/* Key Ingredients table */}
                {ingredients.length > 0 && (
                  <div className="border rounded-lg p-6 mb-6" style={{ background: 'var(--bg-card)', borderColor: 'var(--border-default)' }}>
                    <h2 className="text-lg font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>Key Ingredients</h2>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr style={{ borderBottom: '1px solid var(--border-default)' }}>
                            <th className="text-left py-2 px-3 font-medium" style={{ color: 'var(--text-muted)' }}>Ingredient</th>
                            <th className="text-left py-2 px-3 font-medium" style={{ color: 'var(--text-muted)' }}>Dosage</th>
                            <th className="text-left py-2 px-3 font-medium" style={{ color: 'var(--text-muted)' }}>Role</th>
                            <th className="text-left py-2 px-3 font-medium" style={{ color: 'var(--text-muted)' }}>Notes</th>
                          </tr>
                        </thead>
                        <tbody>
                          {ingredients.map((ing, i) => (
                            <tr key={i} className="hover:opacity-80" style={{ borderBottom: '1px solid var(--border-default)' }}>
                              <td className="py-2 px-3 font-medium" style={{ color: 'var(--text-primary)' }}>{ing.ingredient || ing.name || '—'}</td>
                              <td className="py-2 px-3" style={{ color: 'var(--text-body)' }}>{ing.dose || ing.dosage || '—'}</td>
                              <td className="py-2 px-3" style={{ color: 'var(--text-muted)' }}>{ing.role || '—'}</td>
                              <td className="py-2 px-3 text-xs" style={{ color: 'var(--text-faint)' }}>{ing.notes || ''}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {concept.confidence_reasoning && (
                  <div className="border rounded-lg p-6" style={{ background: 'var(--bg-card)', borderColor: 'var(--border-default)' }}>
                    <h2 className="text-lg font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>Why This Score?</h2>
                    <p className="leading-relaxed" style={{ color: 'var(--text-body)' }}>{concept.confidence_reasoning}</p>
                  </div>
                )}
              </div>

              {/* Right column: actions + metadata */}
              <div>
                <div className="border rounded-lg p-6 sticky top-24" style={{ background: 'var(--bg-card)', borderColor: 'var(--border-default)' }}>
                  <h3 className="text-lg font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>Actions</h3>
                  <div className="space-y-3 mb-6">
                    <ActionButton onClick={() => updateStatus('accepted')} disabled={actionLoading || concept.status === 'accepted'} variant="success">
                      ✓ Accept — run evaluation
                    </ActionButton>
                    <ActionButton onClick={() => updateStatus('rejected')} disabled={actionLoading || concept.status === 'rejected'} variant="danger">
                      ✕ Reject
                    </ActionButton>
                    <ActionButton onClick={() => updateStatus('parked')} disabled={actionLoading || concept.status === 'parked'} variant="secondary">
                      ⏸ Park
                    </ActionButton>
                    {/* Greenlight is available for any scored concept (evaluated OR
                        legacy accepted-with-score). The actual move-to-dev happens after greenlight
                        when the user clicks "Mark in development" on the Development page. */}
                    {(concept.status === 'evaluated' || (concept.status === 'accepted' && conceptScores)) && (
                      <ActionButton onClick={() => updateStatus('greenlit')} disabled={actionLoading} variant="success">
                        ✓✓ Greenlight → Development
                      </ActionButton>
                    )}
                    {concept.status === 'greenlit' && (
                      <ActionButton onClick={() => updateStatus('in_development')} disabled={actionLoading} variant="success">
                        ▣ Mark In-Development
                      </ActionButton>
                    )}
                    {concept.status !== 'proposed' && (
                      <ActionButton onClick={() => updateStatus('proposed')} disabled={actionLoading} variant="secondary">
                        ↻ Reset to Proposed
                      </ActionButton>
                    )}
                  </div>

                  {message && (
                    <div className="text-sm px-3 py-2 rounded mb-4" style={{
                      background: message.includes('Error') ? 'var(--red-muted)' : 'var(--green-muted)',
                      color: message.includes('Error') ? 'var(--red-text)' : 'var(--green-text)',
                    }}>
                      {message}
                    </div>
                  )}

                  {/* Quick Phase B scores */}
                  {conceptScores && (
                    <div className="pt-4 mb-4" style={{ borderTop: '1px solid var(--border-default)' }}>
                      <h4 className="text-sm font-semibold mb-3" style={{ color: 'var(--text-body)' }}>Evaluation Scores</h4>
                      <div className="space-y-2">
                        {[
                          { label: 'Amazon', score: conceptScores.amazon_competitive_score, color: 'var(--blue)' },
                          { label: 'Keywords', score: conceptScores.keyword_demand_score, color: '#3b82f6' },
                          { label: 'Trends', score: conceptScores.google_trends_score, color: 'var(--green)' },
                          { label: 'TikTok', score: conceptScores.tiktok_score, color: 'var(--red)' },
                          { label: 'Differentiation', score: conceptScores.differentiation_score, color: '#a855f7' },
                        ].map(({ label, score, color }) => (
                          <div key={label} className="flex items-center gap-2 text-sm">
                            <span style={{ color: 'var(--text-muted)' }} className="w-24">{label}</span>
                            <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: 'var(--bg-active)' }}>
                              <div className="h-full rounded-full" style={{ width: `${(score || 0) * 10}%`, background: color }} />
                            </div>
                            <span className="font-medium w-6 text-right" style={{ color: 'var(--text-primary)' }}>{score || '—'}</span>
                          </div>
                        ))}
                      </div>
                      <button
                        onClick={() => setActiveTab('evaluation')}
                        className="text-xs mt-3 font-medium"
                        style={{ color: 'var(--blue-text)' }}
                      >
                        View full evaluation →
                      </button>
                    </div>
                  )}

                  {/* Metadata */}
                  <div className="pt-4 space-y-3 text-sm" style={{ borderTop: '1px solid var(--border-default)' }}>
                    <div>
                      <p style={{ color: 'var(--text-muted)' }}>Format</p>
                      <p style={{ color: 'var(--text-body)' }}>{concept.format || '—'}</p>
                    </div>
                    <div>
                      <p style={{ color: 'var(--text-muted)' }}>Target Dosage</p>
                      <p style={{ color: 'var(--text-body)' }}>{concept.target_dosage || '—'}</p>
                    </div>
                    <div>
                      <p style={{ color: 'var(--text-muted)' }}>Type</p>
                      <p style={{ color: 'var(--text-body)' }}>{concept.concept_type?.replace(/_/g, ' ') || '—'}</p>
                    </div>
                  </div>

                  {allConcepts.length > 1 && (
                    <div className="pt-4 mt-4" style={{ borderTop: '1px solid var(--border-default)' }}>
                      <p className="text-sm mb-2" style={{ color: 'var(--text-muted)' }}>Other concepts for this ingredient</p>
                      <div className="space-y-1.5">
                        {allConcepts.filter(c => c.id !== conceptId).map(c => (
                          <button
                            key={c.id}
                            onClick={() => navigate(`/concepts/${c.id}`)}
                            className="w-full text-left text-sm transition-colors py-1 flex justify-between"
                            style={{ color: 'var(--text-body)' }}
                          >
                            <span className="truncate">{c.concept_name}</span>
                            <span className="flex-shrink-0 ml-2" style={{ color: 'var(--text-faint)' }}>{parseFloat(c.confidence_score).toFixed(1)}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Phase A Evidence */}
            <div className="mb-8">
              <h2 className="text-2xl font-bold mb-6" style={{ color: 'var(--text-primary)' }}>Phase A Evidence</h2>
              <div className="grid grid-cols-3 gap-6">
                <KeywordEvidencePanel evidence={buildKeywordEvidence(datarovaData, concept.keyword_evidence)} />
                <RedditEvidencePanel evidence={buildRedditEvidence(redditResearchData, concept.reddit_evidence)} />
                <ScienceEvidencePanel evidence={buildScienceEvidence(scienceResearchData, concept.science_evidence)} />
              </div>
            </div>
          </>
        )}

        {/* ── EVALUATION TAB (Phase B) ── */}
        {activeTab === 'evaluation' && hasPhaseB && (
          <div className="space-y-6">
            {/* Composite Score Hero */}
            <CompositeScoreHero scores={conceptScores} />

            {/* Amazon Competitive — full width (most important section) */}
            <div className="grid grid-cols-2 gap-6">
              <CompetitiveResearchPanel data={competitiveResearch} />
            </div>

            {/* Other dimension panels in 2-col grid */}
            <div className="grid grid-cols-2 gap-6">
              <TikTokResearchPanel data={tiktokResearch} />
              <GoogleTrendsPanel data={googleTrends} />
            </div>

            <div className="grid grid-cols-2 gap-6">
              <DifferentiationPanel scores={conceptScores} />
            </div>

            {/* Next Steps */}
            <NextStepsPanel scores={conceptScores} />
          </div>
        )}

        {/* No Phase B data message */}
        {activeTab === 'evaluation' && !hasPhaseB && (
          <div className="text-center py-20">
            <div className="text-4xl mb-4">🔬</div>
            <h2 className="text-xl font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>No Phase B data yet</h2>
            <p style={{ color: 'var(--text-muted)' }}>Select this concept for Phase B evaluation to generate competitive research, trend analysis, and scoring.</p>
          </div>
        )}

        {/* Navigation */}
        {(prevConcept || nextConcept) && (
          <div className="flex justify-between items-center pt-8 mt-8" style={{ borderTop: '1px solid var(--border-default)' }}>
            {prevConcept ? (
              <button onClick={() => navigate(`/concepts/${prevConcept.id}`)} className="flex items-center gap-2 text-sm font-medium" style={{ color: 'var(--blue-text)' }}>
                ← {prevConcept.concept_name}
              </button>
            ) : <div />}
            <Link to="/concepts" className="text-sm" style={{ color: 'var(--text-muted)' }}>View all concepts</Link>
            {nextConcept ? (
              <button onClick={() => navigate(`/concepts/${nextConcept.id}`)} className="flex items-center gap-2 text-sm font-medium" style={{ color: 'var(--blue-text)' }}>
                {nextConcept.concept_name} →
              </button>
            ) : <div />}
          </div>
        )}
      </div>
    </div>
  )
}

function Header() {
  return (
    <header className="border-b sticky top-0 z-30 backdrop-blur-sm" style={{ borderColor: 'var(--border-default)', background: 'var(--bg-base)' }}>
      <div className="max-w-[1600px] mx-auto px-6 py-4">
        <Link to="/" className="text-xl font-semibold transition-colors" style={{ color: 'var(--text-primary)' }}>
          Toniiq Idea Pipeline
        </Link>
      </div>
    </header>
  )
}
