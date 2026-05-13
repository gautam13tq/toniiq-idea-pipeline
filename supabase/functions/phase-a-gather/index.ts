/**
 * phase-a-gather — Phase A steps 1 & 2 (Datarova + Reddit)
 *
 * Trigger: POST with { pending_action_id } OR { candidate_id }. Called from
 * pg_cron dispatcher (`phase-a-dispatcher`) or directly from UI/SQL.
 *
 * Flow (v3 — 2026-05-13):
 *   1. Load candidate + pending action
 *   2. **PARALLEL** via Promise.allSettled:
 *      - Datarova branch: keyword harvest (autocomplete + bulk) → batch query
 *        + growth time series → write datarova_enrichments
 *      - Reddit branch: Apify scrape (90s cap, 30 items) → Sonnet analyze →
 *        write reddit_concept_research
 *   3. Update action context with per-branch status
 *   4. **Self-chain to phase-a-think via pg_net** — fire-and-forget through
 *      Postgres background workers, decoupled from this function's lifecycle
 *      (so the 150s wall clock can't abort the dispatch). Only chains if at
 *      least one branch succeeded.
 *
 * Why parallel (was sequential and timing out):
 *   - The 2 branches have no data dependency. Running sequentially was
 *     ~80-210s total; running in parallel caps at max(branch) instead of sum.
 *   - On 2026-05-13, 4/5 queued researches died at the 150s Supabase wall clock
 *     because they were sequential. This refactor fixes that.
 *   - Promise.allSettled means a Reddit failure (e.g. Apify slowness) no longer
 *     kills the whole pipeline. Datarova still lands, and think still chains.
 *
 * Why pg_net for the think chain (was fetch + waitUntil — see clients.ts):
 *   - Deno cancels in-flight fetches when the function exits. Three prior
 *     designs (await/waitUntil/AbortController) all failed to reliably spawn
 *     phase-a-think when gather hit the wall clock.
 *   - pg_net queues the request in Postgres background workers, fully
 *     decoupled from any Edge Function lifetime. The dispatcher RPC reads
 *     the anon JWT from Vault (same auth pattern as the other crons).
 *
 * DATA INTEGRITY: Every keyword comes from a real customer-search source
 * (Amazon Autocomplete = what people actually type, or bulk Datarova = already
 * indexed in their corpus). Every Reddit quote traces to a real Apify call.
 * No invented numbers, no fabricated quotes. Sonnet is NOT used to generate
 * keywords; Sonnet is only used to analyze Reddit posts.
 */

