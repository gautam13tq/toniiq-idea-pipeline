import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { formatGrowth, formatNumber, formatUsd } from '../lib/opportunity'

const VIEWS = [
  { key: 'picks', label: 'Monthly AI Picks' },
  { key: 'raw', label: 'Raw POE Audit' },
]

const CURRENT_CURATION_VERSION = 'market-curation-v4'
const CURATION_RUN_ENABLED = true

const SORT_OPTIONS = [
  { key: 'volume', label: '90d volume' },
  { key: 'growth90', label: '90d growth' },
  { key: 'growth180', label: '180d growth' },
  { key: 'price', label: 'Avg price' },
  { key: 'name', label: 'Name' },
]

const FEEDBACK = [
  { value: 'strong_yes', label: 'Strong yes' },
  { value: 'yes', label: 'Yes' },
  { value: 'maybe', label: 'Maybe' },
  { value: 'no', label: 'No' },
  { value: 'strong_no', label: 'Strong no' },
]

function latestImportDate(snapshots) {
  return snapshots.reduce((latest, row) => row.import_date > latest ? row.import_date : latest, '')
}

function priorityForScore(score) {
  if (score >= 85) return 'urgent'
  if (score >= 75) return 'high'
  if (score >= 60) return 'medium'
  return 'low'
}

function confidenceForScore(score) {
  if (score >= 80) return 'high'
  if (score >= 60) return 'medium'
  return 'low'
}

