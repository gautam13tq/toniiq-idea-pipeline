/**
 * phase-a-gather — Phase A steps 1 & 2 (Datarova + Reddit)
 *
 * Trigger: POST with { pending_action_id } OR { candidate_id }. Called from
 * pg_cron dispatcher (`phase-a-dispatcher`) or directly from UI/SQL.
 *
 * Flow (v4 — 2026-05-19) — added buyer-keyword inference layer:
 *   0. **NEW: Buyer-keyword inference (Sonnet)**. Reads candidate.ingredient_name,
 *      candidate.notes, and the linked opportunity_review (rationale / source_context
 *      / signal_tags). Returns a canonical primary_keyword + related buyer queries.
 *      Category-Atlas-style technical names like "Butyrate / tributyrin postbiotic-
 *      metabolite lane" get translated into real buyer queries ("butyrate supplement",
 *      "tributyrin", etc.) before any data gathering. A short-circuit heuristic skips
 *      the Sonnet call when ingredient_name is already a clean buyer term and notes
 *      are empty — so "pycnogenol", "nac", "rhodiola" are not slowed down.
 *   1. Load candidate + pending action + opportunity_review (for inference context)
 *   2. **PARALLEL** via Promise.allSettled:
 *      - Datarova branch: keyword harvest (autocomplete + bulk + inferred-related)
 *        → batch query + growth time series → write datarova_enrichments
 *      - Reddit branch: Apify scrape (90s cap, 30 items) using inferred primary
 *        keyword as query stems → Sonnet analyze → write reddit_concept_research
 *   3. Update action context with per-branch status + inferred_keywords (for audit)
 *   4. **Self-chain to phase-a-think via pg_net** — fire-and-forget through
 *      Postgres background workers, decoupled from this function's lifecycle
 *      (so the 150s wall clock can't abort the dispatch). Only chains if at
 *      least one branch succeeded. phase-a-think (v4+) reads inferred_keywords
 *      from the pending_action context to inform synthesis.
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

    // Fetch action + candidate + linked opportunity_review (for keyword inference context)
    const { data: action, error: aErr } = await sb.from('pending_actions').select('*').eq('id', actionId).single()
    if (aErr || !action) throw new Error(`Action not found: ${aErr?.message}`)
    candidateId = action.entity_id
    const { data: candidate, error: cErr } = await sb.from('idea_candidates').select('*').eq('id', candidateId).single()
    if (cErr || !candidate) throw new Error(`Candidate not found: ${cErr?.message}`)
    const { data: opportunityReview } = await sb
      .from('opportunity_reviews')
      .select('source, source_context, signal_tags, rationale')
      .eq('candidate_id', candidateId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    log(`setup done, candidate="${candidate.ingredient_name}" review=${!!opportunityReview}`)

    await setActionStatus(sb, actionId, 'in_progress', {
      notes: `Gathering research for "${candidate.ingredient_name}"`,
      context_merge: { gather_started: new Date().toISOString(), gather_version: 'v4_keyword_inference' },
    })

    // ── STEP 0: BUYER-KEYWORD INFERENCE ──────────────────────────────────
    // Translate technical/category-style ingredient_name into canonical buyer
    // search queries that Datarova/Reddit can actually find data for. The
    // skip-heuristic avoids the LLM call when ingredient_name is already a clean
    // buyer term and notes/rationale are empty.
    const tInfer = Date.now()
    const inferred = await inferBuyerKeywords(secrets.anthropic_api_key, {
      ingredient_name: candidate.ingredient_name,
      notes: candidate.notes,
      source: opportunityReview?.source,
      source_context: opportunityReview?.source_context,
      signal_tags: opportunityReview?.signal_tags,
      rationale: opportunityReview?.rationale,
    })
    log(`keyword inference done in ${Date.now() - tInfer}ms · primary="${inferred.primary_keyword}" related=${inferred.related_keywords.length} skipped=${inferred.skipped}`)

    await setActionStatus(sb, actionId, 'in_progress', {
      context_merge: {
        inferred_keywords: {
          primary_keyword: inferred.primary_keyword,
          related_keywords: inferred.related_keywords,
          reasoning: inferred.reasoning,
          skipped: inferred.skipped,
          inference_elapsed_ms: Date.now() - tInfer,
        },
      },
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
      runDatarovaBranch(sb, secrets, candidate, inferred, actionId, candidateId, tStart),
      runRedditBranch(sb, secrets, candidate, inferred, actionId, candidateId, tStart),
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
  sb: any, secrets: any, candidate: any, inferred: KeywordInference, actionId: string, candidateId: string, tStart: number,
): Promise<void> {
  const log = (msg: string) => console.log(`[phase-a-gather:datarova] ${Date.now() - tStart}ms · ${msg}`)
  await setActionStatus(sb, actionId, 'in_progress', { context_merge: { datarova: 'running' } })

  const { data: bulkRows } = await sb.from('datarova_snapshots')
    .select('keyword, search_volume')
    .eq('candidate_id', candidateId)
    .order('search_volume', { ascending: false, nullsFirst: false })
    .limit(20)
  const bulkKnown = (bulkRows || []).map((r: any) => r.keyword).filter(Boolean)

  // v4: Use inferred primary_keyword as the parent search term (was ingredient_name).
  // This is the fix for Category-Atlas-style technical names that don't match buyer queries.
  const parentTerm = inferred.primary_keyword.toLowerCase().trim()
  const inferredRelated = inferred.related_keywords.map(k => k.toLowerCase().trim()).filter(Boolean)
  log(`parent_term="${parentTerm}" · inferred_related=${inferredRelated.length} · bulk=${bulkKnown.length}`)

  const autocompleteSuggestions = await harvestAutocomplete(secrets.apify_api_token, parentTerm)
  log(`autocomplete done: ${autocompleteSuggestions.length} suggestions`)

  await setActionStatus(sb, actionId, 'in_progress', {
    context_merge: { keyword_harvest: { autocomplete: autocompleteSuggestions.length, bulk: bulkKnown.length, inferred_related: inferredRelated.length } },
  })

  // v4: seed list now includes inferred related keywords. Order matters because
  // we cap at 100 — inferred related are buyer-curated and should rank above
  // raw autocomplete in case the parent term has many noisy autocompletes.
  const dedup = new Set<string>()
  const allKeywords: string[] = []
  for (const k of [parentTerm, `${parentTerm} supplement`, ...inferredRelated, ...bulkKnown, ...autocompleteSuggestions]) {
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
  sb: any, secrets: any, candidate: any, inferred: KeywordInference, actionId: string, candidateId: string, tStart: number,
): Promise<void> {
  const log = (msg: string) => console.log(`[phase-a-gather:reddit] ${Date.now() - tStart}ms · ${msg}`)
  await setActionStatus(sb, actionId, 'in_progress', { context_merge: { reddit: 'running' } })

  // v4: Use inferred primary keyword as the Reddit search root (was ingredient_name).
  // Add 1-2 inferred related keywords for query diversity. Cap at 3 queries — Reddit
  // Apify pricing scales by query count. Examples:
  //   "Butyrate / tributyrin postbiotic-metabolite lane" → "butyrate supplement", "butyrate", "tributyrin"
  const redditRoot = inferred.primary_keyword.trim()
  const redditRelated = inferred.related_keywords.slice(0, 1).map(k => k.trim()).filter(Boolean)
  const redditQueries = [
    `${redditRoot} supplement`,
    redditRoot,
    redditRelated[0] || `${redditRoot} benefits`,
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
// BUYER-KEYWORD INFERENCE (v4)
// ──────────────────────────────────────────────────────────────────────────

interface KeywordInference {
  primary_keyword: string
  related_keywords: string[]
  reasoning: string
  skipped: boolean
}

/**
 * Translate a candidate's ingredient_name + notes + opportunity_review context
 * into canonical buyer-friendly search queries.
 *
 * The skip heuristic short-circuits when ingredient_name is already a clean
 * buyer term (single/double word, no slashes, no "system"/"lane"/"complex" words)
 * AND notes/rationale are empty. Examples that skip:
 *   - "pycnogenol", "nac", "rhodiola", "saccharomyces boulardii"
 * Examples that DON'T skip:
 *   - "Butyrate / tributyrin postbiotic-metabolite lane" (slash + technical phrasing)
 *   - "Reishi Mushroom Extract" with Taiyi spec notes (notes non-empty)
 *   - "Citrus hesperidin / bioflavonoid system" (slash + system suffix)
 */