import { corsHeaders } from '../_shared/cors.ts'
import {
  svcClient, loadSecrets, datarovaKeywords, firstOfMonth, apifyRunSync,
  anthropicCall, extractText, extractJson, SONNET, invokeFunction, setActionStatus,
} from '../_shared/clients.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  const tStart = Date.now()
  const log = (msg: string) => console.log(`[phase-a-gather] ${Date.now() - tStart}ms · ${msg}`)

  let actionIdForErrorHandler: string | undefined
  try {
    const body = await req.json().catch(() => ({}))
    const sb = svcClient()
    const secrets = await loadSecrets(sb)

    // Resolve the pending action (create if only candidate_id given)
    let actionId: string = body.pending_action_id
    let candidateId: string = body.candidate_id
    if (!actionId && candidateId) {
      const { data } = await sb.from('pending_actions').insert({
        entity_type: 'idea', entity_id: candidateId, action: 'run_phase_a',
        triggered_by: 'llm', status: 'pending', context: {},
      }).select('id').single()
      actionId = data!.id
    }
    if (!actionId) {
      return new Response(JSON.stringify({ error: 'pending_action_id or candidate_id required' }), {
        status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders },
      })
    }
    actionIdForErrorHandler = actionId

    // Fetch action + candidate
    const { data: action, error: aErr } = await sb.from('pending_actions').select('*').eq('id', actionId).single()
    if (aErr || !action) throw new Error(`Action not found: ${aErr?.message}`)
    candidateId = action.entity_id
    const { data: candidate, error: cErr } = await sb.from('idea_candidates').select('*').eq('id', candidateId).single()
    if (cErr || !candidate) throw new Error(`Candidate not found: ${cErr?.message}`)

    log(`setup done, candidate="${candidate.ingredient_name}"`)

    await setActionStatus(sb, actionId, 'in_progress', {
      notes: `Gathering research for "${candidate.ingredient_name}"`,
      context_merge: { gather_started: new Date().toISOString(), gather_version: 'v3_parallel_pg_net' },
    })

    // Watchdog: fail any other in_progress run_phase_a actions for THIS candidate
    // older than 5 minutes.
    await sb.from('pending_actions').update({
      status: 'failed',
      completed_at: new Date().toISOString(),
      notes: `Auto-failed by watchdog: superseded by new run_phase_a (${actionId})`,
    })
      .eq('entity_id', candidateId)
      .eq('action', 'run_phase_a')
      .eq('status', 'in_progress')
      .neq('id', actionId)
      .lt('started_at', new Date(Date.now() - 5 * 60 * 1000).toISOString())

    // ── PARALLEL: Datarova + Reddit ──────────────────────────────────────
    // The two branches have no data dependency. Running in parallel cuts
    // wall-clock from sum(branches) to max(branches).
    log('starting parallel Datarova + Reddit branches')

    const [datarovaOutcome, redditOutcome] = await Promise.allSettled([
      runDatarovaBranch(sb, secrets, candidate, actionId, candidateId, tStart),
      runRedditBranch(sb, secrets, candidate, actionId, candidateId, tStart),
    ])

    const datarovaOk = datarovaOutcome.status === 'fulfilled'
    const redditOk = redditOutcome.status === 'fulfilled'
    const datarovaErr = datarovaOutcome.status === 'rejected'
      ? (datarovaOutcome.reason instanceof Error ? datarovaOutcome.reason.message : String(datarovaOutcome.reason))
      : null
    const redditErr = redditOutcome.status === 'rejected'
      ? (redditOutcome.reason instanceof Error ? redditOutcome.reason.message : String(redditOutcome.reason))
      : null

    log(`branches complete · datarova=${datarovaOk ? 'ok' : 'fail'} reddit=${redditOk ? 'ok' : 'fail'}`)
    if (datarovaErr) log(`datarova error: ${datarovaErr}`)
    if (redditErr) log(`reddit error: ${redditErr}`)

    // Update source flags on candidate based on which branches succeeded
    await sb.from('idea_candidates').update({
      source_datarova: datarovaOk,
      source_reddit: redditOk,
      source_count: (datarovaOk ? 1 : 0) + (redditOk ? 1 : 0),
      last_updated_at: new Date().toISOString(),
    }).eq('id', candidateId)

    await setActionStatus(sb, actionId, 'in_progress', {
      context_merge: {
        gather_done_at: new Date().toISOString(),
        gather_elapsed_ms: Date.now() - tStart,
        datarova_final: datarovaOk ? 'done' : `failed: ${datarovaErr}`,
        reddit_final: redditOk ? 'done' : `failed: ${redditErr}`,
      },
    })

    // Only chain to think if at least one branch succeeded. If both failed,
    // mark the action failed and let the UI retry.
    if (!datarovaOk && !redditOk) {
      log('both branches failed, marking action failed and NOT chaining to think')
      await setActionStatus(sb, actionId, 'failed', {
        notes: `Gather failed: datarova=${datarovaErr || 'n/a'} reddit=${redditErr || 'n/a'}`,
      })
      return new Response(JSON.stringify({
        ok: false, step: 'gather', error: 'both_branches_failed',
        datarova_error: datarovaErr, reddit_error: redditErr,
        elapsed_ms: Date.now() - tStart,
      }), { status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders } })
    }

    // ── CHAIN TO THINK STEP via pg_net ───────────────────────────────────
    log('chaining to phase-a-think via pg_net')
    try {
      await invokeFunction('phase-a-think', { pending_action_id: actionId })
      log('phase-a-think dispatch enqueued')
    } catch (e) {
      const errMsg = (e as Error).message
      console.error('Failed to invoke phase-a-think:', errMsg)
      await setActionStatus(sb, actionId, 'in_progress', {
        context_merge: { chain_to_think_error: errMsg },
      })
    }

    log(`done in ${Date.now() - tStart}ms`)
    return new Response(JSON.stringify({
      ok: true, step: 'gather', action_id: actionId, candidate_id: candidateId,
      datarova: datarovaOk, reddit: redditOk,
      elapsed_ms: Date.now() - tStart,
    }), { headers: { 'Content-Type': 'application/json', ...corsHeaders } })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('phase-a-gather error:', msg)
    try {
      const sb = svcClient()
      if (actionIdForErrorHandler) {
        await setActionStatus(sb, actionIdForErrorHandler, 'failed', { notes: `gather failed: ${msg}` })
      }
    } catch (_) { /* ignore */ }
    return new Response(JSON.stringify({ error: msg, elapsed_ms: Date.now() - tStart }), {
      status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders },
    })
  }
})