function formatDate(value) {
  if (!value) return 'None'
  return new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function formatDateTime(value) {
  if (!value) return 'Not run'
  return new Date(value).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function safeList(value) {
  if (Array.isArray(value)) return value
  return []
}

function scoreTone(score) {
  if (score >= 85) return { bg: 'var(--green-muted)', color: 'var(--green-text)', border: 'rgba(74,222,128,0.3)' }
  if (score >= 70) return { bg: 'var(--amber-muted)', color: 'var(--amber-text)', border: 'rgba(251,191,36,0.3)' }
  return { bg: 'var(--blue-muted)', color: 'var(--blue-text)', border: 'rgba(96,165,250,0.3)' }
}

function statusTone(status) {
  if (status === 'completed') return 'green'
  if (status === 'failed') return 'red'
  return 'amber'
}

function isCurrentCurationRun(run) {
  return String(run?.prompt_version || '').startsWith(CURRENT_CURATION_VERSION) && run?.status !== 'failed'
}

function readRows({ snapshots, candidates, reviews, picks }) {
  const candidateMap = new Map(candidates.map(candidate => [candidate.id, candidate]))
  const reviewMap = new Map(reviews.map(review => [review.candidate_id, review]))
  const pickMap = new Map(picks.filter(pick => !pick.dismissed_at).map(pick => [pick.candidate_id, pick]))
  const importDate = latestImportDate(snapshots)
  const rows = snapshots
    .filter(snapshot => snapshot.import_date === importDate && candidateMap.has(snapshot.candidate_id))
    .map(snapshot => ({
      id: snapshot.id,
      snapshot,
      candidate: candidateMap.get(snapshot.candidate_id),
      review: reviewMap.get(snapshot.candidate_id) || null,
      pick: pickMap.get(snapshot.candidate_id) || null,
    }))
  return { importDate, rows }
}

function rowText(row) {
  return [
    row.snapshot.customer_need,
    row.snapshot.top_search_term_1,
    row.snapshot.top_search_term_2,
    row.snapshot.top_search_term_3,
    row.candidate?.ingredient_name,
    row.candidate?.category,
    row.candidate?.stage,
    row.pick?.idea_title,
    row.review?.rationale,
  ].filter(Boolean).join(' ').toLowerCase()
}

function sortRows(rows, sortBy) {
  const sorted = [...rows]
  sorted.sort((a, b) => {
    if (sortBy === 'name') return (a.candidate?.ingredient_name || '').localeCompare(b.candidate?.ingredient_name || '')
    if (sortBy === 'growth90') return Number(b.snapshot.search_volume_growth_90d || 0) - Number(a.snapshot.search_volume_growth_90d || 0)
    if (sortBy === 'growth180') return Number(b.snapshot.search_volume_growth_180d || 0) - Number(a.snapshot.search_volume_growth_180d || 0)
    if (sortBy === 'price') return Number(b.snapshot.avg_price_usd || 0) - Number(a.snapshot.avg_price_usd || 0)
    return Number(b.snapshot.search_volume_90d || 0) - Number(a.snapshot.search_volume_90d || 0)
  })
  return sorted
}

function buildPickContext(pick) {
  return [
    `Monthly AI Pick #${pick.rank}: ${pick.idea_title}`,
    `Strategic score: ${pick.strategic_score ?? 'n/a'}/100`,
    `Recommendation: ${pick.recommendation_label}`,
    pick.thesis ? `Thesis: ${pick.thesis}` : null,
    pick.next_action ? `Next action: ${pick.next_action}` : null,
    safeList(pick.evidence_refs).length ? `Evidence: ${safeList(pick.evidence_refs).map(item => `${item.source || 'source'} ${item.label || ''} ${item.value || ''}`.trim()).join('; ')}` : null,
  ].filter(Boolean).join('\n')
}

function buildRawContext(row) {
  return [
    `Raw POE row: ${row.snapshot.customer_need}`,
    `Candidate: ${row.candidate.ingredient_name}`,
    `POE import: ${row.snapshot.import_date}`,
    `90d search volume: ${formatNumber(row.snapshot.search_volume_90d)}`,
    `90d growth: ${formatGrowth(row.snapshot.search_volume_growth_90d)}`,
    `180d growth: ${formatGrowth(row.snapshot.search_volume_growth_180d)}`,
    `Avg price: ${formatUsd(row.snapshot.avg_price_usd)}`,
    'No LLM strategic score assigned yet.',
  ].join('\n')
}

export default function MarketAtlasPage() {
  const [snapshots, setSnapshots] = useState([])
  const [candidates, setCandidates] = useState([])
  const [reviews, setReviews] = useState([])
  const [runs, setRuns] = useState([])
  const [legacyRunCount, setLegacyRunCount] = useState(0)
  const [picks, setPicks] = useState([])
  const [selectedRunId, setSelectedRunId] = useState('')
  const [view, setView] = useState('picks')
  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState('volume')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [running, setRunning] = useState(false)
  const [savingId, setSavingId] = useState(null)
  const [feedbackDraft, setFeedbackDraft] = useState({})

  async function loadBaseData() {
    setError('')
    const [snapshotsRes, candidatesRes, reviewsRes, runsRes] = await Promise.all([
      supabase.from('poe_snapshots').select('*').order('import_date', { ascending: false }),
      supabase.from('idea_candidates').select('id, ingredient_name, ingredient_name_normalized, category, stage, first_surfaced_at, surfaced_week, notes'),
      supabase.from('opportunity_reviews').select('*').order('created_at', { ascending: false }),
      supabase.from('market_curation_runs').select('*').order('created_at', { ascending: false }).limit(12),
    ])

    const loadError = snapshotsRes.error || candidatesRes.error || reviewsRes.error || runsRes.error
    if (loadError) {
      setError(loadError.message)
      setLoading(false)
      return
    }

    setSnapshots(snapshotsRes.data || [])
    setCandidates(candidatesRes.data || [])
    setReviews(reviewsRes.data || [])
    const runRows = runsRes.data || []
    const currentRuns = runRows.filter(isCurrentCurationRun)
    setRuns(currentRuns)
    setLegacyRunCount(runRows.filter(run => !String(run?.prompt_version || '').startsWith(CURRENT_CURATION_VERSION)).length)
    if (!selectedRunId && currentRuns[0]) setSelectedRunId(currentRuns[0].id)
    setLoading(false)
  }

  useEffect(() => {
    let ignore = false
    async function fetchData() {
      if (ignore) return
      await loadBaseData()
    }
    fetchData()
    return () => { ignore = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    let ignore = false
    async function fetchPicks() {
      if (!selectedRunId) {
        setPicks([])
        return
      }
      const { data, error: picksError } = await supabase
        .from('market_curation_picks')
        .select('*')
        .eq('run_id', selectedRunId)
        .order('rank')
      if (ignore) return
      if (picksError) setError(picksError.message)
      else setPicks(data || [])
    }
    fetchPicks()
    return () => { ignore = true }
  }, [selectedRunId])

  const { importDate, rows } = useMemo(
    () => readRows({ snapshots, candidates, reviews, picks }),
    [snapshots, candidates, reviews, picks]
  )

  const selectedRun = useMemo(
    () => runs.find(run => run.id === selectedRunId) || null,
    [runs, selectedRunId]
  )

  const visibleRows = useMemo(() => {
    const q = search.trim().toLowerCase()
    const filtered = rows.filter(row => !q || rowText(row).includes(q))
    return sortRows(filtered, sortBy)
  }, [rows, search, sortBy])

  const visiblePicks = useMemo(() => {
    const q = search.trim().toLowerCase()
    return picks
      .filter(pick => !pick.dismissed_at)
      .filter(pick => {
        if (!q) return true
        const text = [
          pick.idea_title,
          pick.cluster_name,
          pick.thesis,
          pick.next_action,
          pick.duplicate_status,
          pick.recommendation_label,
          ...safeList(pick.risks),
        ].filter(Boolean).join(' ').toLowerCase()
        return text.includes(q)
      })
      .sort((a, b) => a.rank - b.rank)
  }, [picks, search])

  async function reloadRunsAndPicks(nextRunId) {
    const { data: runData } = await supabase.from('market_curation_runs').select('*').order('created_at', { ascending: false }).limit(12)
    const runRows = runData || []
    const currentRuns = runRows.filter(isCurrentCurationRun)
    setRuns(currentRuns)
    setLegacyRunCount(runRows.filter(run => !String(run?.prompt_version || '').startsWith(CURRENT_CURATION_VERSION)).length)
    if (nextRunId) setSelectedRunId(nextRunId)
    else if (!selectedRunId && currentRuns[0]) setSelectedRunId(currentRuns[0].id)
  }

  async function runMonthlyCuration() {
    if (!CURATION_RUN_ENABLED) {
      setError('Market Atlas v4 curation is temporarily disabled while calibration is running. Use Raw POE Audit until the v4 scoring function is ready.')
      return
    }
    if (!importDate) return
    const ok = confirm(`Run monthly AI curation for POE import ${importDate}?\n\nThis will use Anthropic to produce a strategic shortlist from the POE + Datarova data.`)
    if (!ok) return
    setRunning(true)
    setError('')
    const { data, error: invokeError } = await supabase.functions.invoke('market-curation-run', {
      body: { import_date: importDate, count: 12, max_rows: 50, llm_candidate_limit: 30 },
    })
    if (invokeError) {
      setError(invokeError.message)
    } else {
      await reloadRunsAndPicks(data?.run_id)
      setView('picks')
    }
    setRunning(false)
  }

  async function addPickToQueue(pick) {
    if (!pick.candidate_id) return null
    setSavingId(pick.id)
    const score = Number(pick.strategic_score || 0)
    const { data, error: saveError } = await supabase
      .from('opportunity_reviews')
      .upsert({
        candidate_id: pick.candidate_id,
        source: 'llm',
        status: 'new',
        priority: priorityForScore(score),
        signal_type: 'monthly_ai_pick',
        signal_tags: ['monthly_curation', pick.recommendation_label].filter(Boolean),
        toniiq_fit_score: score || null,
        confidence: confidenceForScore(score),
        rationale: pick.thesis || null,
        next_action: pick.next_action || null,
        source_context: buildPickContext(pick),
        initial_hypothesis: pick.thesis || null,
        reviewed_at: new Date().toISOString(),
      }, { onConflict: 'candidate_id' })
      .select()
      .single()

    if (saveError) {
      alert(saveError.message)
      setSavingId(null)
      return null
    }

    await supabase.from('market_curation_picks').update({ promoted_review_id: data.id }).eq('id', pick.id)
    setPicks(prev => prev.map(item => item.id === pick.id ? { ...item, promoted_review_id: data.id } : item))
    setReviews(prev => [data, ...prev.filter(review => review.candidate_id !== data.candidate_id)])
    setSavingId(null)
    return data
  }

  async function addRawToQueue(row) {
    setSavingId(row.id)
    const { data, error: saveError } = await supabase
      .from('opportunity_reviews')
      .upsert({
        candidate_id: row.candidate.id,
        source: 'poe',
        status: 'new',
        priority: 'medium',
        signal_type: 'raw_poe_audit',
        signal_tags: ['raw_poe'],
        toniiq_fit_score: null,
        confidence: null,
        rationale: 'Raw POE row added for human review; no LLM strategic score has been assigned.',
        next_action: 'Review this raw market row and decide whether it deserves Phase A research or a future monthly curation pass.',
        source_context: buildRawContext(row),
        reviewed_at: new Date().toISOString(),
      }, { onConflict: 'candidate_id' })
      .select()
      .single()
    if (saveError) alert(saveError.message)
    else {
      setReviews(prev => [data, ...prev.filter(review => review.candidate_id !== data.candidate_id)])
    }
    setSavingId(null)
    return data
  }

  async function queueResearchFromPick(pick) {
    const existingReview = reviews.find(item => item.id === pick.promoted_review_id) || reviews.find(item => item.candidate_id === pick.candidate_id)
    const review = existingReview || await addPickToQueue(pick)
    if (!review || !pick.candidate_id) return
    await queueResearch({ candidateId: pick.candidate_id, name: pick.idea_title, reviewId: review.id, source: 'market_curation_pick' })
  }

  async function queueResearchFromRaw(row) {
    const review = row.review || await addRawToQueue(row)
    if (!review) return
    await queueResearch({ candidateId: row.candidate.id, name: row.candidate.ingredient_name, reviewId: review.id, source: 'raw_poe_audit' })
  }

  async function queueResearch({ candidateId, name, reviewId, source }) {
    const { data: action, error: actionError } = await supabase.from('pending_actions').insert({
      entity_type: 'idea',
      entity_id: candidateId,
      action: 'run_phase_a',
      triggered_by: 'ui',
      context: { ingredient_name: name, source, opportunity_review_id: reviewId },
    }).select('id').single()
    if (actionError) {
      alert(actionError.message)
      return
    }
    const reviewedAt = new Date().toISOString()
    await supabase.from('opportunity_reviews').update({ status: 'queued_research', reviewed_at: reviewedAt }).eq('id', reviewId)
    setReviews(prev => prev.map(item => item.id === reviewId ? { ...item, status: 'queued_research', reviewed_at: reviewedAt } : item))
    supabase.functions.invoke('phase-a-gather', { body: { pending_action_id: action.id } }).catch(error => console.error(error))
    alert(`Research queued for ${name}.`)
  }

  async function dismissPick(pick) {
    const dismissedAt = new Date().toISOString()
    const { error: updateError } = await supabase.from('market_curation_picks').update({ dismissed_at: dismissedAt }).eq('id', pick.id)
    if (updateError) alert(updateError.message)
    else setPicks(prev => prev.map(item => item.id === pick.id ? { ...item, dismissed_at: dismissedAt } : item))
  }

  async function saveFeedback(pick, rating) {
    const notes = feedbackDraft[pick.id] || ''
    const feedbackAt = new Date().toISOString()
    const { error: updateError } = await supabase.from('market_curation_picks').update({
      feedback_rating: rating,
      feedback_notes: notes || null,
      feedback_at: feedbackAt,
    }).eq('id', pick.id)
    if (updateError) alert(updateError.message)
    else setPicks(prev => prev.map(item => item.id === pick.id ? { ...item, feedback_rating: rating, feedback_notes: notes || null, feedback_at: feedbackAt } : item))
  }

  if (loading) return <div className="flex min-h-[60vh] items-center justify-center text-sm" style={{ color: 'var(--text-faint)' }}>Loading market atlas...</div>
  if (error) {
    return (
      <div className="p-6">
        <div className="rounded-md border p-4 text-sm" style={{ borderColor: 'rgba(248,113,113,0.3)', color: 'var(--red-text)', background: 'var(--red-muted)' }}>{error}</div>
      </div>
    )
  }

  const queuedCount = reviews.filter(review => !['dismissed', 'parked'].includes(review.status)).length

  return (
    <div className="min-h-screen">
      <div className="border-b px-6 py-5" style={{ borderColor: 'var(--border-default)', background: 'var(--bg-base)' }}>
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <h1 className="text-2xl font-semibold" style={{ color: 'var(--text-primary)' }}>Market Atlas</h1>
            <p className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>
              Monthly POE data plus stored Claude strategic curation. Latest POE import: {importDate || 'none'}.
            </p>
            <div className="mt-3 flex flex-wrap gap-2 text-xs">
              <MetricPill label={`${rows.length} raw POE rows`} />
              <MetricPill label={`${visiblePicks.length} AI picks`} tone="green" />
              <MetricPill label={`${queuedCount} queued`} tone="blue" />
              {legacyRunCount > 0 && <MetricPill label={`${legacyRunCount} legacy runs retired`} tone="amber" />}
              {selectedRun && <MetricPill label={`Run ${selectedRun.status}`} tone={statusTone(selectedRun.status)} />}
              {selectedRun && <MetricPill label={`Updated ${formatDateTime(selectedRun.completed_at || selectedRun.started_at)}`} />}
            </div>
          </div>
          <div className="flex w-full flex-col gap-2 xl:w-auto xl:min-w-[520px]">
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                value={search}
                onChange={event => setSearch(event.target.value)}
                placeholder="Search AI picks or raw POE rows"
                className="t-input h-10 min-w-0 flex-1 px-3 text-sm"
              />
              <button
                onClick={runMonthlyCuration}
                disabled={running || !importDate || !CURATION_RUN_ENABLED}
                title={!CURATION_RUN_ENABLED ? 'V4 curation is temporarily disabled during calibration.' : undefined}
                className="t-btn h-10 shrink-0"
              >
                {running ? 'Running...' : CURATION_RUN_ENABLED ? 'Run monthly curation' : 'Curation v4 calibrating'}
              </button>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <select value={selectedRunId} onChange={event => setSelectedRunId(event.target.value)} className="t-input h-9 min-w-0 flex-1 px-2 text-xs">
                <option value="">No curation run selected</option>
                {runs.map(run => (
                  <option key={run.id} value={run.id}>{formatDate(run.import_date)} - {run.status} - {run.picks_count} picks</option>
                ))}
              </select>
              {view === 'raw' && (
                <select value={sortBy} onChange={event => setSortBy(event.target.value)} className="t-input h-9 px-2 text-xs">
                  {SORT_OPTIONS.map(option => <option key={option.key} value={option.key}>{option.label}</option>)}
                </select>
              )}
            </div>
          </div>
        </div>

        <div className="mt-5 flex gap-1 overflow-x-auto border-b" style={{ borderColor: 'var(--border-default)' }}>
          {VIEWS.map(item => (
            <button
              key={item.key}
              onClick={() => setView(item.key)}
              className="min-w-max border-b-2 px-4 py-2 text-sm font-medium"
              style={{
                borderBottomColor: view === item.key ? 'var(--text-primary)' : 'transparent',
                color: view === item.key ? 'var(--text-primary)' : 'var(--text-muted)',
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <main className="p-6">
        {view === 'picks' ? (
          <MonthlyPicksView
            picks={visiblePicks}
            selectedRun={selectedRun}
            savingId={savingId}
            feedbackDraft={feedbackDraft}
            setFeedbackDraft={setFeedbackDraft}
            onAdd={addPickToQueue}
            onResearch={queueResearchFromPick}
            onDismiss={dismissPick}
            onFeedback={saveFeedback}
          />
        ) : (
          <RawPoeAuditView
            rows={visibleRows}
            savingId={savingId}
            onAdd={addRawToQueue}
            onResearch={queueResearchFromRaw}
          />
        )}
      </main>
    </div>
  )
}

function MonthlyPicksView({ picks, selectedRun, savingId, feedbackDraft, setFeedbackDraft, onAdd, onResearch, onDismiss, onFeedback }) {
  if (!selectedRun) {
    return (
      <EmptyState
        title="Monthly AI Picks are recalibrating"
        body="The legacy v3 picks have been retired. Keepa Stage A is being calibrated before the next stored shortlist is generated."
      />
    )
  }

  if (selectedRun.status === 'failed') {
    return (
      <div className="rounded-lg border p-5 text-sm" style={{ borderColor: 'rgba(248,113,113,0.3)', background: 'var(--red-muted)', color: 'var(--red-text)' }}>
        Curation failed: {selectedRun.error || 'Unknown error'}
      </div>
    )
  }

  if (picks.length === 0) {
    return (
      <EmptyState
        title={selectedRun.status === 'running' ? 'Curation is running' : 'No active picks in this run'}
        body={selectedRun.status === 'running' ? 'Refresh in a moment; the run will store picks when Claude finishes.' : 'This run has no visible picks, or every pick has been dismissed.'}
      />
    )
  }

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      {picks.map(pick => (
        <PickCard
          key={pick.id}
          pick={pick}
          saving={savingId === pick.id}
          feedbackDraft={feedbackDraft[pick.id] || ''}
          setFeedbackDraft={value => setFeedbackDraft(prev => ({ ...prev, [pick.id]: value }))}
          onAdd={() => onAdd(pick)}
          onResearch={() => onResearch(pick)}
          onDismiss={() => onDismiss(pick)}
          onFeedback={rating => onFeedback(pick, rating)}
        />
      ))}
    </div>
  )
}

function PickCard({ pick, saving, feedbackDraft, setFeedbackDraft, onAdd, onResearch, onDismiss, onFeedback }) {
  const tone = scoreTone(Number(pick.strategic_score || 0))
  const evidence = safeList(pick.evidence_refs)
  const risks = safeList(pick.risks)
  const pillars = pick.pillar_scores || {}

  return (
    <article className="rounded-lg border p-5" style={{ borderColor: 'var(--border-default)', background: 'var(--bg-card)' }}>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded text-sm font-semibold" style={{ background: 'var(--bg-active)', color: 'var(--text-primary)' }}>{pick.rank}</span>
            <span className="rounded border px-2 py-1 text-xs font-medium" style={{ background: tone.bg, color: tone.color, borderColor: tone.border }}>{pick.strategic_score ?? '-'} strategic</span>
            <Badge>{pick.recommendation_label}</Badge>
            {pick.duplicate_status && <Badge>{pick.duplicate_status}</Badge>}
            {pick.promoted_review_id && <Badge tone="green">queued</Badge>}
          </div>
          <h2 className="text-lg font-semibold leading-tight" style={{ color: 'var(--text-primary)' }}>{pick.idea_title}</h2>
          {pick.cluster_name && <p className="mt-1 text-xs" style={{ color: 'var(--text-faint)' }}>{pick.cluster_name}</p>}
        </div>
        <div className="flex shrink-0 flex-wrap gap-1.5">
          <button onClick={onAdd} disabled={saving || Boolean(pick.promoted_review_id)} className="t-btn-ghost px-2.5 py-1 text-[11px]">{pick.promoted_review_id ? 'Queued' : saving ? 'Adding...' : 'Add to queue'}</button>
          <button onClick={onResearch} disabled={saving} className="t-btn-ghost px-2.5 py-1 text-[11px]">Run research</button>
          <button onClick={onDismiss} className="t-btn-ghost px-2.5 py-1 text-[11px]">Dismiss</button>
        </div>
      </div>

      {pick.thesis && <p className="mt-4 text-sm leading-relaxed" style={{ color: 'var(--text-body)' }}>{pick.thesis}</p>}
      {pick.next_action && <Callout label="Next action" value={pick.next_action} />}

      <div className="mt-4 grid gap-2 md:grid-cols-2">
        {Object.entries(pillars).map(([key, value]) => (
          <div key={key} className="rounded-md border p-3" style={{ borderColor: 'var(--border-default)', background: 'var(--bg-base)' }}>
            <div className="flex items-center justify-between gap-2">
              <div className="text-[10px] font-semibold uppercase" style={{ color: 'var(--text-faint)' }}>{key.replace(/_/g, ' ')}</div>
              <div className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>{value?.score ?? '-'}/10</div>
            </div>
            {value?.reason && <p className="mt-1 line-clamp-2 text-xs" style={{ color: 'var(--text-muted)' }}>{value.reason}</p>}
          </div>
        ))}
      </div>

      {evidence.length > 0 && (
        <Section title="Evidence">
          <div className="flex flex-wrap gap-2">
            {evidence.slice(0, 6).map((item, index) => (
              <span key={`${item.label}-${index}`} className="rounded border px-2 py-1 text-xs" style={{ borderColor: 'var(--border-default)', color: 'var(--text-muted)' }}>
                {item.source ? `${item.source}: ` : ''}{item.label}{item.value ? ` ${item.value}` : ''}
              </span>
            ))}
          </div>
        </Section>
      )}

      {risks.length > 0 && (
        <Section title="Risks">
          <ul className="space-y-1 text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>
            {risks.slice(0, 4).map((risk, index) => <li key={`${risk}-${index}`}>{risk}</li>)}
          </ul>
        </Section>
      )}

      <div className="mt-4 border-t pt-3" style={{ borderColor: 'var(--border-subtle)' }}>
        <div className="mb-2 flex flex-wrap gap-1.5">
          {FEEDBACK.map(item => (
            <button key={item.value} onClick={() => onFeedback(item.value)} className="t-btn-ghost px-2 py-1 text-[11px]">
              {pick.feedback_rating === item.value ? `${item.label} saved` : item.label}
            </button>
          ))}
        </div>
        <input
          value={feedbackDraft}
          onChange={event => setFeedbackDraft(event.target.value)}
          placeholder={pick.feedback_notes || 'Optional feedback note'}
          className="t-input h-8 w-full px-2 text-xs"
        />
      </div>
    </article>
  )
}

function RawPoeAuditView({ rows, savingId, onAdd, onResearch }) {
  if (rows.length === 0) return <EmptyState title="No raw rows" body="No POE rows match this search." />

  return (
    <div className="overflow-hidden rounded-lg border" style={{ borderColor: 'var(--border-default)', background: 'var(--bg-card)' }}>
      <div className="divide-y" style={{ borderColor: 'var(--border-subtle)' }}>
        {rows.map(row => (
          <RawRow key={row.id} row={row} saving={savingId === row.id} onAdd={() => onAdd(row)} onResearch={() => onResearch(row)} />
        ))}
      </div>
    </div>
  )
}

function RawRow({ row, saving, onAdd, onResearch }) {
  return (
    <div className="px-4 py-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>{row.snapshot.customer_need}</span>
            <Badge>{row.candidate.stage}</Badge>
            {row.pick && <Badge tone="green">AI pick #{row.pick.rank}</Badge>}
            {row.review && <Badge tone="blue">queue: {row.review.status}</Badge>}
          </div>
          <div className="mt-1 flex flex-wrap gap-2 text-xs" style={{ color: 'var(--text-faint)' }}>
            <span>{row.candidate.ingredient_name}</span>
            <span>{row.candidate.category || 'Uncategorized'}</span>
            <span>{formatNumber(row.snapshot.search_volume_90d)} 90d searches</span>
            <span>{formatGrowth(row.snapshot.search_volume_growth_90d)} 90d</span>
            <span>{formatGrowth(row.snapshot.search_volume_growth_180d)} 180d</span>
            <span>{formatUsd(row.snapshot.avg_price_usd)}</span>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {[row.snapshot.top_search_term_1, row.snapshot.top_search_term_2, row.snapshot.top_search_term_3].filter(Boolean).map(term => (
              <span key={term} className="rounded border px-2 py-0.5 text-[10px]" style={{ borderColor: 'var(--border-default)', color: 'var(--text-muted)' }}>{term}</span>
            ))}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-1.5">
          <Link to={`/discovery/${row.candidate.id}`} className="t-btn-ghost px-2.5 py-1 text-[11px]">Discovery</Link>
          <button onClick={onAdd} disabled={saving || Boolean(row.review)} className="t-btn-ghost px-2.5 py-1 text-[11px]">{row.review ? 'Queued' : saving ? 'Adding...' : 'Add to queue'}</button>
          <button onClick={onResearch} className="t-btn-ghost px-2.5 py-1 text-[11px]">Run research</button>
        </div>
      </div>
    </div>
  )
}

function MetricPill({ label, tone = 'neutral' }) {
  const style = tone === 'green'
    ? { bg: 'var(--green-muted)', color: 'var(--green-text)', border: 'rgba(74,222,128,0.3)' }
    : tone === 'amber'
      ? { bg: 'var(--amber-muted)', color: 'var(--amber-text)', border: 'rgba(251,191,36,0.3)' }
      : tone === 'red'
        ? { bg: 'var(--red-muted)', color: 'var(--red-text)', border: 'rgba(248,113,113,0.3)' }
        : tone === 'blue'
          ? { bg: 'var(--blue-muted)', color: 'var(--blue-text)', border: 'rgba(96,165,250,0.3)' }
          : { bg: 'var(--bg-active)', color: 'var(--text-muted)', border: 'var(--border-default)' }
  return <span className="rounded border px-2 py-1" style={{ background: style.bg, color: style.color, borderColor: style.border }}>{label}</span>
}

function Badge({ children, tone = 'neutral' }) {
  const style = tone === 'green'
    ? { bg: 'var(--green-muted)', color: 'var(--green-text)' }
    : tone === 'blue'
      ? { bg: 'var(--blue-muted)', color: 'var(--blue-text)' }
      : { bg: 'var(--bg-active)', color: 'var(--text-muted)' }
  return <span className="rounded px-1.5 py-0.5 text-[10px] font-medium" style={{ background: style.bg, color: style.color }}>{children}</span>
}

function Section({ title, children }) {
  return <section className="mt-4"><h3 className="mb-2 text-xs font-semibold uppercase" style={{ color: 'var(--text-faint)' }}>{title}</h3>{children}</section>
}

function Callout({ label, value }) {
  return (
    <div className="mt-4 rounded-md border p-3" style={{ borderColor: 'var(--border-default)', background: 'var(--bg-base)' }}>
      <div className="text-[10px] font-semibold uppercase" style={{ color: 'var(--text-faint)' }}>{label}</div>
      <div className="mt-1 text-sm" style={{ color: 'var(--text-body)' }}>{value}</div>
    </div>
  )
}

function EmptyState({ title, body }) {
  return (
    <div className="rounded-lg border px-5 py-16 text-center" style={{ borderColor: 'var(--border-default)', background: 'var(--bg-card)' }}>
      <h2 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>{title}</h2>
      <p className="mx-auto mt-2 max-w-md text-sm" style={{ color: 'var(--text-muted)' }}>{body}</p>
    </div>
  )
}
