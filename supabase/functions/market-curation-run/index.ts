/**
 * market-curation-run — monthly strategic curation over the latest POE import.
 *
 * This is intentionally not Phase B. It uses POE + Datarova + pipeline state to
 * ask Claude for a source-locked strategic shortlist. No fresh Amazon/TikTok/
 * Reddit/Google Trends research is run here.
 */

import { corsHeaders } from '../_shared/cors.ts'
import {
  anthropicCall,
  extractJson,
  extractText,
  OPUS,
  SONNET,
  svcClient,
} from '../_shared/clients.ts'

const PROMPT_VERSION = 'market-curation-v3'
// Sized to fit Supabase's hard 150s Edge Function wall clock.
// Observed per-call latency on Sonnet 4.5:
//   - Chunk pass (70 rows in, ~10 picks out, ≤1K output): ~19s
//   - Final pass (10 picks out, ~2.5K output): ~55-70s
// Budget: 2 chunks × 19s + final ~65s = ~103s. Leaves margin for network/db.
const FINAL_MODEL = SONNET
const CHUNK_MODEL = SONNET
const CHUNK_SIZE = 70
const FINAL_PICK_COUNT = 8
const MAX_ROWS_TO_SCORE = 140

const NOISE_PATTERNS = [
  'ryze', 'mary ruth', 'ritual', 'garden of life', 'nature made', 'olly',
  'smarty pants', 'centrum', 'thorne', 'pure encapsulations', 'sports research',
  'nutricost', 'now foods', 'force factor', 'leefar', 'nuora', 'alpha fuel',
  'calm drink', 'elare', 'kos', 'barebells', 'viagra', 'dildo', 'vibrator',
  'sex toy', 'sex toys', 'lube', 'for dogs', 'for cats', 'pet', 'kids vitamins',
  'massager', 'machine', 'device', 'tool', 'roller', 'patch', 'patches',
  'protein bar', 'protein bars',
]

const GENERIC_EXACT = new Set([
  'vitamins', 'supplements', 'weight loss', 'sleep aid', 'energy', 'detox',
  'cleanse', 'diet', 'protein', 'probiotic', 'probiotics', 'multivitamin',
  'gummy', 'gummies',
])

