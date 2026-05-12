import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import {
  buildOpportunityPrompt,
  buildReviewDraft,
  confidenceForScore,
  formatGrowth,
  formatNumber,
  formatUsd,
  getMarketSignals,
  normalizeIdeaName,
  priorityForScore,
  scoreOpportunity,
  sortByPriorityThenScore,
} from '../lib/opportunity'

const TABS = [
  { key: 'queue', label: 'Review Queue' },
  { key: 'suggested', label: 'Suggested' },
  { key: 'manual', label: 'Manual Ideas' },
  { key: 'watching', label: 'Watching' },
  { key: 'closed', label: 'Parked / Dismissed' },
]

const STATUSES = ['new', 'reviewing', 'watching', 'queued_research', 'researching', 'parked', 'dismissed', 'promoted']
const PRIORITIES = ['urgent', 'high', 'medium', 'low']

function mondayString(date = new Date()) {
  const d = new Date(date)
  const daysSinceMonday = (d.getDay() + 6) % 7
  d.setDate(d.getDate() - daysSinceMonday)
  return d.toISOString().slice(0, 10)
}

function marketRows(snapshots, candidates, reviews) {
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
      return { id: snapshot.id, snapshot, candidate, review, signals, score, priority: review?.priority || priorityForScore(score) }
    })
  return { latestImport, latest }
}

function reviewRows(reviews, candidates, snapshots) {
  const candidateMap = new Map(candidates.map(candidate => [candidate.id, candidate]))
  const latestSnapshotByCandidate = new Map()
  for (const snapshot of snapshots) {
    const current = latestSnapshotByCandidate.get(snapshot.candidate_id)
    if (!current || snapshot.import_date > current.import_date) latestSnapshotByCandidate.set(snapshot.candidate_id, snapshot)
  }
  return reviews
    .map(review => {
      const candidate = candidateMap.get(review.candidate_id)
      if (!candidate) return null
      const snapshot = latestSnapshotByCandidate.get(review.candidate_id) || {}
      const score = review.toniiq_fit_score ?? scoreOpportunity(snapshot)
      return {
        id: review.id,
        review,
        candidate,
        snapshot,
        score,
        priority: review.priority || priorityForScore(score),
        signals: getMarketSignals(snapshot),
      }
    })
    .filter(Boolean)
}

