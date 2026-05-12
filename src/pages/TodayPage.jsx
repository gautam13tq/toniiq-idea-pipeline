import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'

const ACTIVE_STATUSES = ['pending', 'in_progress']
const OPEN_OPPORTUNITY_STATUSES = ['new', 'reviewing', 'queued_research', 'researching', 'watching']
const PRIORITY_ORDER = { urgent: 0, high: 1, medium: 2, normal: 2, low: 3, parked: 4 }

function daysSince(dateValue) {
  if (!dateValue) return null
  const date = new Date(dateValue)
  if (Number.isNaN(date.getTime())) return null
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  return Math.max(0, Math.floor((today - start) / 86400000))
}

function priorityRank(value) {
  return PRIORITY_ORDER[value] ?? 9
}

function sortReviews(a, b) {
  const pa = priorityRank(a.priority)
  const pb = priorityRank(b.priority)
  if (pa !== pb) return pa - pb
  return (b.toniiq_fit_score || 0) - (a.toniiq_fit_score || 0)
}

function sortProducts(a, b) {
  const pa = priorityRank(a.priority)
  const pb = priorityRank(b.priority)
  if (pa !== pb) return pa - pb
  const aStale = daysSince(a.last_updated) || 0
  const bStale = daysSince(b.last_updated) || 0
  if (aStale !== bStale) return bStale - aStale
  return (a.sort_order ?? 999) - (b.sort_order ?? 999)
}

