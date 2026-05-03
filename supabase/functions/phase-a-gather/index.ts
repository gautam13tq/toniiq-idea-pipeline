/**
 * phase-a-gather — Phase A steps 1 & 2 (Datarova + Reddit)
 *
 * Trigger: POST with { pending_action_id } OR { candidate_id } (the latter
 * creates a pending action). Called from pg_cron dispatcher or directly from UI.
 *
 * Flow:
 *   1. Load candidate + pending action
 *   2. Datarova: expand keywords via Sonnet, batch-query, compute growth, write datarova_enrichments
 *   3. Apify Reddit: scrape posts, Sonnet analyzes sentiment+pain points, write reddit_concept_research
 *   4. Update pending_action context with step statuses
 *   5. Self-chain to phase-a-think (science + synthesis)
 *
 * DATA INTEGRITY: Every keyword volume and every Reddit quote is traceable to
 * a real API call (Datarova/Apify). No invented numbers, no fabricated quotes.
 */

import { corsHeaders } from '../_shared/cors.ts'
import {
  svcClient, loadSecrets, datarovaKeywords, firstOfMonth, apifyRunSync,
  anthropicCall, extractText, extractJson, SONNET, invokeFunction, setActionStatus,
} from '../_shared/clients.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

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

    // Fetch action + candidate
    const { data: action, error: aErr } = await sb.from('pending_actions').select('*').eq('id', actionId).single()
    if (aErr || !action) throw new Error(`Action not found: ${aErr?.message}`)
    candidateId = action.entity_id
    const { data: candidate, error: cErr } = await sb.from('idea_candidates').select('*').eq('id', candidateId).single()
    if (cErr || !candidate) throw new Error(`Candidate not found: ${cErr?.message}`)

    await setActionStatus(sb, actionId, 'in_progress', {
      notes: `Gathering research for "${candidate.ingredient_name}"`,
      context_merge: { gather_started: new Date().toISOString(), model_usage: {} },
    })

    // Watchdog: fail any other in_progress run_phase_a actions for THIS candidate
    // older than 5 minutes. Edge Function timeouts leave them dangling otherwise.
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

    // ── STEP 1: DATAROVA ─────────────────────────────────────────────────
    await setActionStatus(sb, actionId, 'in_progress', { context_merge: { datarova: 'running' } })

    // Build keyword list: union of (a) Sonnet-generated variants, (b) parent term,
    // (c) bulk-known-good keywords already in datarova_snapshots for this candidate.
    // Datarova has no fuzzy match — querying terms it doesn't index returns empty.
    // Without (b)+(c), sparsely-indexed ingredients (e.g. bromelain) get 0 keywords.
    const sonnetKeywords = await generateKeywordList(secrets.anthropic_api_key, candidate.ingredient_name)
    const { data: bulkRows } = await sb.from('datarova_snapshots')
      .select('keyword, search_volume')
      .eq('candidate_id', candidateId)
      .order('search_volume', { ascending: false, nullsFirst: false })
      .limit(20)
    const bulkKnown = (bulkRows || []).map((r: any) => r.keyword).filter(Boolean)
    const parentTerm = candidate.ingredient_name.toLowerCase().trim()
    const dedup = new Set<string>()
    const keywords: string[] = []
    for (const k of [parentTerm, `${parentTerm} supplement`, ...bulkKnown, ...sonnetKeywords]) {
      const norm = String(k).toLowerCase().trim()
      if (norm && !dedup.has(norm)) { dedup.add(norm); keywords.push(norm) }
    }
    // Pick snapshot date: previous full month (Datarova lags 1-2 mo)
    const now = new Date()
    const snapshotDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))
    const snapshotStr = firstOfMonth(snapshotDate)
    // Datarova lag is 1-2 months — single-day query can miss data even for known
    // keywords. Query a 3-month window and pick the latest record with clicks > 0.
    const threeMoAgo = firstOfMonth(new Date(Date.UTC(snapshotDate.getUTCFullYear(), snapshotDate.getUTCMonth() - 2, 1)))

    const snapshot = await datarovaKeywords(secrets.datarova_api_key, {
      keywords, start: threeMoAgo, end: snapshotStr,
    })
    // Per keyword: find the latest month with clicks > 0 (may be older than the requested end_date due to Datarova lag)
    const pickLatest = (recs: any[]): any | null => {
      const sorted = [...(recs || [])].sort((a, b) => (b.start_date || '').localeCompare(a.start_date || ''))
      return sorted.find(r => (r.clicks || 0) > 0) || null
    }
    type WithRecord = { keyword: string; record: any }
    const withData: WithRecord[] = snapshot.map(k => ({ keyword: k.keyword, record: pickLatest(k.records as any[]) }))
      .filter((x: WithRecord) => x.record !== null)
    const sorted = [...withData].sort((a, b) => (b.record.clicks || 0) - (a.record.clicks || 0))
    const topKeywords = sorted.slice(0, 8).map(k => k.keyword)

    // 12-month time series for growth on top keywords (only if we have top keywords)
    let growthMap: Record<string, any> = {}
    if (topKeywords.length > 0) {
      const twelveMoAgo = firstOfMonth(new Date(Date.UTC(snapshotDate.getUTCFullYear() - 1, snapshotDate.getUTCMonth(), 1)))
      const ts = await datarovaKeywords(secrets.datarova_api_key, {
        keywords: topKeywords, start: twelveMoAgo, end: snapshotStr,
      })
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

    // Build related_keywords array
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

    // Compute datarova_deep_score (0-10): volume + growth + conversion
    const primaryClicks = primary?.record?.clicks || 0
    const primaryConv = primary?.record?.conversion_rate || 0
    const volumeScore = primaryClicks >= 100000 ? 5 : primaryClicks >= 10000 ? 4 : primaryClicks >= 1000 ? 3 : primaryClicks >= 500 ? 2 : primaryClicks >= 100 ? 1 : 0
    const yoy = primaryGrowth?.growth_yoy_pct ?? 0
    const growthBonus = yoy > 100 ? 3 : yoy > 50 ? 2 : yoy > 20 ? 1 : yoy > 0 ? 0 : -1
    const convBonus = primaryConv >= 30 ? 2 : primaryConv >= 20 ? 1 : 0
    const deepScore = Math.max(0, Math.min(10, volumeScore + growthBonus + convBonus))

    // Opportunity summary — contextualized narrative
    const volumeDesc = primaryClicks >= 100000 ? 'large' : primaryClicks >= 10000 ? 'moderate' : primaryClicks >= 1000 ? 'niche' : 'very niche'
    const growthDesc = yoy > 100 ? 'explosive' : yoy > 50 ? 'strong' : yoy > 20 ? 'growing' : yoy > 0 ? 'stable' : 'declining'
    const convDesc = primaryConv >= 30 ? 'high intent' : primaryConv >= 20 ? 'healthy intent' : primaryConv >= 15 ? 'average' : 'low intent'
    const opportunitySummary = `${volumeDesc.charAt(0).toUpperCase() + volumeDesc.slice(1)} market (primary "${primary?.keyword || '—'}" = ${primaryClicks.toLocaleString()} clicks/mo) with ${growthDesc} growth (${yoy.toFixed(1)}% YoY) and ${convDesc} purchase signal (${primaryConv.toFixed(1)}% conversion). ${deepScore >= 7 ? 'Strong opportunity signal.' : deepScore >= 5 ? 'Moderate opportunity.' : 'Weak signal — examine Reddit + science before dismissing.'}`

    const scoreJustification = `Volume: ${volumeScore}/5 (${primaryClicks.toLocaleString()} clicks). Growth: ${growthBonus >= 0 ? '+' : ''}${growthBonus} (${yoy.toFixed(1)}% YoY, ${(primaryGrowth?.growth_3m_pct ?? 0).toFixed(1)}% 3m). Conversion: +${convBonus} (${primaryConv.toFixed(1)}%). Total: ${deepScore}/10. Based on ${relatedKeywords.length}/${keywords.length} keywords with data.`

    // Write datarova_enrichments
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

    await setActionStatus(sb, actionId, 'in_progress', {
      context_merge: { datarova: 'done', datarova_stats: { total_keywords: relatedKeywords.length, total_clicks: totalClicks } },
    })

    // ── STEP 2: REDDIT ────────────────────────────────────────────────────
    await setActionStatus(sb, actionId, 'in_progress', { context_merge: { reddit: 'running' } })

    const redditQueries = [
      `${candidate.ingredient_name} supplement`,
      `${candidate.ingredient_name}`,
      `${candidate.ingredient_name} benefits`,
    ]
    const redditRaw: any[] = await apifyRunSync(secrets.apify_api_token, 'trudax/reddit-scraper-lite', {
      searches: redditQueries, sort: 'relevance', time: 'year', maxItems: 50, maxPostCount: 20,
      skipComments: true, searchPosts: true, searchComments: false, searchCommunities: false, searchUsers: false,
      includeNSFW: false, proxy: { useApifyProxy: true, apifyProxyGroups: ['RESIDENTIAL'] },
    }, 180_000)

    const redditAnalysis = await analyzeRedditPosts(secrets.anthropic_api_key, candidate.ingredient_name, redditRaw)

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

    // Set source flags on candidate
    await sb.from('idea_candidates').update({
      source_datarova: true, source_reddit: true, source_count: 2,
      last_updated_at: new Date().toISOString(),
    }).eq('id', candidateId)

    await setActionStatus(sb, actionId, 'in_progress', {
      context_merge: { reddit: 'done', reddit_stats: { posts: redditRaw.length, score: redditAnalysis.reddit_score } },
    })

    // ── CHAIN TO THINK STEP ──────────────────────────────────────────────
    await invokeFunction('phase-a-think', { pending_action_id: actionId }).catch(e =>
      console.error('Failed to invoke phase-a-think:', e.message)
    )

    return new Response(JSON.stringify({ ok: true, step: 'gather', action_id: actionId, candidate_id: candidateId }), {
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('phase-a-gather error:', msg)
    try {
      const sb = svcClient()
      const body = await req.clone().json().catch(() => ({}))
      if (body.pending_action_id) {
        await setActionStatus(sb, body.pending_action_id, 'failed', { notes: `gather failed: ${msg}` })
      }
    } catch (_) { /* ignore */ }
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders },
    })
  }
})