// ──────────────────────────────────────────────────────────────────────────
// DATAROVA BRANCH
// ──────────────────────────────────────────────────────────────────────────

async function runDatarovaBranch(
  sb: any, secrets: any, candidate: any, actionId: string, candidateId: string, tStart: number,
): Promise<void> {
  const log = (msg: string) => console.log(`[phase-a-gather:datarova] ${Date.now() - tStart}ms · ${msg}`)
  await setActionStatus(sb, actionId, 'in_progress', { context_merge: { datarova: 'running' } })

  const { data: bulkRows } = await sb.from('datarova_snapshots')
    .select('keyword, search_volume')
    .eq('candidate_id', candidateId)
    .order('search_volume', { ascending: false, nullsFirst: false })
    .limit(20)
  const bulkKnown = (bulkRows || []).map((r: any) => r.keyword).filter(Boolean)
  const parentTerm = candidate.ingredient_name.toLowerCase().trim()
  log(`bulk keywords loaded: ${bulkKnown.length}`)

  const autocompleteSuggestions = await harvestAutocomplete(secrets.apify_api_token, parentTerm)
  log(`autocomplete done: ${autocompleteSuggestions.length} suggestions`)

  await setActionStatus(sb, actionId, 'in_progress', {
    context_merge: { keyword_harvest: { autocomplete: autocompleteSuggestions.length, bulk: bulkKnown.length } },
  })

  const dedup = new Set<string>()
  const allKeywords: string[] = []
  for (const k of [parentTerm, `${parentTerm} supplement`, ...bulkKnown, ...autocompleteSuggestions]) {
    const norm = String(k).toLowerCase().trim()
    if (!norm || norm.length < 3 || norm.length > 100 || dedup.has(norm)) continue
    dedup.add(norm)
    allKeywords.push(norm)
  }
  const keywords = allKeywords.slice(0, 100)
  const now = new Date()
  const snapshotDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))
  const snapshotStr = firstOfMonth(snapshotDate)
  const threeMoAgo = firstOfMonth(new Date(Date.UTC(snapshotDate.getUTCFullYear(), snapshotDate.getUTCMonth() - 2, 1)))

  const snapshot = await datarovaKeywords(secrets.datarova_api_key, {
    keywords, start: threeMoAgo, end: snapshotStr,
  })
  log(`datarova batch done: ${snapshot.length} keywords returned`)

  const pickLatest = (recs: any[]): any | null => {
    const sorted = [...(recs || [])].sort((a, b) => (b.start_date || '').localeCompare(a.start_date || ''))
    return sorted.find(r => (r.clicks || 0) > 0) || null
  }
  type WithRecord = { keyword: string; record: any }
  const withData: WithRecord[] = snapshot.map(k => ({ keyword: k.keyword, record: pickLatest(k.records as any[]) }))
    .filter((x: WithRecord) => x.record !== null)
  const sorted = [...withData].sort((a, b) => (b.record.clicks || 0) - (a.record.clicks || 0))
  const topKeywords = sorted.slice(0, 8).map(k => k.keyword)

  let growthMap: Record<string, any> = {}
  if (topKeywords.length > 0) {
    const twelveMoAgo = firstOfMonth(new Date(Date.UTC(snapshotDate.getUTCFullYear() - 1, snapshotDate.getUTCMonth(), 1)))
    const ts = await datarovaKeywords(secrets.datarova_api_key, {
      keywords: topKeywords, start: twelveMoAgo, end: snapshotStr,
    })
    log(`datarova growth done for top ${topKeywords.length} keywords`)
    for (const k of ts) {
      const recs = (k.records || []).slice().sort((a: any, b: any) => (a.start_date || '').localeCompare(b.start_date || ''))
      if (recs.length < 2) continue
      const last = recs[recs.length - 1]?.clicks || 0
      const first = recs[0]?.clicks || 1
      const m3 = recs[recs.length - 4]?.clicks || first
      const m6 = recs[recs.length - 7]?.clicks || first
      growthMap[k.keyword] = {
        growth_3m_pct: m3 ? ((last - m3) / m3) * 100 : null,
        growth_6m_pct: m6 ? ((last - m6) / m6) * 100 : null,
        growth_yoy_pct: first ? ((last - first) / first) * 100 : null,
        monthly: recs.map((r: any) => ({ month: (r.start_date || '').slice(0, 7), clicks: r.clicks, sales: r.sales, conv: r.conversion_rate })),
      }
    }
  }

  const relatedKeywords = withData.map(k => {
    const r = k.record
    const g = growthMap[k.keyword] || {}
    return {
      keyword: k.keyword, clicks: r.clicks || 0, sales: r.sales || 0, conversion: r.conversion_rate || 0,
      growth_3m_pct: g.growth_3m_pct ?? null, growth_6m_pct: g.growth_6m_pct ?? null, growth_yoy_pct: g.growth_yoy_pct ?? null,
      snapshot_month: r.start_date || null,
    }
  })
  const totalClicks = relatedKeywords.reduce((s, k) => s + (k.clicks || 0), 0)
  const totalSales = relatedKeywords.reduce((s, k) => s + (k.sales || 0), 0)
  const weightedConv = totalClicks > 0 ? (totalSales / totalClicks) * 100 : 0
  const primary = sorted[0]
  const primaryGrowth = primary ? growthMap[primary.keyword] : null

  const primaryClicks = primary?.record?.clicks || 0
  const primaryConv = primary?.record?.conversion_rate || 0
  const volumeScore = primaryClicks >= 100000 ? 5 : primaryClicks >= 10000 ? 4 : primaryClicks >= 1000 ? 3 : primaryClicks >= 500 ? 2 : primaryClicks >= 100 ? 1 : 0
  const yoy = primaryGrowth?.growth_yoy_pct ?? 0
  const growthBonus = yoy > 100 ? 3 : yoy > 50 ? 2 : yoy > 20 ? 1 : yoy > 0 ? 0 : -1
  const convBonus = primaryConv >= 30 ? 2 : primaryConv >= 20 ? 1 : 0
  const deepScore = Math.max(0, Math.min(10, volumeScore + growthBonus + convBonus))

  const volumeDesc = primaryClicks >= 100000 ? 'large' : primaryClicks >= 10000 ? 'moderate' : primaryClicks >= 1000 ? 'niche' : 'very niche'
  const growthDesc = yoy > 100 ? 'explosive' : yoy > 50 ? 'strong' : yoy > 20 ? 'growing' : yoy > 0 ? 'stable' : 'declining'
  const convDesc = primaryConv >= 30 ? 'high intent' : primaryConv >= 20 ? 'healthy intent' : primaryConv >= 15 ? 'average' : 'low intent'
  const opportunitySummary = `${volumeDesc.charAt(0).toUpperCase() + volumeDesc.slice(1)} market (primary "${primary?.keyword || '—'}" = ${primaryClicks.toLocaleString()} clicks/mo) with ${growthDesc} growth (${yoy.toFixed(1)}% YoY) and ${convDesc} purchase signal (${primaryConv.toFixed(1)}% conversion). ${deepScore >= 7 ? 'Strong opportunity signal.' : deepScore >= 5 ? 'Moderate opportunity.' : 'Weak signal — examine Reddit + science before dismissing.'}`
  const scoreJustification = `Volume: ${volumeScore}/5 (${primaryClicks.toLocaleString()} clicks). Growth: ${growthBonus >= 0 ? '+' : ''}${growthBonus} (${yoy.toFixed(1)}% YoY, ${(primaryGrowth?.growth_3m_pct ?? 0).toFixed(1)}% 3m). Conversion: +${convBonus} (${primaryConv.toFixed(1)}%). Total: ${deepScore}/10. Based on ${relatedKeywords.length}/${keywords.length} keywords with data.`

  await sb.from('datarova_enrichments').insert({
    candidate_id: candidateId,
    search_keyword: candidate.ingredient_name,
    marketplace: 'US',
    date_range_start: snapshotStr, date_range_end: snapshotStr,
    total_related_keywords: relatedKeywords.length,
    total_monthly_clicks: totalClicks, total_monthly_sales: totalSales,
    avg_conversion_rate: weightedConv, weighted_avg_conversion: weightedConv,
    primary_keyword: primary?.keyword, primary_keyword_clicks: primaryClicks,
    primary_keyword_sales: primary?.record?.sales || 0,
    primary_keyword_conversion: primaryConv,
    growth_3m_clicks_pct: primaryGrowth?.growth_3m_pct ?? null,
    growth_6m_clicks_pct: primaryGrowth?.growth_6m_pct ?? null,
    growth_yoy_clicks_pct: primaryGrowth?.growth_yoy_pct ?? null,
    monthly_trend: primaryGrowth?.monthly || null,
    related_keywords: relatedKeywords,
    datarova_deep_score: deepScore,
    score_justification: scoreJustification,
    opportunity_summary: opportunitySummary,
    enriched_at: new Date().toISOString(),
    api_calls_made: 2,
  })

  log(`datarova_enrichments inserted, ${relatedKeywords.length} keywords with data, score ${deepScore}/10`)

  await setActionStatus(sb, actionId, 'in_progress', {
    context_merge: { datarova: 'done', datarova_stats: { total_keywords: relatedKeywords.length, total_clicks: totalClicks } },
  })
}