function actionLabel(action) {
  return String(action || '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, letter => letter.toUpperCase())
}

function buildSessionPrompt({ products, reviews, pendingActions, researchIdeas, evaluationIdeas, recommendations }) {
  const topProducts = products.slice(0, 5)
  const topReviews = reviews.slice(0, 5)
  const topActions = pendingActions.slice(0, 8)

  return [
    'Start a Toniiq product development work block.',
    '',
    'Start ritual:',
    '1. Read CLAUDE.md in Product Development.',
    "2. Run: SELECT * FROM pending_actions WHERE status='pending' ORDER BY created_at;",
    '3. Treat POE/Datarova/Amazon/supplier/science numbers as Tier 1 source-backed data. Do not invent missing numbers.',
    '4. Use the app/Supabase state first. Use local product folders only for products already in development.',
    '',
    'Recommended focus:',
    topProducts.length
      ? `- Development: ${topProducts.map(product => `${product.product} (${product.today_action || product.decision_needed || product.blocker_risk || 'needs next action'})`).join('; ')}`
      : '- Development: no active development items loaded.',
    topReviews.length
      ? `- Opportunities: ${topReviews.map(review => `${review.candidateName} (${review.next_action || review.rationale || 'review opportunity'})`).join('; ')}`
      : '- Opportunities: no open opportunity reviews loaded.',
    topActions.length
      ? `- Pending actions: ${topActions.map(action => `${actionLabel(action.action)} for ${action.context?.ingredient_name || action.entity_type}`).join('; ')}`
      : '- Pending actions: none open.',
    '',
    'Queue counts:',
    `- Research ideas: ${researchIdeas.length}`,
    `- Evaluation ideas: ${evaluationIdeas.length}`,
    `- Open LLM recommendations: ${recommendations.length}`,
    '',
    'Output wanted:',
    '- Pick the best next action for this work block',
    '- Execute queued actions only if they are relevant to the chosen focus',
    '- Record decisions or missing evidence clearly',
    '- Leave database/file updates source-locked and auditable',
  ].join('\n')
}

export default function TodayPage() {
  const [products, setProducts] = useState([])
  const [reviews, setReviews] = useState([])
  const [candidates, setCandidates] = useState([])
  const [pendingActions, setPendingActions] = useState([])
  const [recommendations, setRecommendations] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const [sessionError, setSessionError] = useState('')

  useEffect(() => {
    let ignore = false

    async function loadData() {
      const [productsRes, reviewsRes, candidatesRes, actionsRes, recsRes] = await Promise.all([
        supabase.from('npd_registry_products').select('*').order('queue').order('sort_order'),
        supabase.from('opportunity_reviews').select('*').in('status', OPEN_OPPORTUNITY_STATUSES).order('created_at', { ascending: false }),
        supabase.from('idea_candidates').select('id, ingredient_name, category, stage, last_updated_at, first_surfaced_at, surfaced_week').in('stage', ['inbox', 'research', 'evaluation', 'development']),
        supabase.from('pending_actions').select('id, entity_type, entity_id, action, status, triggered_by, context, created_at').in('status', ACTIVE_STATUSES).order('created_at', { ascending: true }),
        supabase.from('llm_recommendations').select('*').eq('status', 'open').order('created_at', { ascending: false }),
      ])
      if (ignore) return

      const loadError = productsRes.error || reviewsRes.error || candidatesRes.error || actionsRes.error || recsRes.error
      if (loadError) setError(loadError.message)
      else {
        setProducts(productsRes.data || [])
        setReviews(reviewsRes.data || [])
        setCandidates(candidatesRes.data || [])
        setPendingActions(actionsRes.data || [])
        setRecommendations(recsRes.data || [])
      }
      setLoading(false)
    }

    loadData()
    return () => { ignore = true }
  }, [])

  const candidateMap = useMemo(
    () => new Map(candidates.map(candidate => [candidate.id, candidate])),
    [candidates]
  )

  const activeProducts = useMemo(
    () => products.filter(product => product.queue === 'Active Development').sort(sortProducts),
    [products]
  )

  const staleProducts = useMemo(
    () => activeProducts.filter(product => daysSince(product.last_updated) >= 14),
    [activeProducts]
  )

  const benchProducts = useMemo(
    () => products.filter(product => product.queue === 'Greenlight Bench').sort(sortProducts),
    [products]
  )

  const openReviews = useMemo(
    () => reviews
      .map(review => ({
        ...review,
        candidateName: candidateMap.get(review.candidate_id)?.ingredient_name || 'Unknown idea',
        candidateCategory: candidateMap.get(review.candidate_id)?.category || 'Uncategorized',
      }))
      .sort(sortReviews),
    [candidateMap, reviews]
  )

  const researchIdeas = useMemo(
    () => candidates.filter(candidate => candidate.stage === 'research'),
    [candidates]
  )

  const evaluationIdeas = useMemo(
    () => candidates.filter(candidate => candidate.stage === 'evaluation'),
    [candidates]
  )

  const urgentReviews = openReviews.filter(review => ['urgent', 'high'].includes(review.priority))
  const blockedProducts = activeProducts.filter(product => product.blocker_risk || product.decision_needed)
  const prompt = buildSessionPrompt({
    products: blockedProducts.length ? blockedProducts : activeProducts,
    reviews: urgentReviews.length ? urgentReviews : openReviews,
    pendingActions,
    researchIdeas,
    evaluationIdeas,
    recommendations,
  })

  async function copyPrompt() {
    await navigator.clipboard.writeText(prompt)
    setCopied(true)
    setTimeout(() => setCopied(false), 1400)
  }

  async function startSession() {
    setSessionError('')
    const selectedItems = [
      ...activeProducts.slice(0, 4).map(product => ({ type: 'product', id: product.id, name: product.product })),
      ...openReviews.slice(0, 4).map(review => ({ type: 'opportunity', id: review.id, candidate_id: review.candidate_id, name: review.candidateName })),
      ...pendingActions.slice(0, 6).map(action => ({ type: 'pending_action', id: action.id, action: action.action })),
    ]
    const { error: insertError } = await supabase.from('work_sessions').insert({
      focus: 'product_development',
      status: 'active',
      intended_minutes: 120,
      selected_items: selectedItems,
      notes: prompt,
      started_at: new Date().toISOString(),
    })
    if (insertError) {
      setSessionError(insertError.message)
      return
    }
    await copyPrompt()
  }

  if (loading) return <div className="flex min-h-[60vh] items-center justify-center text-sm" style={{ color: 'var(--text-faint)' }}>Loading today...</div>
  if (error) return <div className="p-6 text-sm" style={{ color: 'var(--red-text)' }}>{error}</div>

  const activeStatus = activeProducts.length > 13 ? 'over' : activeProducts.length > 10 ? 'warn' : activeProducts.length < 8 ? 'warn' : 'good'
  const benchStatus = benchProducts.length > 3 ? 'warn' : 'good'

  return (
    <div className="min-h-screen">
      <div className="border-b px-6 py-5" style={{ borderColor: 'var(--border-default)', background: 'var(--bg-base)' }}>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="text-2xl font-semibold" style={{ color: 'var(--text-primary)' }}>Today</h1>
            <p className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>
              Product development command center for the next focused work block.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 text-xs">
            <Metric label={`${activeProducts.length} active`} status={activeStatus} />
            <Metric label={`${benchProducts.length} bench`} status={benchStatus} />
            <Metric label={`${staleProducts.length} stale`} status={staleProducts.length ? 'warn' : 'good'} />
            <Metric label={`${openReviews.length} opportunities`} status={urgentReviews.length ? 'warn' : 'good'} />
            <Metric label={`${pendingActions.length} pending actions`} status={pendingActions.length ? 'warn' : 'good'} />
          </div>
        </div>
      </div>

      <main className="grid gap-6 p-6 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="min-w-0 space-y-6">
          <section>
            <div className="mb-3 flex items-end justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>Recommended Work Block</h2>
                <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Best current surfaces for a 2-hour NPD session.</p>
              </div>
              <button onClick={startSession} className="t-btn shrink-0">Start session</button>
            </div>
            {sessionError && <InlineWarning>{sessionError}</InlineWarning>}
            <div className="grid gap-3 lg:grid-cols-3">
              <FocusPanel
                label="Development"
                title={blockedProducts[0]?.product || activeProducts[0]?.product || 'No active product'}
                meta={blockedProducts[0]?.decision_needed || blockedProducts[0]?.blocker_risk || activeProducts[0]?.today_action || 'Open the development cockpit'}
                to="/development"
                tone={blockedProducts.length || staleProducts.length ? 'warn' : 'blue'}
              />
              <FocusPanel
                label="Opportunity"
                title={urgentReviews[0]?.candidateName || openReviews[0]?.candidateName || 'No open opportunity'}
                meta={urgentReviews[0]?.next_action || openReviews[0]?.next_action || 'Review the suggested queue'}
                to="/opportunities"
                tone={urgentReviews.length ? 'green' : 'blue'}
              />
              <FocusPanel
                label="Agent Queue"
                title={pendingActions[0] ? actionLabel(pendingActions[0].action) : `${researchIdeas.length + evaluationIdeas.length} research/eval items`}
                meta={pendingActions[0]?.context?.ingredient_name || 'Check research and evaluation decisions'}
                to={pendingActions[0]?.entity_type === 'concept' ? '/evaluation' : '/research'}
                tone={pendingActions.length ? 'warn' : 'blue'}
              />
            </div>
          </section>

          <section className="grid gap-6 xl:grid-cols-2">
            <QueuePanel title="Development Focus" actionLabel="Open cockpit" to="/development">
              {(blockedProducts.length ? blockedProducts : activeProducts).slice(0, 7).map(product => (
                <ProductItem key={product.id} product={product} />
              ))}
            </QueuePanel>

            <QueuePanel title="Opportunity Focus" actionLabel="Open queue" to="/opportunities">
              {(urgentReviews.length ? urgentReviews : openReviews).slice(0, 7).map(review => (
                <OpportunityItem key={review.id} review={review} />
              ))}
            </QueuePanel>
          </section>

          <section className="grid gap-6 xl:grid-cols-2">
            <QueuePanel title="Decisions & Agents" actionLabel="Research" to="/research">
              {pendingActions.slice(0, 6).map(action => (
                <PendingActionItem key={action.id} action={action} />
              ))}
              {pendingActions.length === 0 && <EmptyLine>No pending agent actions.</EmptyLine>}
              <div className="mt-3 grid grid-cols-2 gap-2">
                <SmallCount label="Research" value={researchIdeas.length} to="/research" />
                <SmallCount label="Evaluation" value={evaluationIdeas.length} to="/evaluation" />
              </div>
            </QueuePanel>

            <QueuePanel title="LLM Recommendations" actionLabel="Market atlas" to="/market">
              {recommendations.slice(0, 6).map(recommendation => (
                <RecommendationItem key={recommendation.id} recommendation={recommendation} />
              ))}
              {recommendations.length === 0 && <EmptyLine>No open recommendations yet.</EmptyLine>}
            </QueuePanel>
          </section>
        </div>

        <aside className="min-w-0">
          <div className="sticky top-6 rounded-lg border p-4" style={{ borderColor: 'var(--border-default)', background: 'var(--bg-card)' }}>
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>Session Handoff</h2>
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Copy into Codex or Claude.</p>
              </div>
              <button onClick={copyPrompt} className="t-btn-ghost shrink-0">{copied ? 'Copied' : 'Copy'}</button>
            </div>
            <textarea readOnly value={prompt} className="t-input min-h-[520px] w-full resize-y p-3 text-xs leading-relaxed" />
          </div>
        </aside>
      </main>
    </div>
  )
}

function Metric({ label, status }) {
  const styles = status === 'good'
    ? { bg: 'var(--green-muted)', color: 'var(--green-text)', border: 'rgba(74,222,128,0.3)' }
    : status === 'over'
      ? { bg: 'var(--red-muted)', color: 'var(--red-text)', border: 'rgba(248,113,113,0.3)' }
      : { bg: 'var(--amber-muted)', color: 'var(--amber-text)', border: 'rgba(251,191,36,0.3)' }
  return <span className="rounded border px-2 py-1" style={{ background: styles.bg, color: styles.color, borderColor: styles.border }}>{label}</span>
}

function FocusPanel({ label, title, meta, to, tone }) {
  const color = tone === 'green'
    ? { bg: 'var(--green-muted)', color: 'var(--green-text)' }
    : tone === 'warn'
      ? { bg: 'var(--amber-muted)', color: 'var(--amber-text)' }
      : { bg: 'var(--blue-muted)', color: 'var(--blue-text)' }

  return (
    <Link to={to} className="block rounded-lg border p-4 transition-colors hover:bg-[var(--bg-hover)]" style={{ borderColor: 'var(--border-default)', background: 'var(--bg-card)' }}>
      <span className="rounded px-2 py-1 text-[10px] font-semibold uppercase" style={{ background: color.bg, color: color.color }}>{label}</span>
      <h3 className="mt-3 line-clamp-2 text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{title}</h3>
      <p className="mt-2 line-clamp-3 text-xs" style={{ color: 'var(--text-muted)' }}>{meta}</p>
    </Link>
  )
}

function QueuePanel({ title, actionLabel, to, children }) {
  return (
    <section className="rounded-lg border" style={{ borderColor: 'var(--border-default)', background: 'var(--bg-card)' }}>
      <div className="flex items-center justify-between border-b px-4 py-3" style={{ borderColor: 'var(--border-subtle)' }}>
        <h2 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{title}</h2>
        <Link to={to} className="text-xs" style={{ color: 'var(--blue-text)' }}>{actionLabel}</Link>
      </div>
      <div className="divide-y" style={{ borderColor: 'var(--border-subtle)' }}>{children}</div>
    </section>
  )
}

function ProductItem({ product }) {
  const stale = daysSince(product.last_updated)
  return (
    <Link to="/development" className="block px-4 py-3 hover:bg-[var(--bg-hover)]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{product.product}</div>
          <div className="mt-1 line-clamp-2 text-xs" style={{ color: 'var(--text-muted)' }}>{product.today_action || product.decision_needed || product.blocker_risk || product.state || 'Needs next action'}</div>
        </div>
        <span className="shrink-0 text-[10px]" style={{ color: stale >= 14 ? 'var(--amber-text)' : 'var(--text-faint)' }}>{stale ?? '-'}d</span>
      </div>
    </Link>
  )
}

function OpportunityItem({ review }) {
  return (
    <Link to="/opportunities" className="block px-4 py-3 hover:bg-[var(--bg-hover)]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{review.candidateName}</div>
          <div className="mt-1 line-clamp-2 text-xs" style={{ color: 'var(--text-muted)' }}>{review.next_action || review.rationale || review.signal_type}</div>
        </div>
        <span className="shrink-0 rounded px-1.5 py-0.5 text-[10px]" style={{ background: 'var(--bg-active)', color: 'var(--text-muted)' }}>{review.priority}</span>
      </div>
    </Link>
  )
}

function PendingActionItem({ action }) {
  return (
    <div className="px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{actionLabel(action.action)}</div>
          <div className="mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>{action.context?.ingredient_name || action.entity_type}</div>
        </div>
        <span className="shrink-0 text-[10px]" style={{ color: action.status === 'in_progress' ? 'var(--amber-text)' : 'var(--text-faint)' }}>{action.status}</span>
      </div>
    </div>
  )
}

function RecommendationItem({ recommendation }) {
  return (
    <div className="px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{recommendation.title}</div>
          <div className="mt-1 line-clamp-2 text-xs" style={{ color: 'var(--text-muted)' }}>{recommendation.next_action || recommendation.recommendation}</div>
        </div>
        <span className="shrink-0 rounded px-1.5 py-0.5 text-[10px]" style={{ background: 'var(--bg-active)', color: 'var(--text-muted)' }}>{recommendation.priority}</span>
      </div>
    </div>
  )
}

function SmallCount({ label, value, to }) {
  return (
    <Link to={to} className="rounded-md border p-3 hover:bg-[var(--bg-hover)]" style={{ borderColor: 'var(--border-default)' }}>
      <div className="text-[10px] font-semibold uppercase" style={{ color: 'var(--text-faint)' }}>{label}</div>
      <div className="mt-1 text-xl font-semibold" style={{ color: 'var(--text-primary)' }}>{value}</div>
    </Link>
  )
}

function EmptyLine({ children }) {
  return <div className="px-4 py-6 text-sm" style={{ color: 'var(--text-muted)' }}>{children}</div>
}

function InlineWarning({ children }) {
  return <div className="mb-3 rounded-md border px-3 py-2 text-sm" style={{ borderColor: 'rgba(248,113,113,0.3)', background: 'var(--red-muted)', color: 'var(--red-text)' }}>{children}</div>
}