// ── Helpers ────────────────────────────────────────────────────────────

async function generateKeywordList(apiKey: string, ingredient: string): Promise<string[]> {
  const r = await anthropicCall(apiKey, {
    model: SONNET,
    max_tokens: 1500,
    system: `You are a supplement market research keyword expansion agent for Toniiq. Given an ingredient or concept, return 25-35 Amazon-style search keywords as a JSON array of strings. Include: (1) the parent term, (2) dosage variants (e.g., "500mg", "1000mg"), (3) format variants (capsules, powder, softgels, liquid), (4) 2-3 major brand + ingredient combos (e.g., "nutricost {ingredient}"), (5) 3-5 use-case variants (e.g., "{ingredient} for sleep"), (6) 2-3 relevant combos with other ingredients, (7) if the input contains an angle phrase like "liposomal X" or "X for men", INCLUDE THE EXACT ANGLE PHRASE as a keyword so we can measure its specific demand. Return ONLY a JSON array, no commentary. No hallucinated brand names — stick to well-known supplement brands (Nutricost, NOW Foods, Life Extension, Thorne, Doctor's Best, Sports Research).`,
    messages: [{ role: 'user', content: `Ingredient/concept: "${ingredient}"` }],
  })
  const text = extractText(r)
  try {
    const arr = extractJson<string[]>(text)
    if (!Array.isArray(arr)) throw new Error('not an array')
    const cleaned = arr.map(k => String(k).trim()).filter(k => k.length > 0 && k.length < 100).slice(0, 40)
    if (cleaned.length === 0) throw new Error('empty after cleaning')
    return cleaned
  } catch (e) {
    // Fallback: basic expansion
    return [ingredient, `${ingredient} supplement`, `${ingredient} capsules`, `${ingredient} powder`, `${ingredient} 500mg`, `${ingredient} 1000mg`, `${ingredient} benefits`]
  }
}

async function analyzeRedditPosts(apiKey: string, ingredient: string, posts: any[]): Promise<any> {
  // Compact posts to title + body (truncated) + community + upvotes + URL
  const compact = posts.slice(0, 50).map(p => ({
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
    // Minimal fallback so the pipeline doesn't die
    return {
      estimated_monthly_posts: 0, sentiment_ratio: 50, formats_discussed: [], combos_discussed: [],
      dosages_discussed: [], pain_points: [], use_cases: [], brand_landscape: [],
      underserved_needs: [], safety_concerns: [], efficacy_skepticism: 'parse error',
      reddit_score: 3, score_justification: `LLM parse error: ${(e as Error).message}`,
      concept_suggestions: [],
    }
  }
}