// ──────────────────────────────────────────────────────────────────────────
// REDDIT BRANCH
// ──────────────────────────────────────────────────────────────────────────

async function runRedditBranch(
  sb: any, secrets: any, candidate: any, actionId: string, candidateId: string, tStart: number,
): Promise<void> {
  const log = (msg: string) => console.log(`[phase-a-gather:reddit] ${Date.now() - tStart}ms · ${msg}`)
  await setActionStatus(sb, actionId, 'in_progress', { context_merge: { reddit: 'running' } })

  const redditQueries = [
    `${candidate.ingredient_name} supplement`,
    `${candidate.ingredient_name}`,
    `${candidate.ingredient_name} benefits`,
  ]

  // v2: cap Apify timeout at 90s (was 180s) and maxItems at 30 (was 50).
  // 30 posts is still a meaningful corpus, and the 90s cap keeps us within
  // budget even on slow Reddit queries.
  const redditRaw: any[] = await apifyRunSync(secrets.apify_api_token, 'trudax/reddit-scraper-lite', {
    searches: redditQueries, sort: 'relevance', time: 'year', maxItems: 30, maxPostCount: 15,
    skipComments: true, searchPosts: true, searchComments: false, searchCommunities: false, searchUsers: false,
    includeNSFW: false, proxy: { useApifyProxy: true, apifyProxyGroups: ['RESIDENTIAL'] },
  }, 90_000)

  log(`apify reddit done: ${redditRaw.length} posts`)

  const redditAnalysis = await analyzeRedditPosts(secrets.anthropic_api_key, candidate.ingredient_name, redditRaw)

  log(`sonnet analysis done, score=${redditAnalysis.reddit_score}`)

  await sb.from('reddit_concept_research').insert({
    candidate_id: candidateId,
    ingredient_name: candidate.ingredient_name,
    total_posts_analyzed: redditRaw.length,
    estimated_monthly_posts: redditAnalysis.estimated_monthly_posts,
    sentiment_ratio: redditAnalysis.sentiment_ratio,
    formats_discussed: redditAnalysis.formats_discussed,
    combos_discussed: redditAnalysis.combos_discussed,
    dosages_discussed: redditAnalysis.dosages_discussed,
    pain_points: redditAnalysis.pain_points,
    use_cases: redditAnalysis.use_cases,
    brand_landscape: redditAnalysis.brand_landscape,
    underserved_needs: redditAnalysis.underserved_needs,
    safety_concerns: redditAnalysis.safety_concerns,
    efficacy_skepticism: redditAnalysis.efficacy_skepticism,
    reddit_score: redditAnalysis.reddit_score,
    score_justification: redditAnalysis.score_justification,
    concept_suggestions: redditAnalysis.concept_suggestions,
    searches_run: redditQueries,
    api_calls_made: 1,
    researched_at: new Date().toISOString(),
  })

  log(`reddit_concept_research inserted`)

  await setActionStatus(sb, actionId, 'in_progress', {
    context_merge: { reddit: 'done', reddit_stats: { posts: redditRaw.length, score: redditAnalysis.reddit_score } },
  })
}

