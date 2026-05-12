import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import {
  buildOpportunityPrompt,
  buildReviewDraft,
  formatGrowth,
  formatNumber,
  formatUsd,
  getMarketSignals,
  scoreOpportunity,
  sortByPriorityThenScore,
} from '../lib/opportunity'

const LENSES = [
  { key: 'all', label: 'All Latest' },
  { key: 'suggested', label: 'Suggested' },
  { key: 'breakout', label: 'Breakouts' },
  { key: 'wedge', label: 'Toniiq Wedges' },
  { key: 'root', label: 'Root Markets' },
  { key: 'brand', label: 'Brand-Led' },
]

const BADGE_STYLES = {
  urgent: { bg: 'var(--red-muted)', color: 'var(--red-text)', border: 'rgba(248,113,113,0.3)' },
  high: { bg: 'var(--amber-muted)', color: 'var(--amber-text)', border: 'rgba(251,191,36,0.3)' },
  medium: { bg: 'var(--blue-muted)', color: 'var(--blue-text)', border: 'rgba(96,165,250,0.3)' },
  low: { bg: 'var(--bg-active)', color: 'var(--text-muted)', border: 'var(--border-default)' },
}

function readRows(snapshots, candidates, reviews) {
  const candidateMap = new Map(candidates.map(candidate => [candidate.id, candidate]))
  const reviewMap = new Map(reviews.map(review => [review.candidate_id, review]))
  const latestImport = snapshots.reduce((latest, row) => row.import_date > latest ? row.import_date : latest, '')
  const latest = snapshots
    .filter(snapshot => snapshot.import_date === latestImport && candidateMap.has(snapshot.candidate_id))
    .map(snapshot => {
      const candidate = candidateMap.get(snapshot.candidate_id)
      const review = reviewMap.get(snapshot.candidate_id) || null
      const signals = getMarketSignals(snapshot)
      const score = scoreOpportunity(snapshot)
      return {
        id: snapshot.id,
        snapshot,
        candidate,
        review,
        score,
        priority: review?.priority || (score >= 82 ? 'urgent' : score >= 70 ? 'high' : score >= 55 ? 'medium' : 'low'),
        signals,
      }
    })
  return { latestImport, latest }
}