async function inferBuyerKeywords(
  apiKey: string,
  ctx: {
    ingredient_name: string
    notes?: string | null
    source?: string | null
    source_context?: string | null
    signal_tags?: string[] | null
    rationale?: string | null
  },
): Promise<KeywordInference> {
  const name = (ctx.ingredient_name || '').trim()
  const notes = (ctx.notes || '').trim()
  const rationale = (ctx.rationale || '').trim()
  const tagsList = Array.isArray(ctx.signal_tags) ? ctx.signal_tags.filter(Boolean) : []

  // Skip heuristic: clean buyer term, no extra context.
  const hasTechnicalMarker = /[\/|]|\b(system|lane|complex|axis|pathway|family|class)\b/i.test(name)
  const tooLong = name.length > 40
  const hasContext = notes.length > 0 || rationale.length > 0
  if (!hasTechnicalMarker && !tooLong && !hasContext) {
    return {
      primary_keyword: name.toLowerCase(),
      related_keywords: [],
      reasoning: 'Skip heuristic: ingredient_name is already a clean buyer term and no manual context to expand.',
      skipped: true,
    }
  }

  const contextBlock = [
    `Ingredient/candidate name: "${name}"`,
    notes ? `Notes (often spec/positioning captured by Toniiq team): ${notes}` : null,
    rationale && rationale !== notes ? `Opportunity rationale: ${rationale}` : null,
    ctx.source ? `Source: ${ctx.source}${ctx.source_context ? ` (${ctx.source_context})` : ''}` : null,
    tagsList.length ? `Signal tags: ${tagsList.join(', ')}` : null,
  ].filter(Boolean).join('\n')

  const r = await anthropicCall(apiKey, {
    model: SONNET,
    max_tokens: 600,
    system: `You are the Buyer-Keyword Inference agent for Toniiq's supplement NPD pipeline. You translate technical / category-level ingredient names from upstream tools (Category Atlas, manual ideas, supplier conversations) into the canonical buyer-friendly Amazon search queries that real customers actually type.

CORE GOAL: produce search queries that Datarova (Amazon keyword corpus) and Reddit (community discussion) will return meaningful data for. Technical/scientific phrasings (e.g. "Butyrate / tributyrin postbiotic-metabolite lane") return 0 hits and must be decomposed.

RULES:
1. primary_keyword: the SINGLE best buyer query — the term shoppers most likely type into Amazon for this candidate. Should be a real ingredient or product noun. Lowercase. 1-4 words.
2. related_keywords: 4-8 additional buyer queries that cover adjacent terminology, synonyms, branded forms, dosage/spec variants, and condition-led searches. Each one must be a plausible Amazon search. Lowercase. 1-5 words each.
3. If the input name is a multi-ingredient/category lane (e.g. "X / Y / Z lane"), the related_keywords MUST cover each major component separately (X, Y, Z as their own buyer terms).
4. If notes/rationale specify a particular spec (e.g. "Taiyi: 10% triterpenes + 30% polysaccharides", "Indena Quercefit phytosome"), include 1-2 related_keywords that reflect that spec lane (e.g. "reishi extract organic", "quercetin phytosome").
5. Avoid trademark-only terms unless the candidate is explicitly that brand. Prefer the generic ingredient noun.
6. reasoning: 1-2 sentences explaining the keyword decomposition.

EXAMPLES:
Input: "Butyrate / tributyrin postbiotic-metabolite lane"
Output: { primary_keyword: "butyrate supplement", related_keywords: ["butyrate", "sodium butyrate", "tributyrin", "calcium magnesium butyrate", "postbiotic supplement"], reasoning: "Atlas lane spans the butyrate + tributyrin + postbiotic landscape. Butyrate is the dominant search root; tributyrin and postbiotic are related lanes worth pulling." }

Input: "Bifidobacterium longum / psychobiotic lane"
Output: { primary_keyword: "bifidobacterium longum", related_keywords: ["b longum", "psychobiotic", "probiotic for anxiety", "probiotic for mood", "b longum 1714"], reasoning: "B. longum is the strain itself; psychobiotic is the marketing lane. Mood/anxiety condition keywords capture the buyer intent." }

Input: "Reishi Mushroom Extract" with notes "Triterpenes 10% + Polysaccharides 30% Organic version also available CIF Los Angeles: USD 195/kg"
Output: { primary_keyword: "reishi mushroom extract", related_keywords: ["reishi", "ganoderma lucidum", "organic reishi", "reishi capsule", "reishi triterpenes", "reishi 30% polysaccharides"], reasoning: "Reishi is the buyer-canonical noun. Notes specify a dual-spec supplier offering, so spec-led variants (triterpenes, 30% polysaccharides, organic) are worth pulling." }

Return STRICT JSON. No markdown, no commentary.`,
    messages: [{
      role: 'user',
      content: `${contextBlock}\n\nInfer the buyer-keyword decomposition. Return JSON.`,
    }],
  })

  const text = extractText(r)
  try {
    const parsed = extractJson<any>(text)
    const primary = String(parsed.primary_keyword || '').trim().toLowerCase()
    if (!primary) throw new Error('empty primary_keyword from inference')
    const related = Array.isArray(parsed.related_keywords)
      ? parsed.related_keywords.map((k: any) => String(k || '').trim().toLowerCase()).filter((k: string) => k.length >= 2 && k.length <= 60 && k !== primary).slice(0, 10)
      : []
    return {
      primary_keyword: primary,
      related_keywords: related,
      reasoning: String(parsed.reasoning || '').trim() || 'No reasoning returned.',
      skipped: false,
    }
  } catch (e) {
    // Fallback: use a sanitized version of ingredient_name. Better to proceed
    // with partial data than to fail the whole Phase A run on a parse error.
    const fallback = name.toLowerCase().split(/[\/|]/).map(s => s.trim()).filter(Boolean)[0]
      ?.replace(/\b(system|lane|complex|axis|pathway|family|class)\b/gi, '')
      .trim() || name.toLowerCase()
    return {
      primary_keyword: fallback,
      related_keywords: [],
      reasoning: `Inference parse error (${(e as Error).message}); used sanitized fallback of ingredient_name.`,
      skipped: false,
    }
  }
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