// ──────────────────────────────────────────────────────────────────────────
// HELPERS
// ──────────────────────────────────────────────────────────────────────────

/**
 * Harvest real customer-search keywords from Amazon's autocomplete index.
 * Each query stem fires one Apify call in parallel via Promise.all.
 */
const AUTOCOMPLETE_SUFFIXES = [
  '', ' supplement', ' capsules', ' powder', ' for', ' with', ' best', ' organic',
]

async function harvestAutocomplete(apifyToken: string, ingredient: string): Promise<string[]> {
  const stems = AUTOCOMPLETE_SUFFIXES.map(s => `${ingredient}${s}`.trim())
  const words = ingredient.split(/\s+/)
  if (words.length >= 3) {
    const short = words.slice(-2).join(' ')
    if (short !== ingredient) stems.push(short)
  }

  const results = await Promise.all(stems.map(async (q) => {
    try {
      const data = await apifyRunSync(apifyToken, 'pintostudio/amazon-search-autocomplete-scraper',
        { query: q, countryIso: 'us' }, 30_000)
      return Array.isArray(data)
        ? data.map((d: any) => (d?.value || d?.suggestion || d?.phrase || '').trim()).filter(Boolean)
        : []
    } catch (e) {
      console.error(`autocomplete failed for "${q}": ${(e as Error).message}`)
      return []
    }
  }))
  return results.flat()
}