export default function OpportunityQueuePage() {
  const [snapshots, setSnapshots] = useState([])
  const [candidates, setCandidates] = useState([])
  const [reviews, setReviews] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [tab, setTab] = useState('queue')
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState(null)
  const [draftPatch, setDraftPatch] = useState({})
  const [saving, setSaving] = useState(false)
  const [copiedId, setCopiedId] = useState(null)
  const [manualOpen, setManualOpen] = useState(false)
  const [manual, setManual] = useState({
    name: '',
    category: '',
    source_context: '',
    initial_hypothesis: '',
    urgency: 'medium',
  })

  useEffect(() => {
    let ignore = false

    async function fetchData() {
      const [snapshotsRes, candidatesRes, reviewsRes] = await Promise.all([
        supabase.from('poe_snapshots').select('*').order('import_date', { ascending: false }),
        supabase.from('idea_candidates').select('id, ingredient_name, ingredient_name_normalized, category, stage, first_surfaced_at, surfaced_week, notes'),
        supabase.from('opportunity_reviews').select('*').order('created_at', { ascending: false }),
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
    () => marketRows(snapshots, candidates, reviews),
    [snapshots, candidates, reviews]
  )
  const persistedRows = useMemo(
    () => reviewRows(reviews, candidates, snapshots),
    [reviews, candidates, snapshots]
  )
  const suggestedRows = useMemo(
    () => latest.filter(row => row.score >= 65 && !row.review && !row.signals.isRootNoise).sort(sortByPriorityThenScore),
    [latest]
  )

  const visibleRows = useMemo(() => {
    const q = search.trim().toLowerCase()
    let rows
    if (tab === 'suggested') rows = suggestedRows
    else if (tab === 'manual') rows = persistedRows.filter(row => row.review.source === 'manual')
    else if (tab === 'watching') rows = persistedRows.filter(row => row.review.status === 'watching')
    else if (tab === 'closed') rows = persistedRows.filter(row => ['parked', 'dismissed'].includes(row.review.status))
    else rows = persistedRows.filter(row => ['new', 'reviewing', 'queued_research', 'researching'].includes(row.review.status))

    return rows
      .filter(row => {
        if (!q) return true
        const text = [
          row.candidate.ingredient_name,
          row.candidate.category,
          row.review?.signal_type,
          row.review?.rationale,
          row.review?.next_action,
          row.snapshot?.customer_need,
          ...(row.review?.signal_tags || row.signals?.wedgeHits || []),
        ].filter(Boolean).join(' ').toLowerCase()
        return text.includes(q)
      })
      .sort(sortByPriorityThenScore)
  }, [persistedRows, search, suggestedRows, tab])

  const selected = useMemo(
    () => visibleRows.find(row => row.id === selectedId) || visibleRows[0] || null,
    [selectedId, visibleRows]
  )

  const draft = useMemo(() => {
    if (!selected) return null
    const base = selected.review || buildReviewDraft(selected.snapshot, selected.candidate)
    return { ...base, ...draftPatch }
  }, [selected, draftPatch])

  function switchTab(nextTab) {
    setTab(nextTab)
    setSelectedId(null)
    setDraftPatch({})
  }

  function openRow(row) {
    setSelectedId(row.id)
    setDraftPatch({})
  }

  function patchDraft(key, value) {
    setDraftPatch(prev => ({ ...prev, [key]: value }))
  }

  async function upsertReviewForRow(row, overrides = {}) {
    if (!row) return null
    setSaving(true)
    const base = row.review || buildReviewDraft(row.snapshot, row.candidate)
    const score = Number(overrides.toniiq_fit_score ?? base.toniiq_fit_score ?? row.score ?? 50)
    const payload = {
      candidate_id: row.candidate.id,
      source: overrides.source || base.source || 'poe',
      status: overrides.status || base.status || 'new',
      priority: overrides.priority || base.priority || priorityForScore(score),
      signal_type: overrides.signal_type || base.signal_type || row.signals.signalType || 'unclassified',
      signal_tags: overrides.signal_tags || base.signal_tags || row.signals.wedgeHits || [],
      toniiq_fit_score: score,
      confidence: overrides.confidence || base.confidence || confidenceForScore(score),
      rationale: overrides.rationale || base.rationale || null,
      next_action: overrides.next_action || base.next_action || null,
      decision_notes: overrides.decision_notes || base.decision_notes || null,
      source_context: overrides.source_context || base.source_context || null,
      initial_hypothesis: overrides.initial_hypothesis || base.initial_hypothesis || null,
      urgency: overrides.urgency || base.urgency || null,
      reviewed_at: new Date().toISOString(),
    }

    const { data, error: saveError } = await supabase
      .from('opportunity_reviews')
      .upsert(payload, { onConflict: 'candidate_id' })
      .select()
      .single()
    if (saveError) {
      alert(saveError.message)
      setSaving(false)
      return null
    }
    setReviews(prev => [data, ...prev.filter(review => review.candidate_id !== data.candidate_id)])
    if (selected?.candidate.id === row.candidate.id) setDraftPatch({})
    setSaving(false)
    return data
  }

  async function saveDraft(extra = {}) {
    if (!selected || !draft) return null
    return upsertReviewForRow(selected, { ...draft, ...extra })
  }

  async function queueResearch(row = selected) {
    if (!row) return
    const review = row.review || await upsertReviewForRow(row)
    if (!review) return
    const { data: action, error: actionError } = await supabase.from('pending_actions').insert({
      entity_type: 'idea',
      entity_id: row.candidate.id,
      action: 'run_phase_a',
      triggered_by: 'ui',
      context: {
        ingredient_name: row.candidate.ingredient_name,
        source: 'opportunity_queue',
        opportunity_review_id: review?.id,
      },
    }).select('id').single()
    if (actionError) {
      alert(actionError.message)
      return
    }
    const reviewedAt = new Date().toISOString()
    await supabase.from('opportunity_reviews').update({ status: 'queued_research', reviewed_at: reviewedAt }).eq('candidate_id', row.candidate.id)
    setReviews(prev => prev.map(item => item.candidate_id === row.candidate.id ? { ...item, status: 'queued_research', reviewed_at: reviewedAt } : item))
    supabase.functions.invoke('phase-a-gather', { body: { pending_action_id: action.id } }).catch(error => console.error(error))
    alert(`Research queued for ${row.candidate.ingredient_name}.`)
  }

  async function copyPrompt(row = selected) {
    if (!row) return
    await navigator.clipboard.writeText(buildOpportunityPrompt({ candidate: row.candidate, snapshot: row.snapshot, review: row.review || draft }))
    setCopiedId(row.id)
    setTimeout(() => setCopiedId(null), 1400)
  }

  async function createManualIdea(event) {
    event.preventDefault()
    const name = manual.name.trim()
    if (!name) return
    setSaving(true)
    const normalized = normalizeIdeaName(name)
    let candidate = candidates.find(item => item.ingredient_name_normalized === normalized)

    if (!candidate) {
      const { data, error: insertError } = await supabase.from('idea_candidates').insert({
        ingredient_name: name,
        ingredient_name_normalized: normalized,
        category: manual.category.trim() || null,
        stage: 'inbox',
        source_poe: false,
        source_datarova: false,
        source_count: 0,
        surfaced_week: mondayString(),
        notes: manual.initial_hypothesis.trim() || null,
        in_toniiq_catalog: false,
      }).select('id, ingredient_name, ingredient_name_normalized, category, stage, first_surfaced_at, surfaced_week, notes').single()
      if (insertError) {
        alert(insertError.message)
        setSaving(false)
        return
      }
      candidate = data
      setCandidates(prev => [data, ...prev])
    }

    const { data: review, error: reviewError } = await supabase.from('opportunity_reviews').upsert({
      candidate_id: candidate.id,
      source: 'manual',
      status: 'new',
      priority: manual.urgency,
      signal_type: 'manual idea',
      signal_tags: ['manual'],
      toniiq_fit_score: manual.urgency === 'urgent' ? 80 : manual.urgency === 'high' ? 70 : 55,
      confidence: 'medium',
      source_context: manual.source_context.trim() || null,
      initial_hypothesis: manual.initial_hypothesis.trim() || null,
      rationale: manual.initial_hypothesis.trim() || 'Manual idea captured for later research.',
      next_action: 'Review this manual idea and decide whether to run Phase A research.',
      urgency: manual.urgency,
      reviewed_at: new Date().toISOString(),
    }, { onConflict: 'candidate_id' }).select().single()

    if (reviewError) alert(reviewError.message)
    else {
      setReviews(prev => [review, ...prev.filter(item => item.candidate_id !== review.candidate_id)])
      setManual({ name: '', category: '', source_context: '', initial_hypothesis: '', urgency: 'medium' })
      setManualOpen(false)
      switchTab('manual')
    }
    setSaving(false)
  }

  if (loading) return <div className="flex min-h-[60vh] items-center justify-center text-sm" style={{ color: 'var(--text-faint)' }}>Loading opportunity queue...</div>
  if (error) return <div className="p-6 text-sm" style={{ color: 'var(--red-text)' }}>{error}</div>

  const openCount = persistedRows.filter(row => ['new', 'reviewing', 'queued_research', 'researching'].includes(row.review.status)).length
  const highCount = persistedRows.filter(row => ['urgent', 'high'].includes(row.review.priority) && !['dismissed', 'parked'].includes(row.review.status)).length

  return (
    <div className="min-h-screen">
      <div className="border-b px-6 py-5" style={{ borderColor: 'var(--border-default)', background: 'var(--bg-base)' }}>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="text-2xl font-semibold" style={{ color: 'var(--text-primary)' }}>Opportunity Queue</h1>
            <p className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>
              Human review layer above the POE Market Atlas. Latest POE import: {latestImport || 'none'}.
            </p>
            <div className="mt-3 flex flex-wrap gap-2 text-xs">
              <MetricPill label={`${openCount} open`} tone="blue" />
              <MetricPill label={`${highCount} high priority`} tone="amber" />
              <MetricPill label={`${suggestedRows.length} suggested from atlas`} tone="green" />
              <MetricPill label={`${persistedRows.filter(row => row.review.source === 'manual').length} manual ideas`} />
            </div>
          </div>
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:min-w-[420px]">
            <div className="flex gap-2">
              <input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search queue, rationale, tags" className="t-input h-10 min-w-0 flex-1 px-3 text-sm" />
              <button onClick={() => setManualOpen(value => !value)} className="t-btn h-10">{manualOpen ? 'Close' : 'Add idea'}</button>
            </div>
          </div>
        </div>

        {manualOpen && (
          <form onSubmit={createManualIdea} className="mt-5 grid gap-3 rounded-lg border p-4 lg:grid-cols-[1fr_180px_180px]" style={{ borderColor: 'var(--border-default)', background: 'var(--bg-card)' }}>
            <input value={manual.name} onChange={event => setManual(prev => ({ ...prev, name: event.target.value }))} placeholder="Idea name" className="t-input h-10 px-3 text-sm" />
            <input value={manual.category} onChange={event => setManual(prev => ({ ...prev, category: event.target.value }))} placeholder="Category" className="t-input h-10 px-3 text-sm" />
            <select value={manual.urgency} onChange={event => setManual(prev => ({ ...prev, urgency: event.target.value }))} className="t-input h-10 px-3 text-sm">
              {PRIORITIES.map(priority => <option key={priority} value={priority}>{priority}</option>)}
            </select>
            <textarea value={manual.source_context} onChange={event => setManual(prev => ({ ...prev, source_context: event.target.value }))} placeholder="Where did this come from?" className="t-input p-3 text-sm lg:col-span-3" rows={2} />
            <textarea value={manual.initial_hypothesis} onChange={event => setManual(prev => ({ ...prev, initial_hypothesis: event.target.value }))} placeholder="Why might this be a Toniiq idea?" className="t-input p-3 text-sm lg:col-span-3" rows={2} />
            <div className="lg:col-span-3 flex justify-end">
              <button disabled={saving} className="t-btn">{saving ? 'Saving...' : 'Create idea'}</button>
            </div>
          </form>
        )}

        <div className="mt-5 flex gap-1 overflow-x-auto border-b" style={{ borderColor: 'var(--border-default)' }}>
          {TABS.map(item => (
            <button
              key={item.key}
              onClick={() => switchTab(item.key)}
              className="min-w-max border-b-2 px-4 py-2 text-sm font-medium"
              style={{ borderBottomColor: tab === item.key ? 'var(--text-primary)' : 'transparent', color: tab === item.key ? 'var(--text-primary)' : 'var(--text-muted)' }}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid xl:grid-cols-[minmax(0,1fr)_460px]">
        <main className="min-w-0 p-6">
          <div className="overflow-hidden rounded-lg border" style={{ borderColor: 'var(--border-default)', background: 'var(--bg-card)' }}>
            {visibleRows.length === 0 ? (
              <div className="py-16 text-center text-sm" style={{ color: 'var(--text-muted)' }}>No opportunities in this view.</div>
            ) : (
              <div className="divide-y" style={{ borderColor: 'var(--border-subtle)' }}>
                {visibleRows.map(row => (
                  <OpportunityRow
                    key={row.id}
                    row={row}
                    selected={selected?.id === row.id}
                    saving={saving}
                    copied={copiedId === row.id}
                    onOpen={() => openRow(row)}
                    onSave={() => upsertReviewForRow(row)}
                    onQueueResearch={() => queueResearch(row)}
                    onCopy={() => copyPrompt(row)}
                  />
                ))}
              </div>
            )}
          </div>
        </main>
        <aside className="border-l xl:sticky xl:top-0 xl:h-screen xl:overflow-y-auto" style={{ borderColor: 'var(--border-default)', background: 'var(--bg-raised)' }}>
          <OpportunityDrawer
            row={selected}
            draft={draft}
            patchDraft={patchDraft}
            saving={saving}
            copied={selected && copiedId === selected.id}
            onSave={saveDraft}
            onQueueResearch={() => queueResearch(selected)}
            onCopy={() => copyPrompt(selected)}
          />
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

function OpportunityRow({ row, selected, saving, copied, onOpen, onSave, onQueueResearch, onCopy }) {
  const review = row.review
  return (
    <div className="px-4 py-4" style={{ background: selected ? 'var(--bg-hover)' : 'transparent' }}>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <button onClick={onOpen} className="min-w-0 flex-1 text-left">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>{row.candidate.ingredient_name}</span>
            <SmallBadge>{review?.priority || row.priority}</SmallBadge>
            <SmallBadge>{review?.status || 'suggested'}</SmallBadge>
            <SmallBadge>{review?.signal_type || row.signals.signalType}</SmallBadge>
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{review?.toniiq_fit_score ?? row.score}/100</span>
          </div>
          <p className="mt-1 line-clamp-2 text-xs" style={{ color: 'var(--text-muted)' }}>
            {review?.rationale || buildReviewDraft(row.snapshot, row.candidate).rationale}
          </p>
        </button>
        <div className="flex shrink-0 flex-wrap gap-1.5">
          {!review && <button onClick={onSave} disabled={saving} className="t-btn-ghost px-2.5 py-1 text-[11px]">{saving ? 'Adding...' : 'Add'}</button>}
          <button onClick={onQueueResearch} className="t-btn-ghost px-2.5 py-1 text-[11px]">Run research</button>
          <button onClick={onCopy} className="t-btn-ghost px-2.5 py-1 text-[11px]">{copied ? 'Copied' : 'Prompt'}</button>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2 text-xs" style={{ color: 'var(--text-faint)' }}>
        <span>{row.candidate.category || 'Uncategorized'}</span>
        {row.snapshot?.search_volume_90d && <span>{formatNumber(row.snapshot.search_volume_90d)} 90d searches</span>}
        {row.snapshot?.search_volume_growth_90d !== undefined && <span>{formatGrowth(row.snapshot.search_volume_growth_90d)} 90d</span>}
        {row.snapshot?.avg_price_usd && <span>{formatUsd(row.snapshot.avg_price_usd)}</span>}
      </div>
    </div>
  )
}

function OpportunityDrawer({ row, draft, patchDraft, saving, copied, onSave, onQueueResearch, onCopy }) {
  if (!row || !draft) return <div className="p-6 text-sm" style={{ color: 'var(--text-muted)' }}>Select an opportunity.</div>
  const prompt = buildOpportunityPrompt({ candidate: row.candidate, snapshot: row.snapshot, review: draft })

  return (
    <div className="p-5">
      <div className="mb-5">
        <div className="mb-2 flex flex-wrap gap-2">
          <SmallBadge>{draft.source || 'poe'}</SmallBadge>
          <SmallBadge>{draft.status}</SmallBadge>
          <SmallBadge>{draft.priority}</SmallBadge>
        </div>
        <h2 className="text-xl font-semibold leading-tight" style={{ color: 'var(--text-primary)' }}>{row.candidate.ingredient_name}</h2>
        <div className="mt-2 text-xs" style={{ color: 'var(--text-muted)' }}>
          {row.candidate.stage} · {draft.toniiq_fit_score ?? row.score}/100 Toniiq fit
        </div>
      </div>

      <DrawerSection title="Review">
        <div className="grid gap-3 sm:grid-cols-2">
          <SelectField label="Status" value={draft.status || 'new'} options={STATUSES} onChange={value => patchDraft('status', value)} />
          <SelectField label="Priority" value={draft.priority || 'medium'} options={PRIORITIES} onChange={value => patchDraft('priority', value)} />
          <InputField label="Signal type" value={draft.signal_type || ''} onChange={value => patchDraft('signal_type', value)} />
          <InputField label="Toniiq fit" type="number" value={draft.toniiq_fit_score ?? row.score} onChange={value => patchDraft('toniiq_fit_score', value)} />
        </div>
        <TextAreaField label="Rationale" value={draft.rationale || ''} onChange={value => patchDraft('rationale', value)} rows={4} />
        <TextAreaField label="Next action" value={draft.next_action || ''} onChange={value => patchDraft('next_action', value)} rows={2} />
        <TextAreaField label="Decision notes" value={draft.decision_notes || ''} onChange={value => patchDraft('decision_notes', value)} rows={3} />
        <div className="mt-3 flex flex-wrap justify-end gap-2">
          <button onClick={onQueueResearch} className="t-btn-ghost">Run research</button>
          <button onClick={() => onSave()} disabled={saving} className="t-btn">{saving ? 'Saving...' : 'Save'}</button>
        </div>
      </DrawerSection>

      <DrawerSection title="Evidence">
        <div className="grid grid-cols-2 gap-3">
          <Readout label="90d volume" value={formatNumber(row.snapshot?.search_volume_90d)} />
          <Readout label="90d growth" value={formatGrowth(row.snapshot?.search_volume_growth_90d)} />
          <Readout label="180d growth" value={formatGrowth(row.snapshot?.search_volume_growth_180d)} />
          <Readout label="Avg price" value={formatUsd(row.snapshot?.avg_price_usd)} />
        </div>
        {draft.source_context && <ReadOnlyBlock label="Source context" value={draft.source_context} />}
        <div className="mt-3 flex flex-wrap gap-2">
          <Link to={`/discovery/${row.candidate.id}`} className="rounded border px-2.5 py-1 text-xs" style={{ borderColor: 'var(--border-default)', color: 'var(--blue-text)' }}>Discovery page</Link>
          <Link to="/market" className="rounded border px-2.5 py-1 text-xs" style={{ borderColor: 'var(--border-default)', color: 'var(--text-muted)' }}>Market Atlas</Link>
        </div>
      </DrawerSection>

      <DrawerSection title="Handoff">
        <textarea readOnly value={prompt} className="t-input min-h-56 w-full resize-y p-3 text-xs leading-relaxed" />
        <div className="mt-3 flex justify-end">
          <button onClick={onCopy} className="t-btn-ghost">{copied ? 'Copied' : 'Copy prompt'}</button>
        </div>
      </DrawerSection>
    </div>
  )
}

function SmallBadge({ children }) {
  return <span className="rounded border px-1.5 py-0.5 text-[10px] font-medium" style={{ borderColor: 'var(--border-default)', background: 'var(--bg-active)', color: 'var(--text-muted)' }}>{children}</span>
}

function DrawerSection({ title, children }) {
  return <section className="mb-5"><h3 className="mb-2 text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{title}</h3>{children}</section>
}

function InputField({ label, value, onChange, type = 'text' }) {
  return <label className="block"><span className="mb-1 block text-xs font-medium" style={{ color: 'var(--text-muted)' }}>{label}</span><input type={type} value={value} onChange={event => onChange(event.target.value)} className="t-input h-9 w-full px-2 text-sm" /></label>
}

function SelectField({ label, value, onChange, options }) {
  return <label className="block"><span className="mb-1 block text-xs font-medium" style={{ color: 'var(--text-muted)' }}>{label}</span><select value={value} onChange={event => onChange(event.target.value)} className="t-input h-9 w-full px-2 text-sm">{options.map(option => <option key={option} value={option}>{option}</option>)}</select></label>
}

function TextAreaField({ label, value, onChange, rows }) {
  return <label className="mb-3 block"><span className="mb-1 block text-xs font-medium" style={{ color: 'var(--text-muted)' }}>{label}</span><textarea value={value} onChange={event => onChange(event.target.value)} rows={rows} className="t-input w-full resize-y p-2 text-sm leading-relaxed" /></label>
}

function Readout({ label, value }) {
  return <div className="rounded-md border p-3" style={{ borderColor: 'var(--border-default)', background: 'var(--bg-card)' }}><div className="text-[10px] font-semibold uppercase" style={{ color: 'var(--text-faint)' }}>{label}</div><div className="mt-1 text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{value}</div></div>
}

function ReadOnlyBlock({ label, value }) {
  return <div className="mt-3"><div className="mb-1 text-[10px] font-semibold uppercase" style={{ color: 'var(--text-faint)' }}>{label}</div><div className="rounded-md border p-3 text-xs leading-relaxed" style={{ borderColor: 'var(--border-default)', color: 'var(--text-muted)', background: 'var(--bg-card)' }}>{value}</div></div>
}
