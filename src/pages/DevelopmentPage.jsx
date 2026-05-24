import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'

const QUEUES = [
  { key: 'Active Development', label: 'Active', fullLabel: 'Active Development', target: '8-10', cap: 13 },
  { key: 'Greenlight Bench', label: 'Bench', fullLabel: 'Greenlight Bench', target: '<=3', cap: 3 },
  { key: 'Selective Hold', label: 'Hold', fullLabel: 'Selective Hold' },
  { key: 'Shelved / Parked', label: 'Shelved', fullLabel: 'Shelved / Parked' },
  { key: 'Idea Backlog', label: 'Ideas', fullLabel: 'Idea Backlog' },
]

const QUEUE_STYLES = {
  'Active Development': { bg: 'var(--blue-muted)', color: 'var(--blue-text)', border: 'rgba(96,165,250,0.3)' },
  'Greenlight Bench': { bg: 'var(--green-muted)', color: 'var(--green-text)', border: 'rgba(74,222,128,0.3)' },
  'Selective Hold': { bg: 'var(--amber-muted)', color: 'var(--amber-text)', border: 'rgba(251,191,36,0.3)' },
  'Shelved / Parked': { bg: 'var(--bg-active)', color: 'var(--text-muted)', border: 'var(--border-default)' },
  'Idea Backlog': { bg: 'var(--bg-active)', color: 'var(--text-faint)', border: 'var(--border-default)' },
}

const PRIORITY_LABELS = {
  high: 'High',
  medium: 'Med',
  normal: 'Normal',
  parked: 'Parked',
}

const PRIORITY_STYLES = {
  high: { bg: 'var(--red-muted)', color: 'var(--red-text)' },
  medium: { bg: 'var(--amber-muted)', color: 'var(--amber-text)' },
  normal: { bg: 'var(--blue-muted)', color: 'var(--blue-text)' },
  parked: { bg: 'var(--bg-active)', color: 'var(--text-faint)' },
}

const LV_STYLES = {
  'Attack Now': { bg: 'var(--green-muted)', color: 'var(--green-text)' },
  'Needs One Unlock': { bg: 'var(--amber-muted)', color: 'var(--amber-text)' },
  'Selective Hold': { bg: 'var(--blue-muted)', color: 'var(--blue-text)' },
  'Park / Reframe': { bg: 'var(--bg-active)', color: 'var(--text-muted)' },
  'Kill / Backlog': { bg: 'var(--red-muted)', color: 'var(--red-text)' },
}

const EMPTY_DRAFT = {
  queue: 'Active Development',
  state: '',
  priority: 'normal',
  sort_order: 999,
  today_action: '',
  decision_needed: '',
  blocker_risk: '',
  reactivation_trigger: '',
}

function draftFromProduct(product) {
  if (!product) return EMPTY_DRAFT
  return {
    queue: product.queue || 'Active Development',
    state: product.state || '',
    priority: product.priority || 'normal',
    sort_order: product.sort_order ?? 999,
    today_action: product.today_action || '',
    decision_needed: product.decision_needed || '',
    blocker_risk: product.blocker_risk || '',
    reactivation_trigger: product.reactivation_trigger || '',
  }
}

function daysSince(dateValue) {
  if (!dateValue) return null
  const start = new Date(`${dateValue}T00:00:00`)
  if (Number.isNaN(start.getTime())) return null
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  return Math.max(0, Math.floor((today - start) / 86400000))
}