function normalize(value: string) {
  return String(value || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\b(supplements?|capsules?|powders?|gumm(y|ies)|tablets?|softgels?|liquid|organic|pure|natural|extra strength|maximum strength)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function n(value: unknown, fallback = 0) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function shouldFilter(row: MarketRow) {
  const text = [
    row.customer_need,
    row.ingredient_name,
    row.top_search_term_1,
    row.top_search_term_2,
    row.top_search_term_3,
  ].filter(Boolean).join(' ').toLowerCase()
  const candidate = normalize(row.ingredient_name || row.customer_need)
  if (GENERIC_EXACT.has(candidate)) return true
  return NOISE_PATTERNS.some(pattern => text.includes(pattern))
}

function compactNumber(value: unknown) {
  const parsed = n(value)
  if (!parsed) return null
  return Math.round(parsed)
}

async function loadAnthropicKey(sb: any) {
  const { data, error } = await sb
    .from('system_config')
    .select('value')
    .eq('key', 'anthropic_api_key')
    .single()
  if (error || !data?.value) throw new Error(`anthropic_api_key not in system_config: ${error?.message || 'missing value'}`)
  return data.value as string
}

interface MarketRow {
  id: string
  candidate_id: string
  customer_need: string
  ingredient_name: string
  category: string | null
  stage: string
  top_search_term_1: string | null
  top_search_term_2: string | null
  top_search_term_3: string | null
  search_volume_90d: number | null
  search_volume_growth_90d: number | null
  search_volume_growth_180d: number | null
  search_volume_360d: number | null
  top_clicked_products: number | null
  avg_price_usd: number | null
  return_rate: number | null
  flagged_high_opportunity: boolean | null
  dr_search_volume?: number | null
  dr_growth?: number | null
  dr_conversion?: number | null
  dr_avg_price?: number | null
  prior_pick_count?: number
  feedback?: string[]
  registry_match?: string | null
}

function buildMarketRows(poeRows: any[], candidates: any[], datarovaRows: any[], priorPicks: any[], registryRows: any[]) {
  const candidateMap = new Map(candidates.map(row => [row.id, row]))
  const drByCandidate = new Map<string, any>()
  for (const row of datarovaRows) {
    if (!row.candidate_id) continue
    const current = drByCandidate.get(row.candidate_id)
    if (!current || row.import_date > current.import_date) drByCandidate.set(row.candidate_id, row)
  }

  const priorByCandidate = new Map<string, any[]>()
  for (const pick of priorPicks) {
    if (!priorByCandidate.has(pick.candidate_id)) priorByCandidate.set(pick.candidate_id, [])
    priorByCandidate.get(pick.candidate_id)!.push(pick)
  }

  const registryNames = registryRows.map(row => ({ product: row.product, normalized: normalize(row.product) }))

  return poeRows
    .map(row => {
      const candidate = candidateMap.get(row.candidate_id)
      if (!candidate) return null
      const dr = drByCandidate.get(row.candidate_id) || {}
      const candidateText = normalize(candidate.ingredient_name)
      const registryMatch = registryNames.find(item => candidateText && (item.normalized.includes(candidateText) || candidateText.includes(item.normalized)))
      const prior = priorByCandidate.get(row.candidate_id) || []
      return {
        id: row.id,
        candidate_id: row.candidate_id,
        customer_need: row.customer_need,
        ingredient_name: candidate.ingredient_name,
        category: candidate.category,
        stage: candidate.stage,
        top_search_term_1: row.top_search_term_1,
        top_search_term_2: row.top_search_term_2,
        top_search_term_3: row.top_search_term_3,
        search_volume_90d: compactNumber(row.search_volume_90d),
        search_volume_growth_90d: row.search_volume_growth_90d === null ? null : n(row.search_volume_growth_90d),
        search_volume_growth_180d: row.search_volume_growth_180d === null ? null : n(row.search_volume_growth_180d),
        search_volume_360d: compactNumber(row.search_volume_360d),
        top_clicked_products: compactNumber(row.top_clicked_products),
        avg_price_usd: row.avg_price_usd === null ? null : n(row.avg_price_usd),
        return_rate: row.return_rate === null ? null : n(row.return_rate),
        flagged_high_opportunity: row.flagged_high_opportunity,
        dr_search_volume: compactNumber(dr.search_volume),
        dr_growth: dr.search_volume_trend === null ? null : n(dr.search_volume_trend),
        dr_conversion: dr.conversion_rate === null ? null : n(dr.conversion_rate),
        dr_avg_price: dr.avg_price === null ? null : n(dr.avg_price),
        prior_pick_count: prior.length,
        feedback: prior.map(item => item.feedback_rating).filter(Boolean),
        registry_match: registryMatch?.product || null,
      } satisfies MarketRow
    })
    .filter(Boolean)
    .filter(row => !shouldFilter(row as MarketRow)) as MarketRow[]
}

function chunk<T>(items: T[], size: number) {
  const chunks: T[][] = []
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size))
  return chunks
}

function toLlmRow(row: MarketRow) {
  return {
    candidate_id: row.candidate_id,
    name: row.ingredient_name,
    customer_need: row.customer_need,
    category: row.category,
    stage: row.stage,
    terms: [row.top_search_term_1, row.top_search_term_2, row.top_search_term_3].filter(Boolean),
    poe: {
      volume_90d: row.search_volume_90d,
      growth_90d: row.search_volume_growth_90d,
      growth_180d: row.search_volume_growth_180d,
      volume_360d: row.search_volume_360d,
      top_clicked_products: row.top_clicked_products,
      avg_price: row.avg_price_usd,
      return_rate: row.return_rate,
      flagged_high_opportunity: row.flagged_high_opportunity,
    },
    datarova: {
      volume: row.dr_search_volume,
      growth: row.dr_growth,
      conversion: row.dr_conversion,
      avg_price: row.dr_avg_price,
    },
    pipeline: {
      prior_pick_count: row.prior_pick_count,
      feedback: row.feedback,
      registry_match: row.registry_match,
    },
  }
}

