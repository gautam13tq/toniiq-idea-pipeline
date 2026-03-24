import { useState, useEffect } from 'react'
import { Link, useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Cell } from 'recharts'

/* ═══════════════════════════════════════════════════════════
   SHARED UTILITY COMPONENTS
   ═══════════════════════════════════════════════════════════ */

function ConfidenceBar({ score, max = 10 }) {
  const scoreNum = typeof score === 'number' ? score : parseFloat(score) || 0
  const percentage = Math.min(100, Math.max(0, (scoreNum / max) * 100))
  let color = 'bg-red-500'
  if (percentage >= 85) color = 'bg-green-500'
  else if (percentage >= 70) color = 'bg-emerald-500'
  else if (percentage >= 50) color = 'bg-yellow-500'
  return (
    <div className="flex items-center gap-3">
      <div className="flex-1 h-3 bg-slate-700 rounded-full overflow-hidden max-w-sm">
        <div className={`h-full ${color} transition-all duration-300`} style={{ width: `${percentage}%` }} />
      </div>
      <span className="text-2xl font-bold text-white w-12">{scoreNum.toFixed(max === 100 ? 0 : 1)}</span>
    </div>
  )
}

function ActionButton({ onClick, disabled, children, variant = 'primary' }) {
  const baseClass = 'px-4 py-2 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed'
  const variantClass =
    variant === 'success' ? 'bg-green-600 hover:bg-green-700 text-white'
    : variant === 'danger' ? 'bg-red-600 hover:bg-red-700 text-white'
    : variant === 'secondary' ? 'bg-slate-700 hover:bg-slate-600 text-white'
    : 'bg-indigo-600 hover:bg-indigo-700 text-white'
  return (
    <button onClick={onClick} disabled={disabled} className={`${baseClass} ${variantClass}`}>
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

function StatCard({ label, value, subtext, color = 'text-white' }) {
  return (
    <div className="bg-slate-700/30 rounded-lg p-3">
      <p className="text-xs text-slate-400 mb-1">{label}</p>
      <p className={`text-lg font-bold ${color}`}>{value}</p>
      {subtext && <p className="text-xs text-slate-500 mt-0.5">{subtext}</p>}
    </div>
  )
}

function SectionHeader({ icon, title, badge }) {
  return (
    <div className="flex items-center justify-between mb-4">
      <h3 className="text-lg font-semibold text-white flex items-center gap-2">
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
  const color = pct >= 80 ? 'text-green-400' : pct >= 60 ? 'text-emerald-400' : pct >= 40 ? 'text-yellow-400' : 'text-red-400'
  const bgColor = pct >= 80 ? 'bg-green-500/20' : pct >= 60 ? 'bg-emerald-500/20' : pct >= 40 ? 'bg-yellow-500/20' : 'bg-red-500/20'
  const sizeClass = size === 'lg' ? 'text-4xl w-20 h-20' : size === 'md' ? 'text-2xl w-14 h-14' : 'text-lg w-10 h-10'
  return (
    <div className={`${bgColor} ${sizeClass} rounded-full flex items-center justify-center`}>
      <span className={`font-bold ${color}`}>{score}</span>
    </div>
  )
}

function TierBadge({ tier }) {
  const tiers = {
    immediate_launch: { label: 'Immediate Launch', class: 'bg-green-500/20 text-green-300 border-green-500/30' },
    launch_priority: { label: 'Launch Priority', class: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30' },
    conditional: { label: 'Conditional', class: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30' },
    deprioritize: { label: 'Deprioritize', class: 'bg-orange-500/20 text-orange-300 border-orange-500/30' },
    kill: { label: 'Kill', class: 'bg-red-500/20 text-red-300 border-red-500/30' },
  }
  const t = tiers[tier] || { label: tier, class: 'bg-slate-600/30 text-slate-300 border-slate-600/30' }
  return (
    <span className={`text-sm font-bold px-4 py-1.5 rounded-full border ${t.class}`}>
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
      return <span key={i} className={`font-semibold ${isGrowth ? 'text-emerald-400' : 'text-white'}`}>{part}</span>
    }
    return part
  })
}

function SignalList({ signals, color = 'text-indigo-400' }) {
  if (!signals || signals.length === 0) return null
  return (
    <div className="space-y-2">
      {signals.map((signal, i) => (
        <div key={i} className="flex items-start gap-2 text-sm">
          <span className={`${color} mt-0.5 flex-shrink-0`}>•</span>
          <span className="text-slate-200">{typeof signal === 'string' ? highlightSignal(signal) : JSON.stringify(signal)}</span>
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
    <div className="bg-slate-800/60 border border-slate-700/50 rounded-lg p-6">
      <SectionHeader icon="📊" title="Keyword Evidence" />
      {(total_monthly_clicks || growth_yoy_pct || growth_3m_pct) && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
          {total_monthly_clicks && <StatCard label="Monthly Clicks" value={formatNumber(total_monthly_clicks)} />}
          {primary_keyword_clicks && <StatCard label="Primary Keyword" value={formatNumber(primary_keyword_clicks)} />}
          {growth_3m_pct && <StatCard label="3-Month Growth" value={`${parseFloat(growth_3m_pct) > 0 ? '+' : ''}${growth_3m_pct}%`} color={parseFloat(growth_3m_pct) > 0 ? 'text-emerald-400' : 'text-red-400'} />}
          {growth_yoy_pct && <StatCard label="Year-over-Year" value={`${parseFloat(growth_yoy_pct) > 0 ? '+' : ''}${growth_yoy_pct}%`} color={parseFloat(growth_yoy_pct) > 0 ? 'text-emerald-400' : 'text-red-400'} />}
        </div>
      )}
      {key_signals.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold text-slate-300 mb-3">Key Signals</h4>
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
    <div className="bg-slate-800/60 border border-slate-700/50 rounded-lg p-6">
      <SectionHeader icon="💬" title="Reddit Research" badge={reddit_score ? { text: `${reddit_score}/10`, class: 'bg-amber-500/20 text-amber-300' } : null} />
      <SignalList signals={key_signals} color="text-amber-400" />
    </div>
  )
}

function ScienceEvidencePanel({ evidence }) {
  if (!evidence || Object.keys(evidence).length === 0) return null
  const { key_signals = [] } = evidence
  return (
    <div className="bg-slate-800/60 border border-slate-700/50 rounded-lg p-6">
      <SectionHeader icon="🧪" title="Science Evidence" />
      <SignalList signals={key_signals} color="text-purple-400" />
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
    <div className="bg-gradient-to-br from-slate-800/80 to-slate-900/80 border border-slate-700/50 rounded-xl p-8 mb-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-white mb-1">Phase B Evaluation</h2>
          <p className="text-slate-400">Composite score from 4 strategic pillars</p>
        </div>
        <div className="flex items-center gap-4">
          <TierBadge tier={scores.recommendation_tier} />
          <div className="text-right">
            <p className="text-5xl font-bold text-white">{parseFloat(scores.composite_score).toFixed(0)}</p>
            <p className="text-sm text-slate-400">/ 100</p>
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
          <h4 className="text-sm font-semibold text-slate-300 mb-3">Weighted Contribution</h4>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={barData} layout="vertical" margin={{ left: 10, right: 20 }}>
              <XAxis type="number" domain={[0, 30]} tick={{ fill: '#64748b', fontSize: 11 }} />
              <YAxis dataKey="name" type="category" width={140} tick={{ fill: '#94a3b8', fontSize: 11 }} />
              <Tooltip
                contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px' }}
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
      <div className="grid grid-cols-2 gap-3 mt-6 pt-6 border-t border-slate-700/50">
        {pillarData.map(p => (
          <div key={p.key} className="bg-slate-700/20 rounded-lg p-3">
            <div className="flex items-center justify-between mb-1">
              <span className="text-sm font-medium text-white">{p.icon} {p.label}</span>
              <span className="text-sm font-bold" style={{ color: p.color }}>{p.score}/10</span>
            </div>
            {p.description && <p className="text-xs text-slate-400 leading-relaxed">{p.description}</p>}
          </div>
        ))}
      </div>

      {/* Assessment */}
      {scores.overall_assessment && (
        <div className="mt-4 pt-4 border-t border-slate-700/50">
          <p className="text-slate-200 leading-relaxed">{scores.overall_assessment}</p>
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
    <div className="bg-slate-800/60 border border-slate-700/50 rounded-lg p-6 col-span-2">
      <SectionHeader
        icon="🏪"
        title="Amazon Competitive Landscape"
        badge={{ text: `${data.opportunity_score}/10 opportunity`, class: data.opportunity_score >= 7 ? 'bg-green-500/20 text-green-300' : 'bg-yellow-500/20 text-yellow-300' }}
      />

      {/* Revenue & Rev/Review Hero Metrics */}
      {metrics && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
          <div className="bg-indigo-500/10 border border-indigo-500/20 rounded-lg p-3">
            <p className="text-xs text-indigo-300 mb-1 font-medium">Rev/Review — Top 3</p>
            <p className="text-2xl font-bold text-white">${metrics.top3RevPerReview.toFixed(0)}</p>
            <p className="text-xs text-slate-500 mt-0.5">Higher = easier to enter</p>
          </div>
          <div className="bg-indigo-500/10 border border-indigo-500/20 rounded-lg p-3">
            <p className="text-xs text-indigo-300 mb-1 font-medium">Rev/Review — Top 10</p>
            <p className="text-2xl font-bold text-white">${metrics.top10RevPerReview.toFixed(0)}</p>
            <p className="text-xs text-slate-500 mt-0.5">Your entry target zone</p>
          </div>
          <div className="bg-slate-700/30 rounded-lg p-3">
            <p className="text-xs text-slate-400 mb-1">Top 3 Monthly Rev</p>
            <p className="text-lg font-bold text-emerald-400">${formatNumber(metrics.top3TotalRevenue)}</p>
          </div>
          <div className="bg-slate-700/30 rounded-lg p-3">
            <p className="text-xs text-slate-400 mb-1">Top 10 Monthly Rev</p>
            <p className="text-lg font-bold text-emerald-400">${formatNumber(metrics.top10TotalRevenue)}</p>
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
          <h4 className="text-sm font-semibold text-slate-300 mb-3">Top Products by Sales Volume</h4>
          <div className="overflow-x-auto max-h-96 overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-slate-800 z-10">
                <tr className="border-b border-slate-700/50">
                  <th className="text-left py-2 px-2 text-slate-400 font-medium w-8">#</th>
                  <th className="text-left py-2 px-2 text-slate-400 font-medium w-28">Brand</th>
                  <th className="text-left py-2 px-2 text-slate-400 font-medium">Product</th>
                  <th className="text-right py-2 px-2 text-slate-400 font-medium w-16">Price</th>
                  <th className="text-right py-2 px-2 text-slate-400 font-medium w-20">Sales/mo</th>
                  <th className="text-right py-2 px-2 text-slate-400 font-medium w-24">Revenue/mo</th>
                  <th className="text-right py-2 px-2 text-slate-400 font-medium w-20">Reviews</th>
                  <th className="text-right py-2 px-2 text-slate-400 font-medium w-20">Rev/Review</th>
                  <th className="text-right py-2 px-2 text-slate-400 font-medium w-14">Rating</th>
                </tr>
              </thead>
              <tbody>
                {metrics.products.slice(0, 15).map((p, i) => {
                  const title = p.title || p.name || p.productDescription || '—'
                  const brand = p.brand && p.brand !== 'Generic' && p.brand !== 'Generic Liposomal' ? p.brand : extractBrand(title)
                  const amazonUrl = p.url || (p.asin ? `https://amazon.com/dp/${p.asin}` : null)
                  const isTop3 = i < 3
                  return (
                    <tr key={i} className={`border-b border-slate-700/30 hover:bg-slate-700/20 ${isTop3 ? 'bg-slate-700/10' : ''}`}>
                      <td className="py-2 px-2 text-slate-500 font-mono">{i + 1}</td>
                      <td className="py-2 px-2 text-indigo-300 font-medium text-xs">{brand}</td>
                      <td className="py-2 px-2 max-w-xs">
                        {amazonUrl ? (
                          <a
                            href={amazonUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-white hover:text-indigo-300 transition-colors truncate block"
                            title={title}
                            onClick={(e) => e.stopPropagation()}
                          >
                            {title.slice(0, 55)}{title.length > 55 ? '…' : ''}
                            <span className="text-indigo-500 ml-1 text-xs">↗</span>
                          </a>
                        ) : (
                          <span className="text-white truncate block" title={title}>{title.slice(0, 55)}</span>
                        )}
                      </td>
                      <td className="py-2 px-2 text-slate-300 text-right">${parseFloat(p.price || 0).toFixed(2)}</td>
                      <td className="py-2 px-2 text-emerald-400 text-right font-medium">{formatNumber(p.monthly_sales || p.salesVolume)}</td>
                      <td className="py-2 px-2 text-emerald-300 text-right">${formatNumber(p.revenue)}</td>
                      <td className="py-2 px-2 text-slate-400 text-right">{formatNumber(p.reviews)}</td>
                      <td className={`py-2 px-2 text-right font-medium ${p.revPerReview >= 100 ? 'text-green-400' : p.revPerReview >= 50 ? 'text-yellow-300' : 'text-red-400'}`}>
                        {p.reviews > 0 ? `$${p.revPerReview.toFixed(0)}` : '—'}
                      </td>
                      <td className="py-2 px-2 text-amber-300 text-right">{p.rating ? parseFloat(p.rating).toFixed(1) : '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-slate-500 mt-2">Rev/Review = (Price × Monthly Sales) / Reviews. <span className="text-green-400">Green ≥ $100</span> (attractive) · <span className="text-yellow-300">Yellow ≥ $50</span> · <span className="text-red-400">Red &lt; $50</span> (review moat)</p>
        </div>
      )}

      {/* Positioning Gaps — rendered as structured cards */}
      <div className="grid grid-cols-2 gap-6">
        <div>
          {positioningGaps.length > 0 && (
            <div className="mb-4">
              <h4 className="text-sm font-semibold text-emerald-300 mb-3">Positioning Gaps</h4>
              <div className="space-y-3">
                {positioningGaps.map((gap, i) => {
                  if (typeof gap === 'string') {
                    return (
                      <div key={i} className="flex items-start gap-2 text-sm">
                        <span className="text-emerald-400 mt-0.5 flex-shrink-0">•</span>
                        <span className="text-slate-200">{gap}</span>
                      </div>
                    )
                  }
                  // Structured gap object: { gap, angle, evidence }
                  return (
                    <div key={i} className="bg-slate-700/20 rounded-lg p-3 border-l-2 border-emerald-500/50">
                      <p className="text-sm font-medium text-white mb-1">{gap.gap || gap.name || '—'}</p>
                      {gap.angle && <p className="text-xs text-emerald-300 mb-1">Angle: {gap.angle}</p>}
                      {gap.evidence && <p className="text-xs text-slate-400">{gap.evidence}</p>}
                    </div>
                  )
                })}
              </div>
            </div>
          )}
          {opportunitySignals.length > 0 && (
            <div>
              <h4 className="text-sm font-semibold text-green-300 mb-2">Opportunity Signals</h4>
              <SignalList signals={opportunitySignals} color="text-green-400" />
            </div>
          )}
        </div>
        <div>
          {data.differentiation_assessment && (
            <div className="mb-4">
              <h4 className="text-sm font-semibold text-slate-300 mb-2">Differentiation</h4>
              <p className="text-sm text-slate-300">{data.differentiation_assessment}</p>
            </div>
          )}
          {data.premium_tier_analysis && (
            <div className="mb-4">
              <h4 className="text-sm font-semibold text-slate-300 mb-2">Premium Tier</h4>
              <p className="text-sm text-slate-300">{data.premium_tier_analysis}</p>
            </div>
          )}
          {riskFactors.length > 0 && (
            <div>
              <h4 className="text-sm font-semibold text-red-300 mb-2">Risk Factors</h4>
              <SignalList signals={riskFactors} color="text-red-400" />
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
    emerging: 'bg-blue-500/20 text-blue-300',
    growing: 'bg-emerald-500/20 text-emerald-300',
    mainstream: 'bg-yellow-500/20 text-yellow-300',
    declining: 'bg-red-500/20 text-red-300',
  }

  return (
    <div className="bg-slate-800/60 border border-slate-700/50 rounded-lg p-6">
      <SectionHeader
        icon="🎵"
        title="TikTok Trend Analysis"
        badge={{ text: `${data.tiktok_score}/10`, class: data.tiktok_score >= 7 ? 'bg-emerald-500/20 text-emerald-300' : 'bg-yellow-500/20 text-yellow-300' }}
      />

      {/* Key Metrics */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-6">
        <StatCard label="Total Videos" value={data.total_videos || '—'} subtext={`${data.organic_videos || 0} organic / ${data.ad_videos || 0} ads`} />
        <StatCard label="Total Plays" value={formatNumber(data.total_plays)} color="text-pink-400" />
        <StatCard label="Total Likes" value={formatNumber(data.total_likes)} />
        <StatCard label="Shares + Saves" value={formatNumber((data.total_shares || 0) + (data.total_saves || 0))} color="text-indigo-400" />
        <StatCard label="Avg Engagement" value={data.avg_engagement_rate ? `${parseFloat(data.avg_engagement_rate).toFixed(1)}%` : '—'} />
      </div>

      <div className="grid grid-cols-2 gap-6 mb-4">
        {/* Trend Lifecycle */}
        <div>
          <div className="flex items-center gap-3 mb-4">
            <h4 className="text-sm font-semibold text-slate-300">Trend Lifecycle</h4>
            {data.trend_lifecycle && (
              <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${lifecycleColors[data.trend_lifecycle] || 'bg-slate-600/30 text-slate-300'}`}>
                {data.trend_lifecycle}
              </span>
            )}
          </div>

          {/* Query Breakdown */}
          {queryBreakdown.length > 0 && (
            <div className="space-y-2 mb-4">
              <h4 className="text-xs font-semibold text-slate-400 uppercase">By Search Query</h4>
              {queryBreakdown.map((q, i) => (
                <div key={i} className="flex items-center justify-between text-sm bg-slate-700/20 rounded px-3 py-2">
                  <span className="text-slate-200 truncate max-w-[200px]">{q.query || q.keyword}</span>
                  <div className="flex items-center gap-3 text-xs">
                    <span className="text-pink-400">{formatNumber(q.total_plays || q.plays)} plays</span>
                    <span className="text-slate-400">{q.video_count || q.videos} videos</span>
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
              <h4 className="text-xs font-semibold text-slate-400 uppercase mb-2">Top Hashtags</h4>
              <div className="flex flex-wrap gap-1.5">
                {topHashtags.slice(0, 12).map((tag, i) => {
                  const name = typeof tag === 'string' ? tag : tag.name || tag.hashtag
                  const count = typeof tag === 'object' ? tag.count || tag.video_count : null
                  return (
                    <span key={i} className="text-xs px-2 py-1 bg-pink-500/10 text-pink-300 rounded border border-pink-500/20">
                      #{name}{count ? ` (${count})` : ''}
                    </span>
                  )
                })}
              </div>
            </div>
          )}

          {Object.keys(creatorTiers).length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-slate-400 uppercase mb-2">Creator Tiers</h4>
              <div className="grid grid-cols-3 gap-2">
                {Object.entries(creatorTiers).map(([tier, count]) => (
                  <div key={tier} className="bg-slate-700/30 rounded p-2 text-center">
                    <p className="text-xs text-slate-400 capitalize">{tier}</p>
                    <p className="text-lg font-bold text-white">{count}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Key Signals */}
      {keySignals.length > 0 && (
        <div className="pt-4 border-t border-slate-700/50">
          <h4 className="text-sm font-semibold text-slate-300 mb-2">Key Signals</h4>
          <SignalList signals={keySignals} color="text-pink-400" />
        </div>
      )}

      {data.overall_assessment && (
        <div className="mt-4 pt-4 border-t border-slate-700/50">
          <p className="text-sm text-slate-300">{data.overall_assessment}</p>
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
    rising: 'text-emerald-400',
    stable: 'text-yellow-400',
    declining: 'text-red-400',
  }

  return (
    <div className="bg-slate-800/60 border border-slate-700/50 rounded-lg p-6">
      <SectionHeader
        icon="📈"
        title="Google Trends Validation"
        badge={{ text: `${data.google_trends_score}/10`, class: data.google_trends_score >= 7 ? 'bg-emerald-500/20 text-emerald-300' : 'bg-yellow-500/20 text-yellow-300' }}
      />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <StatCard
          label="YoY Growth"
          value={data.yoy_growth_pct ? `+${parseFloat(data.yoy_growth_pct).toFixed(0)}%` : '—'}
          color="text-emerald-400"
        />
        <StatCard
          label="Trend Direction"
          value={data.trend_direction || '—'}
          color={dirColors[data.trend_direction] || 'text-white'}
        />
        <StatCard label="Peak Interest" value={data.peak_interest_date || '—'} />
        <StatCard
          label="Current vs Peak"
          value={data.current_vs_peak_pct ? `${parseFloat(data.current_vs_peak_pct).toFixed(0)}%` : '—'}
        />
      </div>

      {data.cross_platform_validation && (
        <div className="mb-4 bg-slate-700/20 rounded-lg p-3">
          <h4 className="text-xs font-semibold text-slate-400 uppercase mb-1">Cross-Platform Validation</h4>
          <p className="text-sm text-slate-200">{data.cross_platform_validation}</p>
        </div>
      )}

      {keySignals.length > 0 && (
        <div className="mb-4">
          <h4 className="text-sm font-semibold text-slate-300 mb-2">Key Signals</h4>
          <SignalList signals={keySignals} color="text-emerald-400" />
        </div>
      )}

      {relatedQueries.length > 0 && (
        <div className="mb-4">
          <h4 className="text-xs font-semibold text-slate-400 uppercase mb-2">Related Queries</h4>
          <div className="flex flex-wrap gap-1.5">
            {relatedQueries.slice(0, 10).map((q, i) => {
              const name = typeof q === 'string' ? q : q.query || q.term
              return (
                <span key={i} className="text-xs px-2 py-1 bg-emerald-500/10 text-emerald-300 rounded border border-emerald-500/20">
                  {name}
                </span>
              )
            })}
          </div>
        </div>
      )}

      {data.data_source && (
        <p className="text-xs text-slate-500 mt-2">Data source: {data.data_source}</p>
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
    <div className="bg-slate-800/60 border border-slate-700/50 rounded-lg p-6">
      <SectionHeader
        icon="⚡"
        title="Differentiation Scoring"
        badge={{
          text: `${diffTotal}/12`,
          class: isAutoKill ? 'bg-red-500/20 text-red-300' : diffTotal >= 10 ? 'bg-green-500/20 text-green-300' : diffTotal >= 7 ? 'bg-emerald-500/20 text-emerald-300' : 'bg-yellow-500/20 text-yellow-300'
        }}
      />

      {isAutoKill && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 mb-4 text-sm text-red-300">
          ⚠️ AUTO-KILL: Score ≤3/12 — category doesn't support Toniiq's premium approach
        </div>
      )}

      {/* 4-Layer Breakdown */}
      <div className="grid grid-cols-4 gap-3 mb-6">
        <div className="bg-slate-700/30 rounded-lg p-3 text-center">
          <p className="text-xs text-slate-400 mb-1">Vectors Available</p>
          <p className="text-2xl font-bold text-white">{scores.diff_vectors_available ?? '—'}<span className="text-sm text-slate-500">/5</span></p>
        </div>
        <div className="bg-slate-700/30 rounded-lg p-3 text-center">
          <p className="text-xs text-slate-400 mb-1">Competitive Gap</p>
          <p className="text-2xl font-bold text-white">{scores.diff_competitive_gap ?? '—'}<span className="text-sm text-slate-500">/3</span></p>
        </div>
        <div className="bg-slate-700/30 rounded-lg p-3 text-center">
          <p className="text-xs text-slate-400 mb-1">Form Factor Fit</p>
          <p className="text-2xl font-bold text-white">{scores.diff_form_factor_fit ?? '—'}<span className="text-sm text-slate-500">/2</span></p>
        </div>
        <div className="bg-slate-700/30 rounded-lg p-3 text-center">
          <p className="text-xs text-slate-400 mb-1">Pricing Headroom</p>
          <p className="text-2xl font-bold text-white">{scores.diff_pricing_headroom ?? '—'}<span className="text-sm text-slate-500">/2</span></p>
        </div>
      </div>

      {/* 6 Vectors Checklist */}
      {vectorDetails.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-sm font-semibold text-slate-300 mb-2">6-Vector Assessment</h4>
          {vectorDetails.map((v, i) => {
            const vectorMeta = vectors[i] || { name: v.vector || v.name || `Vector ${i + 1}`, icon: '•' }
            const available = v.available || v.status === 'available' || v.score === true
            return (
              <div key={i} className="flex items-start gap-3 text-sm bg-slate-700/20 rounded px-3 py-2">
                <span className="flex-shrink-0 text-lg">{available ? '✅' : '❌'}</span>
                <div>
                  <span className="text-white font-medium">{vectorMeta.icon} {v.vector || v.name || vectorMeta.name}</span>
                  {v.justification && <p className="text-slate-400 mt-0.5">{v.justification}</p>}
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
    <div className="bg-slate-800/60 border border-slate-700/50 rounded-lg p-6">
      <SectionHeader icon="🎯" title="Signals & Next Steps" />
      <div className="grid grid-cols-3 gap-6">
        {opportunitySignals.length > 0 && (
          <div>
            <h4 className="text-sm font-semibold text-green-300 mb-2">Opportunities</h4>
            <SignalList signals={opportunitySignals} color="text-green-400" />
          </div>
        )}
        {riskFactors.length > 0 && (
          <div>
            <h4 className="text-sm font-semibold text-red-300 mb-2">Risks</h4>
            <SignalList signals={riskFactors} color="text-red-400" />
          </div>
        )}
        {nextSteps.length > 0 && (
          <div>
            <h4 className="text-sm font-semibold text-indigo-300 mb-2">Next Steps</h4>
            <SignalList signals={nextSteps} color="text-indigo-400" />
          </div>
        )}
      </div>
    </div>
  )
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
      <div className="min-h-screen bg-slate-900">
        <Header />
        <div className="flex items-center justify-center min-h-[calc(100vh-64px)]">
          <div className="text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-400 mx-auto mb-4" />
            <p className="text-slate-400">Loading concept...</p>
          </div>
        </div>
      </div>
    )
  }

  if (!concept) {
    return (
      <div className="min-h-screen bg-slate-900">
        <Header />
        <div className="flex items-center justify-center min-h-[calc(100vh-64px)]">
          <div className="text-center">
            <p className="text-slate-400">Concept not found</p>
            <Link to="/concepts" className="text-indigo-400 hover:text-indigo-300 mt-2 inline-block">Back to concepts</Link>
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
    ? concept.key_ingredients
    : concept.key_ingredients && typeof concept.key_ingredients === 'object'
      ? Object.entries(concept.key_ingredients).map(([name, data]) => ({
          ingredient: name,
          ...(typeof data === 'object' ? data : { dose: data }),
        }))
      : []

  return (
    <div className="min-h-screen bg-slate-900">
      {/* Header */}
      <header className="border-b border-slate-700/50 bg-slate-900/80 backdrop-blur-sm sticky top-0 z-30">
        <div className="max-w-[1600px] mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <Link to="/" className="text-xl font-semibold text-white hover:text-indigo-300 transition-colors">
              Toniiq Idea Pipeline
            </Link>
            <nav className="flex gap-3 items-center text-sm">
              <Link to="/" className="text-slate-400 hover:text-white transition-colors">Pipeline</Link>
              <span className="text-slate-600">/</span>
              <Link to="/concepts" className="text-slate-400 hover:text-white transition-colors">Concepts</Link>
              <span className="text-slate-600">/</span>
              <span className="text-white truncate max-w-xs">{concept.concept_name}</span>
            </nav>
          </div>
        </div>
      </header>

      <div className="max-w-[1600px] mx-auto px-6 py-8">
        <button
          onClick={() => navigate('/concepts')}
          className="text-indigo-400 hover:text-indigo-300 text-sm font-medium mb-6 flex items-center gap-1"
        >
          ← Back to Concepts
        </button>

        {/* Tab navigation */}
        {hasPhaseB && (
          <div className="flex bg-slate-800 rounded-lg p-1 border border-slate-700/50 mb-8 w-fit">
            <button
              onClick={() => setActiveTab('overview')}
              className={`px-5 py-2 rounded-md text-sm font-medium transition-colors ${
                activeTab === 'overview' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              Concept Overview
            </button>
            <button
              onClick={() => setActiveTab('evaluation')}
              className={`px-5 py-2 rounded-md text-sm font-medium transition-colors flex items-center gap-2 ${
                activeTab === 'evaluation' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              Phase B Evaluation
              {conceptScores && (
                <span className={`text-xs px-2 py-0.5 rounded-full ${
                  parseFloat(conceptScores.composite_score) >= 70 ? 'bg-green-500/30 text-green-300' : 'bg-yellow-500/30 text-yellow-300'
                }`}>
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
                <div className="bg-slate-800/60 border border-slate-700/50 rounded-lg p-8 mb-6">
                  <div className="mb-6">
                    <div className="flex items-start justify-between mb-4">
                      <div>
                        <div className="flex items-center gap-3 mb-2">
                          <h1 className="text-3xl font-bold text-white">{concept.concept_name}</h1>
                          {hasPhaseB && (
                            <span className="text-xs font-medium px-2 py-1 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                              Phase B
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 flex-wrap">
                          {linkedIngredients.map(ing => (
                            <Link
                              key={ing.id}
                              to={`/discovery/${ing.id}`}
                              className="inline-flex items-center gap-1.5 text-sm px-3 py-1 rounded-full bg-slate-700/50 hover:bg-indigo-500/20 border border-slate-600/50 hover:border-indigo-500/30 text-slate-300 hover:text-indigo-300 transition-all"
                            >
                              {ing.ingredient_name}
                              {ing.role === 'secondary' && <span className="text-xs text-slate-500">(secondary)</span>}
                              <span className="text-slate-500">→</span>
                            </Link>
                          ))}
                          {linkedIngredients.length === 0 && candidate && (
                            <Link
                              to={`/discovery/${candidate.id}`}
                              className="inline-flex items-center gap-1.5 text-sm px-3 py-1 rounded-full bg-slate-700/50 hover:bg-indigo-500/20 border border-slate-600/50 hover:border-indigo-500/30 text-slate-300 hover:text-indigo-300 transition-all"
                            >
                              {candidate.ingredient_name}
                              <span className="text-slate-500">→</span>
                            </Link>
                          )}
                        </div>
                      </div>
                      <span className={`text-xs font-bold px-3 py-1.5 rounded-full flex-shrink-0 ${
                        concept.status === 'selected' ? 'bg-green-500/20 text-green-300'
                        : concept.status === 'rejected' ? 'bg-red-500/20 text-red-300'
                        : 'bg-slate-600/30 text-slate-300'
                      }`}>
                        {concept.status}
                      </span>
                    </div>

                    {/* Show composite score if available, else confidence score */}
                    <div className="mb-6">
                      {conceptScores ? (
                        <div>
                          <div className="flex items-center gap-4 mb-1">
                            <p className="text-sm text-slate-400">Composite Score</p>
                            <TierBadge tier={conceptScores.recommendation_tier} />
                          </div>
                          <ConfidenceBar score={parseFloat(conceptScores.composite_score)} max={100} />
                        </div>
                      ) : (
                        <div>
                          <p className="text-sm text-slate-400 mb-2">Confidence Score (Phase A)</p>
                          <ConfidenceBar score={concept.confidence_score} />
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="border-t border-slate-700/50 pt-6">
                    <h2 className="text-lg font-semibold text-white mb-3">Positioning Angle</h2>
                    {concept.positioning_angle ? (
                      <p className="text-lg text-slate-200 italic leading-relaxed">"{concept.positioning_angle}"</p>
                    ) : (
                      <p className="text-slate-500">No positioning angle provided</p>
                    )}
                  </div>
                </div>

                {/* Key Ingredients table */}
                {ingredients.length > 0 && (
                  <div className="bg-slate-800/60 border border-slate-700/50 rounded-lg p-6 mb-6">
                    <h2 className="text-lg font-semibold text-white mb-4">Key Ingredients</h2>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-slate-700/50">
                            <th className="text-left py-2 px-3 text-slate-400 font-medium">Ingredient</th>
                            <th className="text-left py-2 px-3 text-slate-400 font-medium">Dosage</th>
                            <th className="text-left py-2 px-3 text-slate-400 font-medium">Role</th>
                            <th className="text-left py-2 px-3 text-slate-400 font-medium">Notes</th>
                          </tr>
                        </thead>
                        <tbody>
                          {ingredients.map((ing, i) => (
                            <tr key={i} className="border-b border-slate-700/30 hover:bg-slate-700/20">
                              <td className="py-2 px-3 text-white font-medium">{ing.ingredient || ing.name || '—'}</td>
                              <td className="py-2 px-3 text-slate-300">{ing.dose || ing.dosage || '—'}</td>
                              <td className="py-2 px-3 text-slate-400">{ing.role || '—'}</td>
                              <td className="py-2 px-3 text-slate-500 text-xs">{ing.notes || ''}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {concept.confidence_reasoning && (
                  <div className="bg-slate-800/60 border border-slate-700/50 rounded-lg p-6">
                    <h2 className="text-lg font-semibold text-white mb-3">Why This Score?</h2>
                    <p className="text-slate-200 leading-relaxed">{concept.confidence_reasoning}</p>
                  </div>
                )}
              </div>

              {/* Right column: actions + metadata */}
              <div>
                <div className="bg-slate-800/60 border border-slate-700/50 rounded-lg p-6 sticky top-24">
                  <h3 className="text-lg font-semibold text-white mb-4">Actions</h3>
                  <div className="space-y-3 mb-6">
                    <ActionButton onClick={() => updateStatus('selected')} disabled={actionLoading || concept.status === 'selected'} variant="success">
                      ✓ Select for Phase B
                    </ActionButton>
                    <ActionButton onClick={() => updateStatus('rejected')} disabled={actionLoading || concept.status === 'rejected'} variant="danger">
                      ✕ Reject
                    </ActionButton>
                    {concept.status !== 'generated' && (
                      <ActionButton onClick={() => updateStatus('generated')} disabled={actionLoading} variant="secondary">
                        ↻ Reset
                      </ActionButton>
                    )}
                  </div>

                  {message && (
                    <div className={`text-sm px-3 py-2 rounded mb-4 ${message.includes('Error') ? 'bg-red-500/20 text-red-300' : 'bg-green-500/20 text-green-300'}`}>
                      {message}
                    </div>
                  )}

                  {/* Quick Phase B scores */}
                  {conceptScores && (
                    <div className="border-t border-slate-700/50 pt-4 mb-4">
                      <h4 className="text-sm font-semibold text-slate-300 mb-3">Evaluation Scores</h4>
                      <div className="space-y-2">
                        {[
                          { label: 'Amazon', score: conceptScores.amazon_competitive_score, color: 'bg-indigo-500' },
                          { label: 'Keywords', score: conceptScores.keyword_demand_score, color: 'bg-blue-500' },
                          { label: 'Trends', score: conceptScores.google_trends_score, color: 'bg-emerald-500' },
                          { label: 'TikTok', score: conceptScores.tiktok_score, color: 'bg-pink-500' },
                          { label: 'Differentiation', score: conceptScores.differentiation_score, color: 'bg-purple-500' },
                        ].map(({ label, score, color }) => (
                          <div key={label} className="flex items-center gap-2 text-sm">
                            <span className="text-slate-400 w-24">{label}</span>
                            <div className="flex-1 h-2 bg-slate-700 rounded-full overflow-hidden">
                              <div className={`h-full ${color} rounded-full`} style={{ width: `${(score || 0) * 10}%` }} />
                            </div>
                            <span className="text-white font-medium w-6 text-right">{score || '—'}</span>
                          </div>
                        ))}
                      </div>
                      <button
                        onClick={() => setActiveTab('evaluation')}
                        className="text-indigo-400 hover:text-indigo-300 text-xs mt-3 font-medium"
                      >
                        View full evaluation →
                      </button>
                    </div>
                  )}

                  {/* Metadata */}
                  <div className="border-t border-slate-700/50 pt-4 space-y-3 text-sm">
                    <div>
                      <p className="text-slate-400">Format</p>
                      <p className="text-slate-200">{concept.format || '—'}</p>
                    </div>
                    <div>
                      <p className="text-slate-400">Target Dosage</p>
                      <p className="text-slate-200">{concept.target_dosage || '—'}</p>
                    </div>
                    <div>
                      <p className="text-slate-400">Type</p>
                      <p className="text-slate-200">{concept.concept_type?.replace(/_/g, ' ') || '—'}</p>
                    </div>
                  </div>

                  {allConcepts.length > 1 && (
                    <div className="border-t border-slate-700/50 pt-4 mt-4">
                      <p className="text-sm text-slate-400 mb-2">Other concepts for this ingredient</p>
                      <div className="space-y-1.5">
                        {allConcepts.filter(c => c.id !== conceptId).map(c => (
                          <button
                            key={c.id}
                            onClick={() => navigate(`/concepts/${c.id}`)}
                            className="w-full text-left text-sm text-slate-300 hover:text-indigo-300 transition-colors py-1 flex justify-between"
                          >
                            <span className="truncate">{c.concept_name}</span>
                            <span className="text-slate-500 flex-shrink-0 ml-2">{parseFloat(c.confidence_score).toFixed(1)}</span>
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
              <h2 className="text-2xl font-bold text-white mb-6">Phase A Evidence</h2>
              <div className="grid grid-cols-3 gap-6">
                <KeywordEvidencePanel evidence={concept.keyword_evidence} />
                <RedditEvidencePanel evidence={concept.reddit_evidence} />
                <ScienceEvidencePanel evidence={concept.science_evidence} />
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
            <h2 className="text-xl font-semibold text-white mb-2">No Phase B data yet</h2>
            <p className="text-slate-400">Select this concept for Phase B evaluation to generate competitive research, trend analysis, and scoring.</p>
          </div>
        )}

        {/* Navigation */}
        {(prevConcept || nextConcept) && (
          <div className="flex justify-between items-center pt-8 border-t border-slate-700/50 mt-8">
            {prevConcept ? (
              <button onClick={() => navigate(`/concepts/${prevConcept.id}`)} className="text-indigo-400 hover:text-indigo-300 flex items-center gap-2 text-sm font-medium">
                ← {prevConcept.concept_name}
              </button>
            ) : <div />}
            <Link to="/concepts" className="text-slate-400 hover:text-white text-sm">View all concepts</Link>
            {nextConcept ? (
              <button onClick={() => navigate(`/concepts/${nextConcept.id}`)} className="text-indigo-400 hover:text-indigo-300 flex items-center gap-2 text-sm font-medium">
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
    <header className="border-b border-slate-700/50 bg-slate-900/80 backdrop-blur-sm sticky top-0 z-30">
      <div className="max-w-[1600px] mx-auto px-6 py-4">
        <Link to="/" className="text-xl font-semibold text-white hover:text-indigo-300 transition-colors">
          Toniiq Idea Pipeline
        </Link>
      </div>
    </header>
  )
}