function formatDate(dateValue) {
  if (!dateValue) return 'No date'
  return new Date(`${dateValue}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function textIncludes(product, query) {
  const haystack = [
    product.product,
    product.queue,
    product.state,
    product.priority,
    product.lv_band,
    product.confidence,
    product.today_action,
    product.decision_needed,
    product.blocker_risk,
    product.reactivation_trigger,
  ].filter(Boolean).join(' ').toLowerCase()
  return haystack.includes(query)
}

function buildHandoffPrompt(product) {
  return [
    `Work on ${product.product} from the Toniiq NPD Development Cockpit.`,
    '',
    'Start ritual:',
    '1. Read CLAUDE.md in Product Development.',
    "2. Check pending_actions in Supabase, but do not automatically run unrelated actions.",
    '3. Read this product row from npd_registry_products and the local product folder if one exists.',
    '',
    `Queue: ${product.queue}`,
    `State: ${product.state || 'n/a'}`,
    `Priority: ${PRIORITY_LABELS[product.priority] || product.priority || 'n/a'}`,
    `LV: ${product.lv_score ?? 'n/a'}${product.lv_score_note ? ` [${product.lv_score_note}]` : ''}`,
    `LV band: ${product.lv_band || 'n/a'}`,
    `Confidence: ${product.confidence || 'n/a'}`,
    `Local folder: ${product.local_folder_path || '[none linked yet]'}`,
    `Notion card: ${product.notion_url || '[none linked yet]'}`,
    `GDrive folder: ${product.gdrive_folder_url || '[none linked yet]'}`,
    product.concept_id ? `Concept dashboard: https://toniiq-idea-pipeline.vercel.app/concepts/${product.concept_id}` : 'Concept dashboard: [none linked]',
    '',
    `Current action: ${product.today_action || '[none]'}`,
    `Decision needed: ${product.decision_needed || '[none]'}`,
    `Blocker / risk: ${product.blocker_risk || '[none]'}`,
    `Reactivation trigger: ${product.reactivation_trigger || '[none]'}`,
    '',
    'Data integrity:',
    '- Do not invent Tier 1 numbers.',
    '- Supplier prices must come from Quotation Database, Gmail, or supplier PDFs.',
    '- Keyword, Amazon, TikTok, Reddit, and clinical numbers require real source rows/tool runs.',
    '- If evidence is missing, mark it as pending rather than estimating.',
  ].join('\n')
}

function badgeStyle(map, key, fallback = { bg: 'var(--bg-active)', color: 'var(--text-muted)' }) {
  return map[key] || fallback
}

function isUrl(value) {
  return typeof value === 'string' && /^https?:\/\//.test(value)
}