function curationSystemPrompt() {
  return `You are Toniiq's monthly supplement opportunity curator.

Goal: find genuinely strong new product opportunities from Amazon Product Opportunity Explorer + Datarova data.

Use the Phase B philosophy, adapted upstream:
- Market Size & Intent (20%): POE volume, Datarova volume, conversion, price range.
- Early Market Access (25%): proxy for whether Toniiq can enter before review moats harden, using top-clicked concentration, conversion, competition hints, and market specificity.
- Growth & Timing (20%): POE 90d/180d growth plus Datarova trend confirmation.
- Toniiq Differentiation Hypothesis (35%): hypothesize whether Toniiq can win through potency, branded ingredient, purity/standardization, multi-pathway stack, strain specificity, or bioavailability/delivery.

Important:
- This is NOT Phase B. Do not invent Amazon revenue/review counts, TikTok stats, clinical claims, or supplier prices.
- Evidence must point only to supplied POE, Datarova, pipeline, or registry fields.
- Prefer specific product theses over broad root categories.
- Penalize brand-only searches, non-supplement noise, duplicated prior work, and ideas already in development unless there is a genuinely new angle.
- Do not choose ideas just because a keyword is in a hardcoded list. Make a strategic argument.
- Return strict JSON only.`
}

async function runChunkPass(apiKey: string, rows: MarketRow[], chunkIndex: number) {
  const response = await anthropicCall(apiKey, {
    model: CHUNK_MODEL,
    // v8 instrumented run hit max_tokens=2000 cleanly — Sonnet wanted more for
    // 6-8 picks × ~250 tokens. 3500 fits 8 picks comfortably. At observed ~67
    // tok/sec that's ≤55s per chunk.
    max_tokens: 3500,
    temperature: 0.2,
    system: curationSystemPrompt(),
    messages: [{
      role: 'user',
      content: `Review this chunk of monthly market rows and shortlist the best 6-10 candidates for final review.

This is TRIAGE, not final analysis. Keep reasoning terse — full evidence and rationale are written in the final pass. Each "reason" field MUST be ≤15 words. "thesis" ≤20 words. Skip evidence_refs in this pass.

Return STRICT JSON only (no prose, no code fences):
{
  "shortlist": [
    {
      "candidate_id": "uuid",
      "idea_title": "specific Toniiq product opportunity (≤8 words)",
      "strategic_score": 0-100,
      "recommendation_label": "launch_priority|strong_candidate|watchlist|pass",
      "pillar_scores": {
        "market_size_intent": {"score": 0-10, "reason": "≤15 words"},
        "early_market_access": {"score": 0-10, "reason": "≤15 words"},
        "growth_timing": {"score": 0-10, "reason": "≤15 words"},
        "differentiation_hypothesis": {"score": 0-10, "reason": "≤15 words"}
      },
      "thesis": "≤20 words",
      "risks": ["≤1 risk, ≤10 words"],
      "duplicate_status": "new|prior_pick|in_research|in_evaluation|in_development|registry_overlap",
      "needs_phase_a": true
    }
  ]
}

Chunk ${chunkIndex + 1}. Rows:
${JSON.stringify(rows.map(toLlmRow))}`,
    }],
  })
  return { parsed: extractJson<any>(extractText(response)), usage: response.usage || {} }
}