export default function MarketAtlasPage() {
  const [snapshots, setSnapshots] = useState([])
  const [candidates, setCandidates] = useState([])
  const [reviews, setReviews] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [lens, setLens] = useState('suggested')
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState(null)
  const [savingId, setSavingId] = useState(null)
  const [copiedId, setCopiedId] = useState(null)

  useEffect(() => {
    let ignore = false

    async function fetchData() {
      const [snapshotsRes, candidatesRes, reviewsRes] = await Promise.all([
        supabase.from('poe_snapshots').select('*').order('import_date', { ascending: false }),
        supabase.from('idea_candidates').select('id, ingredient_name, category, stage, first_surfaced_at, surfaced_week, notes'),
        supabase.from('opportunity_reviews').select('*'),
      ])

      if (ignore) return
      if (snapshotsRes.error || candidatesRes.error || reviewsRes.error) {
        setError(snapshotsRes.error?.message || candidatesRes.error?.message || reviewsRes.error?.message)
      } else {
        setSnapshots(snapshotsRes.data || [])
        setCandidates(candidatesRes.data || [])
        setReviews(reviewsRes.data || [])
      }
      setLoading(false)
    }

    fetchData()
    return () => { ignore = true }
  }, [])

  const { latestImport, latest } = useMemo(
    () => readRows(snapshots, candidates, reviews),
    [snapshots, candidates, reviews]
  )

  const visibleRows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return latest
      .filter(row => {
        if (lens === 'suggested') return row.score >= 65 && !row.review && !row.signals.isRootNoise
        if (lens === 'breakout') return Number(row.snapshot.search_volume_growth_90d || 0) >= 0.2 || Number(row.snapshot.search_volume_growth_180d || 0) >= 0.5
        if (lens === 'wedge') return row.signals.wedgeHits.length > 0 || row.signals.activeHits.length > 0
        if (lens === 'root') return row.signals.rootHits.length > 0 && Number(row.snapshot.search_volume_90d || 0) >= 1_000_000
        if (lens === 'brand') return row.signals.brandHits.length > 0
        return true
      })
      .filter(row => {
        if (!q) return true
        const text = [
          row.snapshot.customer_need,
          row.snapshot.top_search_term_1,
          row.snapshot.top_search_term_2,
          row.snapshot.top_search_term_3,
          row.candidate.category,
          row.signals.signalType,
          ...row.signals.wedgeHits,
        ].filter(Boolean).join(' ').toLowerCase()
        return text.includes(q)
      })
      .sort(sortByPriorityThenScore)
  }, [latest, lens, search])

  const selected = useMemo(
    () => visibleRows.find(row => row.id === selectedId) || visibleRows[0] || null,
    [selectedId, visibleRows]
  )

  const counts = useMemo(() => {
    const suggested = latest.filter(row => row.score >= 65 && !row.review && !row.signals.isRootNoise).length
    const queued = latest.filter(row => row.review && !['dismissed', 'parked'].includes(row.review.status)).length
    const breakouts = latest.filter(row => Number(row.snapshot.search_volume_growth_90d || 0) >= 0.2 || Number(row.snapshot.search_volume_growth_180d || 0) >= 0.5).length
    const rootNoise = latest.filter(row => row.signals.isRootNoise).length
    return { suggested, queued, breakouts, rootNoise }
  }, [latest])

  async function addToQueue(row) {
    setSavingId(row.id)
    const draft = buildReviewDraft(row.snapshot, row.candidate)
    const { data, error: saveError } = await supabase
      .from('opportunity_reviews')
      .upsert(draft, { onConflict: 'candidate_id' })
      .select()
      .single()
    if (saveError) {
      alert(saveError.message)
    } else {
      setReviews(prev => {
        const rest = prev.filter(review => review.candidate_id !== data.candidate_id)
        return [data, ...rest]
      })
    }
    setSavingId(null)
  }

  async function copyPrompt(row) {
    await navigator.clipboard.writeText(buildOpportunityPrompt({
      candidate: row.candidate,
      snapshot: row.snapshot,
      review: row.review,
    }))
    setCopiedId(row.id)
    setTimeout(() => setCopiedId(null), 1400)
  }

  if (loading) {
    return <div className="flex min-h-[60vh] items-center justify-center text-sm" style={{ color: 'var(--text-faint)' }}>Loading market atlas...</div>
  }

  if (error) {
    return <div className="p-6 text-sm" style={{ color: 'var(--red-text)' }}>{error}</div>
  }

  return (
    <div className="min-h-screen">
      <div className="border-b px-6 py-5" style={{ borderColor: 'var(--border-default)', background: 'var(--bg-base)' }}>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="text-2xl font-semibold" style={{ color: 'var(--text-primary)' }}>Market Atlas</h1>
            <p className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>
              Monthly POE map for Vitamins & Dietary Supplements. Latest import: {latestImport || 'none'}.
            </p>
            <div className="mt-3 flex flex-wrap gap-2 text-xs">
              <MetricPill label={`${latest.length} latest niches`} />
              <MetricPill label={`${counts.suggested} suggested`} tone="green" />
              <MetricPill label={`${counts.breakouts} breakouts`} tone="amber" />
              <MetricPill label={`${counts.queued} queued`} tone="blue" />
              <MetricPill label={`${counts.rootNoise} root-market rows`} />
            </div>
          </div>
          <div className="w-full sm:w-80">
            <input
              value={search}
              onChange={event => setSearch(event.target.value)}
              placeholder="Search niches, tags, terms"
              className="t-input h-10 w-full px-3 text-sm"
            />
          </div>
        </div>

        <div className="mt-5 flex gap-1 overflow-x-auto border-b" style={{ borderColor: 'var(--border-default)' }}>
          {LENSES.map(item => (
            <button
              key={item.key}
              onClick={() => setLens(item.key)}
              className="min-w-max border-b-2 px-4 py-2 text-sm font-medium"
              style={{
                borderBottomColor: lens === item.key ? 'var(--text-primary)' : 'transparent',
                color: lens === item.key ? 'var(--text-primary)' : 'var(--text-muted)',
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid xl:grid-cols-[minmax(0,1fr)_420px]">
        <main className="min-w-0 p-6">
          <div className="overflow-hidden rounded-lg border" style={{ borderColor: 'var(--border-default)', background: 'var(--bg-card)' }}>
            {visibleRows.length === 0 ? (
              <div className="py-16 text-center text-sm" style={{ color: 'var(--text-muted)' }}>No market rows match this view.</div>
            ) : (
              <div className="divide-y" style={{ borderColor: 'var(--border-subtle)' }}>
                {visibleRows.map(row => (
                  <MarketRow
                    key={row.id}
                    row={row}
                    selected={selected?.id === row.id}
                    saving={savingId === row.id}
                    copied={copiedId === row.id}
                    onSelect={() => setSelectedId(row.id)}
                    onAdd={() => addToQueue(row)}
                    onCopy={() => copyPrompt(row)}
                  />
                ))}
              </div>
            )}
          </div>
        </main>
        <aside className="border-l xl:sticky xl:top-0 xl:h-screen xl:overflow-y-auto" style={{ borderColor: 'var(--border-default)', background: 'var(--bg-raised)' }}>
          <AtlasDrawer row={selected} saving={savingId === selected?.id} copied={copiedId === selected?.id} onAdd={() => selected && addToQueue(selected)} onCopy={() => selected && copyPrompt(selected)} />
        </aside>
      </div>
    </div>
  )
}

function MetricPill({ label, tone = 'neutral' }) {
  const style = tone === 'green'
    ? { bg: 'var(--green-muted)', color: 'var(--green-text)', border: 'rgba(74,222,128,0.3)' }
    : tone === 'amber'
      ? { bg: 'var(--amber-muted)', color: 'var(--amber-text)', border: 'rgba(251,191,36,0.3)' }
      : tone === 'blue'
        ? { bg: 'var(--blue-muted)', color: 'var(--blue-text)', border: 'rgba(96,165,250,0.3)' }
        : { bg: 'var(--bg-active)', color: 'var(--text-muted)', border: 'var(--border-default)' }
  return <span className="rounded border px-2 py-1" style={{ background: style.bg, color: style.color, borderColor: style.border }}>{label}</span>
}

function MarketRow({ row, selected, saving, copied, onSelect, onAdd, onCopy }) {
  const badge = BADGE_STYLES[row.priority] || BADGE_STYLES.medium
  return (
    <div className="px-4 py-4" style={{ background: selected ? 'var(--bg-hover)' : 'transparent' }}>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <button onClick={onSelect} className="min-w-0 flex-1 text-left">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>{row.snapshot.customer_need}</span>
            <span className="rounded border px-1.5 py-0.5 text-[10px] font-medium" style={{ background: badge.bg, color: badge.color, borderColor: badge.border }}>{row.score}/100</span>
            <span className="rounded px-1.5 py-0.5 text-[10px] font-medium" style={{ background: 'var(--bg-active)', color: 'var(--text-muted)' }}>{row.signals.signalType}</span>
            {row.review && <span className="rounded px-1.5 py-0.5 text-[10px] font-medium" style={{ background: 'var(--green-muted)', color: 'var(--green-text)' }}>{row.review.status}</span>}
          </div>
          <div className="mt-1 flex flex-wrap gap-2 text-xs" style={{ color: 'var(--text-faint)' }}>
            <span>{row.candidate.category || 'Uncategorized'}</span>
            <span>{formatNumber(row.snapshot.search_volume_90d)} 90d searches</span>
            <span>{formatGrowth(row.snapshot.search_volume_growth_90d)} 90d</span>
            <span>{formatGrowth(row.snapshot.search_volume_growth_180d)} 180d</span>
            <span>{formatUsd(row.snapshot.avg_price_usd)}</span>
          </div>
        </button>
        <div className="flex shrink-0 flex-wrap gap-1.5">
          {!row.review && <button onClick={onAdd} disabled={saving} className="t-btn-ghost px-2.5 py-1 text-[11px]">{saving ? 'Adding...' : 'Add to queue'}</button>}
          <button onClick={onCopy} className="t-btn-ghost px-2.5 py-1 text-[11px]">{copied ? 'Copied' : 'Copy prompt'}</button>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {[...new Set([...row.signals.activeHits, ...row.signals.wedgeHits])].slice(0, 8).map(tag => (
          <span key={tag} className="rounded border px-2 py-0.5 text-[10px]" style={{ borderColor: 'var(--border-default)', color: 'var(--text-muted)' }}>{tag}</span>
        ))}
      </div>
    </div>
  )
}

function AtlasDrawer({ row, saving, copied, onAdd, onCopy }) {
  if (!row) return <div className="p-6 text-sm" style={{ color: 'var(--text-muted)' }}>Select a market row.</div>
  const prompt = buildOpportunityPrompt({ candidate: row.candidate, snapshot: row.snapshot, review: row.review })

  return (
    <div className="p-5">
      <div className="mb-5">
        <div className="mb-2 text-xs" style={{ color: 'var(--text-faint)' }}>POE import {row.snapshot.import_date}</div>
        <h2 className="text-xl font-semibold leading-tight" style={{ color: 'var(--text-primary)' }}>{row.snapshot.customer_need}</h2>
        <div className="mt-2 flex flex-wrap gap-2 text-xs" style={{ color: 'var(--text-muted)' }}>
          <span>{row.signals.signalType}</span>
          <span>{row.score}/100 Toniiq fit</span>
          <span>{row.candidate.stage}</span>
        </div>
      </div>

      <DrawerSection title="Market Signal">
        <div className="grid grid-cols-2 gap-3">
          <Readout label="90d search volume" value={formatNumber(row.snapshot.search_volume_90d)} />
          <Readout label="360d search volume" value={formatNumber(row.snapshot.search_volume_360d)} />
          <Readout label="90d growth" value={formatGrowth(row.snapshot.search_volume_growth_90d)} />
          <Readout label="180d growth" value={formatGrowth(row.snapshot.search_volume_growth_180d)} />
          <Readout label="Avg price" value={formatUsd(row.snapshot.avg_price_usd)} />
          <Readout label="Top clicked products" value={row.snapshot.top_clicked_products || '-'} />
        </div>
      </DrawerSection>

      <DrawerSection title="Search Terms">
        <div className="flex flex-wrap gap-2">
          {[row.snapshot.top_search_term_1, row.snapshot.top_search_term_2, row.snapshot.top_search_term_3].filter(Boolean).map(term => (
            <span key={term} className="rounded border px-2 py-1 text-xs" style={{ borderColor: 'var(--border-default)', color: 'var(--text-muted)' }}>{term}</span>
          ))}
        </div>
      </DrawerSection>

      <DrawerSection title="Toniiq Lens">
        <ReadOnlyBlock label="Interpretation" value={buildReviewDraft(row.snapshot, row.candidate).rationale} />
        <div className="mt-3 flex flex-wrap gap-2">
          {!row.review && <button onClick={onAdd} disabled={saving} className="t-btn">{saving ? 'Adding...' : 'Add to Opportunity Queue'}</button>}
          {row.review && <Link to="/opportunities" className="t-btn">Open Queue</Link>}
          <button onClick={onCopy} className="t-btn-ghost">{copied ? 'Copied' : 'Copy Codex/Claude prompt'}</button>
        </div>
      </DrawerSection>

      <DrawerSection title="Handoff">
        <textarea readOnly value={prompt} className="t-input min-h-56 w-full resize-y p-3 text-xs leading-relaxed" />
      </DrawerSection>
    </div>
  )
}

function DrawerSection({ title, children }) {
  return (
    <section className="mb-5">
      <h3 className="mb-2 text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{title}</h3>
      {children}
    </section>
  )
}

function Readout({ label, value }) {
  return (
    <div className="rounded-md border p-3" style={{ borderColor: 'var(--border-default)', background: 'var(--bg-card)' }}>
      <div className="text-[10px] font-semibold uppercase" style={{ color: 'var(--text-faint)' }}>{label}</div>
      <div className="mt-1 text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{value}</div>
    </div>
  )
}

function ReadOnlyBlock({ label, value }) {
  return (
    <div>
      <div className="mb-1 text-[10px] font-semibold uppercase" style={{ color: 'var(--text-faint)' }}>{label}</div>
      <div className="rounded-md border p-3 text-xs leading-relaxed" style={{ borderColor: 'var(--border-default)', color: 'var(--text-muted)', background: 'var(--bg-card)' }}>{value}</div>
    </div>
  )
}