export default function DevelopmentPage() {
  const [products, setProducts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [activeQueue, setActiveQueue] = useState('Active Development')
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState(null)
  const [draftPatch, setDraftPatch] = useState({})
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)
  const [reordering, setReordering] = useState(false)
  const [draggingId, setDraggingId] = useState(null)
  const [copiedId, setCopiedId] = useState(null)

  useEffect(() => {
    let ignore = false

    async function fetchProducts() {
      const { data, error: loadError } = await supabase
        .from('npd_registry_products')
        .select('*')
        .order('queue')
        .order('sort_order')
        .order('product')

      if (ignore) return

      if (loadError) {
        setError(loadError.message)
        setProducts([])
      } else {
        setProducts(data || [])
      }
      setLoading(false)
    }

    fetchProducts()
    return () => { ignore = true }
  }, [])

  const selected = useMemo(
    () => {
      const direct = products.find(product => product.id === selectedId)
      return direct || products.find(product => product.queue === 'Active Development') || products[0] || null
    },
    [products, selectedId]
  )

  const draft = useMemo(
    () => ({ ...draftFromProduct(selected), ...draftPatch }),
    [selected, draftPatch]
  )

  const setDraft = useCallback((update) => {
    setDraftPatch(prev => {
      const base = draftFromProduct(selected)
      const current = { ...base, ...prev }
      const next = typeof update === 'function' ? update(current) : update
      const patch = {}
      for (const key of Object.keys(base)) {
        if (next[key] !== base[key]) patch[key] = next[key]
      }
      return patch
    })
  }, [selected])

  const counts = useMemo(() => {
    const next = Object.fromEntries(QUEUES.map(queue => [queue.key, 0]))
    for (const product of products) next[product.queue] = (next[product.queue] || 0) + 1
    return next
  }, [products])

  const activeStale = useMemo(
    () => products.filter(product => product.queue === 'Active Development' && daysSince(product.last_updated) >= 14),
    [products]
  )

  const queueProducts = useMemo(() => {
    const query = search.trim().toLowerCase()
    return products
      .filter(product => product.queue === activeQueue)
      .filter(product => !query || textIncludes(product, query))
      .sort((a, b) => (a.sort_order ?? 999) - (b.sort_order ?? 999) || a.product.localeCompare(b.product))
  }, [activeQueue, products, search])

  const allFilteredCount = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) return products.length
    return products.filter(product => textIncludes(product, query)).length
  }, [products, search])

  const activeCount = counts['Active Development'] || 0
  const benchCount = counts['Greenlight Bench'] || 0
  const activeStatus = activeCount > 13 ? 'over-cap' : activeCount > 10 ? 'above-target' : activeCount < 8 ? 'below-target' : 'healthy'
  const benchStatus = benchCount > 3 ? 'over-cap' : 'healthy'
  const reorderDisabled = Boolean(search.trim()) || reordering

  function openProduct(productId) {
    setSelectedId(productId)
    setDraftPatch({})
    setFormError('')
  }

  function requestMove(product, queue) {
    setSelectedId(product.id)
    setDraftPatch({ queue })
    setFormError('')
  }

  async function copyPrompt(product) {
    const prompt = buildHandoffPrompt(product)
    await navigator.clipboard.writeText(prompt)
    setCopiedId(product.id)
    setTimeout(() => setCopiedId(null), 1600)
  }

  async function saveQueueOrder(nextRows) {
    const normalized = nextRows.map((product, index) => ({ ...product, sort_order: index + 1 }))
    setReordering(true)

    const results = await Promise.all(
      normalized.map(product => supabase
        .from('npd_registry_products')
        .update({ sort_order: product.sort_order })
        .eq('id', product.id)
        .select()
        .single()
      )
    )

    const failed = results.find(result => result.error)
    if (failed) {
      alert(failed.error.message)
      setReordering(false)
      return
    }

    const updatedById = new Map(results.map(result => [result.data.id, result.data]))
    setProducts(prev => prev.map(product => updatedById.get(product.id) || product))
    setDraftPatch(prev => {
      if (!selected || !updatedById.has(selected.id) || prev.sort_order === undefined) return prev
      const next = { ...prev }
      delete next.sort_order
      return next
    })
    setReordering(false)
  }

  async function moveProductInQueue(productId, direction) {
    if (search.trim() || reordering) return
    const currentIndex = queueProducts.findIndex(product => product.id === productId)
    const nextIndex = currentIndex + direction
    if (currentIndex < 0 || nextIndex < 0 || nextIndex >= queueProducts.length) return

    const nextRows = [...queueProducts]
    const [moved] = nextRows.splice(currentIndex, 1)
    nextRows.splice(nextIndex, 0, moved)
    await saveQueueOrder(nextRows)
  }

  async function dropProductInQueue(targetId) {
    if (search.trim() || reordering || !draggingId || draggingId === targetId) {
      setDraggingId(null)
      return
    }

    const currentIndex = queueProducts.findIndex(product => product.id === draggingId)
    const nextIndex = queueProducts.findIndex(product => product.id === targetId)
    if (currentIndex < 0 || nextIndex < 0) {
      setDraggingId(null)
      return
    }

    const nextRows = [...queueProducts]
    const [moved] = nextRows.splice(currentIndex, 1)
    nextRows.splice(nextIndex, 0, moved)
    setDraggingId(null)
    await saveQueueOrder(nextRows)
  }

  async function saveDraft() {
    if (!selected) return
    setFormError('')

    const requiresTrigger = draft.queue === 'Selective Hold' || draft.queue === 'Shelved / Parked'
    if (requiresTrigger && !draft.reactivation_trigger.trim()) {
      setFormError('Add a reactivation trigger before moving this product into Hold or Shelved.')
      return
    }

    const activeAfter = products.filter(product => product.queue === 'Active Development' && product.id !== selected.id).length + (draft.queue === 'Active Development' ? 1 : 0)
    if (activeAfter > 13 && !confirm(`Active Development would rise to ${activeAfter}, above the hard cap of 13. Save anyway?`)) return

    setSaving(true)
    const updates = {
      queue: draft.queue,
      state: draft.state.trim(),
      priority: draft.priority,
      sort_order: Number(draft.sort_order) || 999,
      today_action: draft.today_action.trim() || null,
      decision_needed: draft.decision_needed.trim() || null,
      blocker_risk: draft.blocker_risk.trim() || null,
      reactivation_trigger: draft.reactivation_trigger.trim() || null,
    }

    const { data, error: saveError } = await supabase
      .from('npd_registry_products')
      .update(updates)
      .eq('id', selected.id)
      .select()
      .single()

    if (saveError) {
      setFormError(saveError.message)
    } else {
      setProducts(prev => prev.map(product => product.id === selected.id ? data : product))
      setActiveQueue(data.queue)
      setDraftPatch({})
    }
    setSaving(false)
  }

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="text-sm" style={{ color: 'var(--text-faint)' }}>Loading...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-6">
        <div className="rounded-md border p-4 text-sm" style={{ borderColor: 'var(--red)', color: 'var(--red-text)', background: 'var(--red-muted)' }}>
          {error}
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen">
      <div className="border-b" style={{ borderColor: 'var(--border-default)', background: 'var(--bg-base)' }}>
        <div className="px-6 py-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h1 className="text-2xl font-semibold" style={{ color: 'var(--text-primary)' }}>Development Cockpit</h1>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs" style={{ color: 'var(--text-muted)' }}>
                <StatusPill label={`${activeCount} active`} status={activeStatus} detail="target 8-10, cap 13" />
                <StatusPill label={`${benchCount} bench`} status={benchStatus} detail="cap 3" />
                <StatusPill label={`${activeStale.length} stale active`} status={activeStale.length ? 'warning' : 'healthy'} detail="14+ days" />
                <span>{products.length} registry products</span>
              </div>
            </div>

            <div className="flex w-full flex-col gap-2 sm:w-auto sm:min-w-[360px]">
              <input
                value={search}
                onChange={event => setSearch(event.target.value)}
                placeholder="Search products, blockers, actions"
                className="t-input h-10 w-full px-3 text-sm"
              />
              {search && (
                <div className="text-xs" style={{ color: 'var(--text-faint)' }}>
                  {allFilteredCount} match{allFilteredCount !== 1 ? 'es' : ''} across all queues
                </div>
              )}
            </div>
          </div>

          <div className="mt-5 flex gap-1 overflow-x-auto border-b" style={{ borderColor: 'var(--border-default)' }}>
            {QUEUES.map(queue => (
              <button
                key={queue.key}
                onClick={() => setActiveQueue(queue.key)}
                className="min-w-max border-b-2 px-4 py-2 text-sm font-medium"
                style={{
                  borderBottomColor: activeQueue === queue.key ? 'var(--text-primary)' : 'transparent',
                  color: activeQueue === queue.key ? 'var(--text-primary)' : 'var(--text-muted)',
                }}
              >
                {queue.label} <span className="text-xs opacity-70">{counts[queue.key] || 0}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="grid gap-0 xl:grid-cols-[minmax(0,1fr)_480px]">
        <main className="min-w-0 p-6">
          <QueueSummary queue={activeQueue} count={queueProducts.length} search={search} />

          {activeQueue === 'Active Development' && activeStale.length > 0 && (
            <div className="mb-4 rounded-md border px-4 py-3 text-sm" style={{ borderColor: 'rgba(251,191,36,0.3)', background: 'var(--amber-muted)', color: 'var(--amber-text)' }}>
              {activeStale.length} active product{activeStale.length !== 1 ? 's are' : ' is'} 14+ days stale: {activeStale.map(product => product.product).join(', ')}.
            </div>
          )}

          {activeQueue === 'Greenlight Bench' && benchCount > 3 && (
            <div className="mb-4 rounded-md border px-4 py-3 text-sm" style={{ borderColor: 'rgba(251,191,36,0.3)', background: 'var(--amber-muted)', color: 'var(--amber-text)' }}>
              Bench has {benchCount} candidates. The registry guardrail is 3.
            </div>
          )}

          <div className="overflow-hidden rounded-lg border" style={{ borderColor: 'var(--border-default)', background: 'var(--bg-card)' }}>
            {queueProducts.length === 0 ? (
              <div className="px-5 py-16 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
                No products in this queue{search ? ' match the search' : ''}.
              </div>
            ) : (
              <div className="divide-y" style={{ borderColor: 'var(--border-subtle)' }}>
                {queueProducts.map(product => (
                  <ProductRow
                    key={product.id}
                    product={product}
                    selected={product.id === selectedId}
                    dragging={draggingId === product.id}
                    copied={copiedId === product.id}
                    reorderDisabled={reorderDisabled}
                    canMoveUp={queueProducts[0]?.id !== product.id}
                    canMoveDown={queueProducts[queueProducts.length - 1]?.id !== product.id}
                    onOpen={() => openProduct(product.id)}
                    onCopy={() => copyPrompt(product)}
                    onMove={queue => requestMove(product, queue)}
                    onMoveUp={() => moveProductInQueue(product.id, -1)}
                    onMoveDown={() => moveProductInQueue(product.id, 1)}
                    onDragStart={() => !reorderDisabled && setDraggingId(product.id)}
                    onDragEnd={() => setDraggingId(null)}
                    onDragOver={event => {
                      if (!reorderDisabled && draggingId && draggingId !== product.id) event.preventDefault()
                    }}
                    onDrop={() => dropProductInQueue(product.id)}
                  />
                ))}
              </div>
            )}
          </div>
        </main>

        <aside className="border-l xl:sticky xl:top-0 xl:h-screen xl:overflow-y-auto" style={{ borderColor: 'var(--border-default)', background: 'var(--bg-raised)' }}>
          <ProductDrawer
            product={selected}
            draft={draft}
            setDraft={setDraft}
            formError={formError}
            saving={saving}
            onSave={saveDraft}
            onCopy={() => selected && copyPrompt(selected)}
            copied={selected && copiedId === selected.id}
            counts={counts}
            products={products}
          />
        </aside>
      </div>
    </div>
  )
}

function StatusPill({ label, status, detail }) {
  const color = status === 'healthy'
    ? { bg: 'var(--green-muted)', color: 'var(--green-text)', border: 'rgba(74,222,128,0.3)' }
    : status === 'over-cap'
      ? { bg: 'var(--red-muted)', color: 'var(--red-text)', border: 'rgba(248,113,113,0.3)' }
      : { bg: 'var(--amber-muted)', color: 'var(--amber-text)', border: 'rgba(251,191,36,0.3)' }

  return (
    <span className="inline-flex items-center gap-1 rounded border px-2 py-1" style={{ background: color.bg, color: color.color, borderColor: color.border }}>
      <span>{label}</span>
      {detail && <span className="opacity-70">{detail}</span>}
    </span>
  )
}

function QueueSummary({ queue, count, search }) {
  const meta = QUEUES.find(item => item.key === queue)
  return (
    <div className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>{meta?.fullLabel || queue}</h2>
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
          {count} product{count !== 1 ? 's' : ''}{search ? ' in this filtered view' : ''}
        </p>
      </div>
    </div>
  )
}

function ProductRow({
  product,
  selected,
  dragging,
  copied,
  reorderDisabled,
  canMoveUp,
  canMoveDown,
  onOpen,
  onCopy,
  onMove,
  onMoveUp,
  onMoveDown,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
}) {
  const staleDays = daysSince(product.last_updated)
  const isStale = product.queue === 'Active Development' && staleDays >= 14
  const priorityStyle = badgeStyle(PRIORITY_STYLES, product.priority)
  const lvStyle = badgeStyle(LV_STYLES, product.lv_band)
  const queueStyle = badgeStyle(QUEUE_STYLES, product.queue)

  return (
    <div
      draggable={!reorderDisabled}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      onDrop={onDrop}
      className="px-4 py-4 transition-colors"
      style={{
        background: selected ? 'var(--bg-hover)' : 'transparent',
        cursor: reorderDisabled ? 'default' : 'grab',
        opacity: dragging ? 0.55 : 1,
      }}
    >
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <button onClick={onOpen} className="min-w-0 flex-1 text-left">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{product.sort_order}. {product.product}</span>
            <span className="rounded border px-1.5 py-0.5 text-[10px] font-medium" style={{ background: queueStyle.bg, color: queueStyle.color, borderColor: queueStyle.border }}>{product.queue}</span>
            <span className="rounded px-1.5 py-0.5 text-[10px] font-medium" style={{ background: priorityStyle.bg, color: priorityStyle.color }}>{PRIORITY_LABELS[product.priority] || product.priority}</span>
            <span className="rounded px-1.5 py-0.5 text-[10px] font-medium" style={{ background: lvStyle.bg, color: lvStyle.color }}>
              LV {product.lv_score ?? 'n/a'} {product.lv_band}
            </span>
            {isStale && <span className="rounded px-1.5 py-0.5 text-[10px] font-medium" style={{ background: 'var(--amber-muted)', color: 'var(--amber-text)' }}>{staleDays}d stale</span>}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs" style={{ color: 'var(--text-faint)' }}>
            <span>{product.state || 'No state'}</span>
            <span>Last {formatDate(product.last_updated)}</span>
            <span>{product.confidence || 'No'} confidence</span>
          </div>
        </button>

        <div className="flex shrink-0 flex-wrap gap-1.5">
          <div className="flex gap-1">
            <button
              onClick={onMoveUp}
              disabled={reorderDisabled || !canMoveUp}
              title={reorderDisabled ? 'Clear search to reorder' : 'Move up'}
              className="t-btn-ghost flex h-7 w-7 items-center justify-center p-0 text-xs"
            >
              ↑
            </button>
            <button
              onClick={onMoveDown}
              disabled={reorderDisabled || !canMoveDown}
              title={reorderDisabled ? 'Clear search to reorder' : 'Move down'}
              className="t-btn-ghost flex h-7 w-7 items-center justify-center p-0 text-xs"
            >
              ↓
            </button>
          </div>
          <button onClick={onOpen} className="t-btn-ghost px-2.5 py-1 text-[11px]">Open</button>
          <ExternalRowLink href={product.notion_url} label="Notion" />
          <ExternalRowLink href={product.gdrive_folder_url} label="Drive" />
          <QueueMoveButton currentQueue={product.queue} onMove={onMove} />
          <button onClick={onCopy} className="t-btn-ghost px-2.5 py-1 text-[11px]">{copied ? 'Copied' : 'Work on this'}</button>
        </div>
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-3">
        <FieldPreview label="Unlock" value={product.today_action} />
        <FieldPreview label="Decision" value={product.decision_needed} />
        <FieldPreview label="Blocker" value={product.blocker_risk} />
      </div>
    </div>
  )
}

function ExternalRowLink({ href, label }) {
  if (!isUrl(href)) return null
  return (
    <a href={href} target="_blank" rel="noreferrer" className="t-btn-ghost px-2.5 py-1 text-[11px]">
      {label}
    </a>
  )
}

function QueueMoveButton({ currentQueue, onMove }) {
  const [open, setOpen] = useState(false)

  return (
    <div className="relative">
      <button onClick={() => setOpen(value => !value)} className="t-btn-ghost px-2.5 py-1 text-[11px]">Move</button>
      {open && (
        <div className="absolute right-0 z-20 mt-1 w-44 rounded-md border p-1 shadow-lg" style={{ borderColor: 'var(--border-default)', background: 'var(--bg-card)' }}>
          {QUEUES.filter(queue => queue.key !== currentQueue).map(queue => (
            <button
              key={queue.key}
              onClick={() => { onMove(queue.key); setOpen(false) }}
              className="block w-full rounded px-2 py-1.5 text-left text-xs hover:bg-[var(--bg-hover)]"
              style={{ color: 'var(--text-muted)' }}
            >
              {queue.fullLabel}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function FieldPreview({ label, value }) {
  return (
    <div className="min-w-0">
      <div className="mb-1 text-[10px] font-semibold uppercase" style={{ color: 'var(--text-faint)' }}>{label}</div>
      <div className="line-clamp-2 text-xs" style={{ color: value ? 'var(--text-muted)' : 'var(--text-faint)' }}>{value || 'None'}</div>
    </div>
  )
}

function ProductDrawer({ product, draft, setDraft, formError, saving, onSave, onCopy, copied, counts, products }) {
  if (!product) {
    return (
      <div className="p-6 text-sm" style={{ color: 'var(--text-muted)' }}>
        Select a product.
      </div>
    )
  }

  const prompt = buildHandoffPrompt(product)
  const activeAfter = products.filter(item => item.queue === 'Active Development' && item.id !== product.id).length + (draft.queue === 'Active Development' ? 1 : 0)
  const benchAfter = products.filter(item => item.queue === 'Greenlight Bench' && item.id !== product.id).length + (draft.queue === 'Greenlight Bench' ? 1 : 0)
  const requiresTrigger = draft.queue === 'Selective Hold' || draft.queue === 'Shelved / Parked'

  return (
    <div className="p-5">
      <div className="mb-5">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <span className="rounded border px-2 py-1 text-xs font-medium" style={{ background: QUEUE_STYLES[product.queue]?.bg, color: QUEUE_STYLES[product.queue]?.color, borderColor: QUEUE_STYLES[product.queue]?.border }}>
            {product.queue}
          </span>
          <span className="text-xs" style={{ color: 'var(--text-faint)' }}>Last {formatDate(product.last_updated)}</span>
        </div>
        <h2 className="text-xl font-semibold leading-tight" style={{ color: 'var(--text-primary)' }}>{product.product}</h2>
        <div className="mt-2 flex flex-wrap gap-2 text-xs" style={{ color: 'var(--text-muted)' }}>
          <span>{product.state}</span>
          <span>LV {product.lv_score ?? 'n/a'}{product.lv_score_note ? ` [${product.lv_score_note}]` : ''}</span>
          <span>{product.lv_band}</span>
          <span>{product.confidence} confidence</span>
        </div>
      </div>

      <DrawerSection title="Overview">
        <div className="grid gap-3 sm:grid-cols-2">
          <ReadOnlyItem label="Folder" value={product.local_folder_path || 'None linked'} />
          <ReadOnlyItem label="Notion card" value={product.notion_url ? 'Open Notion card' : 'None linked'} link={product.notion_url} external />
          <ReadOnlyItem label="GDrive folder" value={product.gdrive_folder_url ? 'Open Drive folder' : 'None linked'} link={product.gdrive_folder_url} external />
          <ReadOnlyItem label="Concept" value={product.concept_id || 'None linked'} link={product.concept_id ? `/concepts/${product.concept_id}` : null} />
          <ReadOnlyItem label="Registry anchor" value={product.registry_anchor || 'None'} />
          <ReadOnlyItem label="Updated" value={formatDate(product.last_updated)} />
        </div>
      </DrawerSection>

      <DrawerSection title="Action Plan">
        <EditorGrid>
          <SelectField label="Queue" value={draft.queue} onChange={value => setDraft(prev => ({ ...prev, queue: value }))} options={QUEUES.map(queue => queue.key)} />
          <InputField label="Rank" type="number" value={draft.sort_order} onChange={value => setDraft(prev => ({ ...prev, sort_order: value }))} />
          <InputField label="State" value={draft.state} onChange={value => setDraft(prev => ({ ...prev, state: value }))} />
          <SelectField label="Priority" value={draft.priority} onChange={value => setDraft(prev => ({ ...prev, priority: value }))} options={Object.keys(PRIORITY_LABELS)} getLabel={value => PRIORITY_LABELS[value]} />
        </EditorGrid>

        <TextAreaField label="Current unlock / next action" value={draft.today_action} onChange={value => setDraft(prev => ({ ...prev, today_action: value }))} rows={3} />
        <TextAreaField label="Decision needed" value={draft.decision_needed} onChange={value => setDraft(prev => ({ ...prev, decision_needed: value }))} rows={2} />
        <TextAreaField label="Blocker / risk" value={draft.blocker_risk} onChange={value => setDraft(prev => ({ ...prev, blocker_risk: value }))} rows={2} />
        <TextAreaField label={requiresTrigger ? 'Reactivation trigger required' : 'Reactivation trigger'} value={draft.reactivation_trigger} onChange={value => setDraft(prev => ({ ...prev, reactivation_trigger: value }))} rows={2} />

        {activeAfter > 13 && (
          <InlineWarning tone="red">Active Development would be {activeAfter}, above the hard cap of 13.</InlineWarning>
        )}
        {activeAfter > 10 && activeAfter <= 13 && (
          <InlineWarning>Active Development would be {activeAfter}, above the target range of 8-10.</InlineWarning>
        )}
        {benchAfter > 3 && (
          <InlineWarning>Greenlight Bench would be {benchAfter}; registry guardrail is 3.</InlineWarning>
        )}
        {counts['Active Development'] < 8 && draft.queue !== 'Active Development' && (
          <InlineWarning>Active Development is below the target range of 8-10.</InlineWarning>
        )}
        {formError && <InlineWarning tone="red">{formError}</InlineWarning>}

        <div className="mt-3 flex justify-end">
          <button onClick={onSave} disabled={saving} className="t-btn">
            {saving ? 'Saving...' : 'Save changes'}
          </button>
        </div>
      </DrawerSection>

      <DrawerSection title="Decision / Blocker">
        <ReadOnlyBlock label="Decision" value={product.decision_needed} />
        <ReadOnlyBlock label="Blocker" value={product.blocker_risk} />
        <ReadOnlyBlock label="Trigger" value={product.reactivation_trigger} />
      </DrawerSection>

      <DrawerSection title="Evidence & Links">
        <div className="flex flex-wrap gap-2">
          {isUrl(product.notion_url) && <LinkButton to={product.notion_url} label="Notion card" external />}
          {isUrl(product.gdrive_folder_url) && <LinkButton to={product.gdrive_folder_url} label="GDrive folder" external />}
          {product.concept_id && <LinkButton to={`/concepts/${product.concept_id}`} label="Concept page" />}
          {product.registry_anchor && <LinkButton to={`https://toniiq-idea-pipeline.vercel.app/development`} label={product.registry_anchor} external />}
          <span className="rounded border px-2.5 py-1 text-xs" style={{ borderColor: 'var(--border-default)', color: 'var(--text-faint)' }}>
            Scores read-only in v1
          </span>
        </div>
      </DrawerSection>

      <DrawerSection title="Registry Card">
        <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-md border p-3 text-xs" style={{ borderColor: 'var(--border-default)', color: 'var(--text-muted)', background: 'var(--bg-base)' }}>
          {product.detail_markdown || 'No card detail synced yet.'}
        </pre>
      </DrawerSection>

      <DrawerSection title="Handoff">
        <textarea
          readOnly
          value={prompt}
          className="t-input min-h-56 w-full resize-y p-3 text-xs leading-relaxed"
        />
        <div className="mt-3 flex justify-end">
          <button onClick={onCopy} className="t-btn-ghost">{copied ? 'Copied' : 'Copy handoff prompt'}</button>
        </div>
      </DrawerSection>
    </div>
  )
}

function DrawerSection({ title, children }) {
  return (
    <section className="mb-5">
      <h3 className="mb-2 text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{title}</h3>
      <div>{children}</div>
    </section>
  )
}

function EditorGrid({ children }) {
  return <div className="mb-3 grid gap-3 sm:grid-cols-2">{children}</div>
}

function InputField({ label, value, onChange, type = 'text' }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium" style={{ color: 'var(--text-muted)' }}>{label}</span>
      <input type={type} value={value} onChange={event => onChange(event.target.value)} className="t-input h-9 w-full px-2 text-sm" />
    </label>
  )
}

function SelectField({ label, value, onChange, options, getLabel = value => value }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium" style={{ color: 'var(--text-muted)' }}>{label}</span>
      <select value={value} onChange={event => onChange(event.target.value)} className="t-input h-9 w-full px-2 text-sm">
        {options.map(option => <option key={option} value={option}>{getLabel(option)}</option>)}
      </select>
    </label>
  )
}

function TextAreaField({ label, value, onChange, rows }) {
  return (
    <label className="mb-3 block">
      <span className="mb-1 block text-xs font-medium" style={{ color: 'var(--text-muted)' }}>{label}</span>
      <textarea value={value} onChange={event => onChange(event.target.value)} rows={rows} className="t-input w-full resize-y p-2 text-sm leading-relaxed" />
    </label>
  )
}

function InlineWarning({ children, tone = 'amber' }) {
  const styles = tone === 'red'
    ? { bg: 'var(--red-muted)', color: 'var(--red-text)', border: 'rgba(248,113,113,0.3)' }
    : { bg: 'var(--amber-muted)', color: 'var(--amber-text)', border: 'rgba(251,191,36,0.3)' }

  return (
    <div className="mt-2 rounded border px-3 py-2 text-xs" style={{ background: styles.bg, color: styles.color, borderColor: styles.border }}>
      {children}
    </div>
  )
}

function ReadOnlyItem({ label, value, link, external = false }) {
  return (
    <div className="min-w-0">
      <div className="mb-1 text-[10px] font-semibold uppercase" style={{ color: 'var(--text-faint)' }}>{label}</div>
      {link && external ? (
        <a href={link} target="_blank" rel="noreferrer" className="break-all text-xs hover:underline" style={{ color: 'var(--blue-text)' }}>{value}</a>
      ) : link ? (
        <Link to={link} className="break-all text-xs hover:underline" style={{ color: 'var(--blue-text)' }}>{value}</Link>
      ) : (
        <div className="break-words text-xs" style={{ color: 'var(--text-muted)' }}>{value}</div>
      )}
    </div>
  )
}

function ReadOnlyBlock({ label, value }) {
  return (
    <div className="mb-3">
      <div className="mb-1 text-[10px] font-semibold uppercase" style={{ color: 'var(--text-faint)' }}>{label}</div>
      <div className="rounded-md border p-3 text-xs leading-relaxed" style={{ borderColor: 'var(--border-default)', color: value ? 'var(--text-muted)' : 'var(--text-faint)', background: 'var(--bg-card)' }}>
        {value || 'None'}
      </div>
    </div>
  )
}

function LinkButton({ to, label, external = false }) {
  if (external) {
    return (
      <a href={to} target="_blank" rel="noreferrer" className="rounded border px-2.5 py-1 text-xs" style={{ borderColor: 'var(--border-default)', color: 'var(--text-muted)' }}>
        {label}
      </a>
    )
  }

  return (
    <Link to={to} className="rounded border px-2.5 py-1 text-xs" style={{ borderColor: 'var(--border-default)', color: 'var(--blue-text)' }}>
      {label}
    </Link>
  )
}