async function runFinalPass(apiKey: string, finalists: any[], count: number) {
  const response = await anthropicCall(apiKey, {
    model: FINAL_MODEL,
    // v9 hit max_tokens=4000 cleanly in ~45s — Sonnet wanted more for 8 picks.
    // Bumping to 6000: at observed ~67 tok/sec that's ~90s wall, leaving ~50s
    // for parallel chunks (~40s) + setup + db (~10s) = 140s, fits 150s cap.
    max_tokens: 6000,
    temperature: 0.15,
    system: curationSystemPrompt(),
    messages: [{
      role: 'user',
      content: `Select the final ranked top ${count} Toniiq opportunities from these chunk-level finalists.

Be selective. Remove duplicates. Prefer ideas with a clear product thesis and defensible Toniiq angle.
Keep already-in-development ideas only if the market signal suggests a materially new angle.

CONCISE OUTPUT REQUIRED: each pillar "reason" ≤20 words. "thesis" ≤30 words.
"evidence_refs" max 3 items with brief label/value. "risks" max 2 items, ≤15 words each.
"next_action" ≤20 words.

Return STRICT JSON only (no prose, no code fences):
{
  "summary": "1-3 sentence monthly readout",
  "picks": [
    {
      "candidate_id": "uuid",
      "cluster_key": "short-normalized-key",
      "cluster_name": "human cluster name",
      "idea_title": "specific product idea",
      "rank": 1,
      "recommendation_label": "launch_priority|strong_candidate|watchlist|pass",
      "strategic_score": 0-100,
      "pillar_scores": {
        "market_size_intent": {"score": 0-10, "weight": 0.20, "reason": "≤20 words"},
        "early_market_access": {"score": 0-10, "weight": 0.25, "reason": "≤20 words"},
        "growth_timing": {"score": 0-10, "weight": 0.20, "reason": "≤20 words"},
        "differentiation_hypothesis": {"score": 0-10, "weight": 0.35, "reason": "≤20 words"}
      },
      "thesis": "≤30 words, source-grounded",
      "evidence_refs": [{"source": "poe|datarova|pipeline|registry", "label": "...", "value": "..."}],
      "risks": ["≤15 words"],
      "duplicate_status": "new|prior_pick|in_research|in_evaluation|in_development|registry_overlap",
      "status_flags": {"already_known": false, "needs_phase_a": true},
      "next_action": "≤20 words"
    }
  ]
}

Finalists:
${JSON.stringify(finalists)}`,
    }],
  })
  return { parsed: extractJson<any>(extractText(response)), usage: response.usage || {} }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const sb = svcClient()
  let runId: string | null = null

  try {
    const body = await req.json().catch(() => ({}))
    const requestedImportDate = body.import_date
    const count = Math.max(10, Math.min(20, Number(body.count || FINAL_PICK_COUNT)))
    const anthropicApiKey = await loadAnthropicKey(sb)

    let importDate = requestedImportDate
    if (!importDate) {
      const { data, error } = await sb.from('poe_snapshots').select('import_date').order('import_date', { ascending: false }).limit(1).single()
      if (error || !data) throw new Error(`No POE import found: ${error?.message || 'empty table'}`)
      importDate = data.import_date
    }

    const { data: run, error: runError } = await sb.from('market_curation_runs').insert({
      import_date: importDate,
      status: 'running',
      model: FINAL_MODEL,
      prompt_version: PROMPT_VERSION,
      started_at: new Date().toISOString(),
    }).select('*').single()
    if (runError || !run) throw new Error(`Could not create curation run: ${runError?.message}`)
    runId = run.id

    const [poeRes, candidatesRes, datarovaRes, picksRes, registryRes] = await Promise.all([
      sb.from('poe_snapshots').select('*').eq('import_date', importDate).order('search_volume_90d', { ascending: false }),
      sb.from('idea_candidates').select('id, ingredient_name, ingredient_name_normalized, category, stage, notes, shelved_at, shelved_reason'),
      sb.from('datarova_snapshots').select('*').order('import_date', { ascending: false }),
      sb.from('claude_weekly_picks').select('candidate_id, feedback_rating, feedback_notes, week_date, rank'),
      sb.from('npd_registry_products').select('product, queue, state, priority, lv_band'),
    ])

    const loadError = poeRes.error || candidatesRes.error || datarovaRes.error || picksRes.error || registryRes.error
    if (loadError) throw new Error(`Could not load market context: ${loadError.message}`)

    const allMarketRows = buildMarketRows(
      poeRes.data || [],
      candidatesRes.data || [],
      datarovaRes.data || [],
      picksRes.data || [],
      registryRes.data || []
    )
    // Cap to top-N by POE volume (already sorted by the SQL query). Reduces
    // LLM token spend and keeps us under Supabase + Anthropic limits.
    const marketRows = allMarketRows.slice(0, MAX_ROWS_TO_SCORE)

    const chunks = chunk(marketRows, CHUNK_SIZE)
    const usage = { chunk: [] as any[], final: null as any }
    const t0 = Date.now()
    console.log(`[curate] data_loaded rows=${marketRows.length} chunks=${chunks.length} t=${Date.now()-t0}ms`)

    // Parallel chunks. With ≤2 chunks × ~10K input tokens each = ≤20K total
    // input, well under Anthropic's 30K input-tokens/min Sonnet limit. Saves
    // ~25-40s vs sequential, critical for fitting Supabase's 150s wall clock.
    const tcAll = Date.now()
    const chunkOutcomes = await Promise.all(
      chunks.map((c, i) => runChunkPass(anthropicApiKey, c, i).then(r => ({ ...r, index: i })))
    )
    const chunkResults: any[] = []
    for (const result of chunkOutcomes) {
      console.log(`[curate] chunk ${result.index+1} shortlist=${result.parsed.shortlist?.length || 0}`)
      usage.chunk.push(result.usage)
      chunkResults.push(...(result.parsed.shortlist || []).map((item: any) => ({ ...item, chunk_index: result.index })))
    }

    const tf = Date.now()
    console.log(`[curate] chunks_total=${tf-tcAll}ms finalists=${chunkResults.length}, starting final pass`)
    const final = await runFinalPass(anthropicApiKey, chunkResults, count)
    console.log(`[curate] final_pass done in ${Date.now()-tf}ms picks=${final.parsed.picks?.length || 0}`)
    usage.final = final.usage
    const validCandidateIds = new Set(marketRows.map(row => row.candidate_id))
    const picks = (final.parsed.picks || [])
      .filter((pick: any) => validCandidateIds.has(pick.candidate_id))
      .slice(0, count)

    const rows = picks.map((pick: any, index: number) => ({
      run_id: runId,
      candidate_id: pick.candidate_id || null,
      cluster_key: pick.cluster_key || normalize(pick.idea_title || pick.cluster_name || `pick-${index + 1}`),
      cluster_name: pick.cluster_name || pick.idea_title,
      idea_title: pick.idea_title || pick.cluster_name || `Pick ${index + 1}`,
      rank: Number(pick.rank || index + 1),
      recommendation_label: pick.recommendation_label || 'watchlist',
      strategic_score: pick.strategic_score === null || pick.strategic_score === undefined ? null : Math.round(Number(pick.strategic_score)),
      pillar_scores: pick.pillar_scores || {},
      thesis: pick.thesis || null,
      evidence_refs: Array.isArray(pick.evidence_refs) ? pick.evidence_refs : [],
      risks: Array.isArray(pick.risks) ? pick.risks : [],
      duplicate_status: pick.duplicate_status || null,
      status_flags: pick.status_flags || {},
      next_action: pick.next_action || null,
    }))

    if (rows.length) {
      const { error: insertError } = await sb.from('market_curation_picks').insert(rows)
      if (insertError) throw new Error(`Could not insert picks: ${insertError.message}`)
    }

    await sb.from('market_curation_runs').update({
      status: 'completed',
      total_rows: (poeRes.data || []).length,
      candidate_rows: marketRows.length,
      clusters_considered: marketRows.length,
      picks_count: rows.length,
      token_usage: usage,
      summary: final.parsed.summary || null,
      completed_at: new Date().toISOString(),
    }).eq('id', runId)

    return new Response(JSON.stringify({
      ok: true,
      run_id: runId,
      import_date: importDate,
      picks_count: rows.length,
      summary: final.parsed.summary || null,
    }), { headers: { 'Content-Type': 'application/json', ...corsHeaders } })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (runId) {
      await sb.from('market_curation_runs').update({
        status: 'failed',
        error: message,
        completed_at: new Date().toISOString(),
      }).eq('id', runId)
    }
    return new Response(JSON.stringify({ ok: false, error: message, run_id: runId }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    })
  }
})