async function analyzeRedditPosts(apiKey: string, ingredient: string, posts: any[]): Promise<any> {
  const compact = posts.slice(0, 30).map(p => ({
    title: p.title || '',
    body: String(p.body || p.text || '').slice(0, 400),
    community: p.communityName || p.subreddit || '',
    upvotes: p.upVotes || p.numberOfUpVotes || 0,
    comments: p.numberOfComments || 0,
    url: p.url || '',
  }))

  const r = await anthropicCall(apiKey, {
    model: SONNET,
    max_tokens: 4000,
    system: `You are a Reddit social-signal analyst for Toniiq's supplement ideation pipeline. Analyze posts about a specific ingredient/concept. Return STRICT JSON. DATA INTEGRITY: every quote and brand mention must come from the supplied posts — do NOT invent. If posts are thin/spammy, acknowledge and score low rather than padding with generic claims.

Return this exact JSON structure (no markdown, no commentary):
{
  "estimated_monthly_posts": number,
  "sentiment_ratio": number (0-100, % positive),
  "formats_discussed": ["powder", "capsules", ...],
  "combos_discussed": ["ingredient + X", ...],
  "dosages_discussed": ["500mg", "Mayo protocol 20mg/kg x 2d", ...],
  "pain_points": [{"pain": "...", "evidence": "r/sub /postid/: quote", "toniiq_read": "..."}],
  "use_cases": ["muscle growth", "sleep", ...],
  "brand_landscape": [{"rank": 1, "brand": "...", "mentions": n, "sentiment": "positive/neutral/negative", "context": "..."}],
  "underserved_needs": ["high-dose format", ...],
  "safety_concerns": ["DHT increase", ...],
  "efficacy_skepticism": "summary of skeptical voices",
  "reddit_score": number (0-10),
  "score_justification": "1-2 sentences",
  "concept_suggestions": ["Concept 1", "Concept 2", "Concept 3"]
}`,
    messages: [{
      role: 'user',
      content: `Ingredient/concept: "${ingredient}"\n\nReddit posts (${compact.length}):\n${JSON.stringify(compact, null, 1)}`,
    }],
  })
  const text = extractText(r)
  try {
    return extractJson(text)
  } catch (e) {
    return {
      estimated_monthly_posts: 0, sentiment_ratio: 50, formats_discussed: [], combos_discussed: [],
      dosages_discussed: [], pain_points: [], use_cases: [], brand_landscape: [],
      underserved_needs: [], safety_concerns: [], efficacy_skepticism: 'parse error',
      reddit_score: 3, score_justification: `LLM parse error: ${(e as Error).message}`,
      concept_suggestions: [],
    }
  }
}
