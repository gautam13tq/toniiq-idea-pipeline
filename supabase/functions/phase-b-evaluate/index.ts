/**
 * phase-b-evaluate v5.1 — hybrid competitive scoring for an accepted concept.
 *
 * v5.1 (2026-05-23) corrections over v5 first-ship:
 *   - Differentiation pillar redesigned to "vectors-available": score the
 *     NICHE's room for Toniiq's 6 playbook vectors, NOT the concept's
 *     placeholder spec. (v5 first-ship scored against concept.target_dosage
 *     etc., which at evaluation stage is just a sketch.)
 *   - INGREDIENT_SPEC_PRIMER inline in the differentiation prompt to prevent
 *     the "500mg cayenne = 500mg capsaicin" lethal-dose hallucination class.
 *   - Differentiation model: Sonnet (was briefly Opus during v5.1 build,
 *     but Opus pushed total runtime past the 6.67-min edge-function limit).
 *   - Database dispatcher (_invoke_phase_b_evaluate) now sends an
 *     Authorization header from the supabase_anon_jwt vault secret. Without
 *     it, verify_jwt=true caused every dispatched call to 401 immediately.
 *
 * Pipeline (~90s end-to-end on Sonnet):
 *   1. Frame inference (Sonnet) — pick broad_hero vs strict_modifier, hero
 *      ingredient, delivery modifier (if any), 4-8 buyer-style queries.
 *   2. Datarova demand packet — 12-month keyword market for the query packet
 *      with growth windows (3m/6m/12m) and weighted conversion.
 *   3. Apify Axesso discovery + Keepa /product enrichment (via shared
 *      _shared/hybrid_scoring.ts) → classified competitor set (included /
 *      adjacent / excluded), bucket-driven by the frame.
 *   4. Quality gate — refuses to publish a composite when:
 *        - Datarova rows insufficient for primary keyword (< 100 monthly clicks
 *          or < 5 keyword rows with click data); → quality_gate_status=failed_demand
 *        - included competitor count below 5 for broad_hero or 3 for strict_modifier,
 *          OR < 80% have Keepa data → quality_gate_status=failed_competitive
 *   5. Pillar scores —
 *        - Market Demand & Intent (20%)
 *        - Market Growth (15%) with per-window breakdown (3m/6m/12m, 40/30/30)
 *        - Competitive Landscape (35%) — weighted sum of 7 sub-signals
 *        - Toniiq Differentiation (30%) — Sonnet over the 6 vectors-available,
 *          scoring the niche's room (not the concept's spec)
 *   6. Competition gate — caps composite/tier when review-moat, spec-wedge,
 *      BSR, premium-tier, or strict_modifier counts are weak.
 *   7. Persist concept_scores with composite + all pillar breakdowns + frame +
 *      data quality summary + diff_vector_details. Only AFTER successful insert
 *      and verification read-back do we set concept.status = 'evaluated'.
 *
 * DATA INTEGRITY: every numeric score traces to a real Apify run, Keepa
 * /product call, or Datarova response. The quality gate is the explicit
 * mechanism that prevents fabricated composites — if data is too thin, the
 * pending_action is marked failed with a clear reason. NO TIER 1 estimates.
 *
 * Replaces v1 (commit 84c73aa). v1 wrote scores even when Apify's shallow
 * search returned no monthly-sold badges; the rev/review ratio defaulted to
 * an arbitrary midpoint and composite_score was meaningless. v1's TikTok
 * branch is dropped entirely — too noisy, too memory-hungry, and not a
 * data-quality signal we can rely on.
 *
 * Writes:
 *   - concept_scores (v5 columns: competitive_frame, pillar_*, competition_gate,
 *     quality_gate_status, data_quality_summary, scoring_version)
 *   - concept_competitive_research (Keepa-enriched competitor snapshot,
 *     replaces the old Apify-only snapshot)
 *   - concept_google_trends — DEPRECATED but still written with a stub
 *     pointing to Datarova as the new growth source (preserves the FK so
 *     existing UI doesn't break).
 *   - concept_tiktok_research — NOT written. Table preserved for history.
 *
 * Pending_action context tracks step-by-step progress for debugging.
 */

import { corsHeaders } from '../_shared/cors.ts'
import {
  svcClient, loadSecrets, anthropicCall, datarovaKeywords,
  extractText, extractJson, SONNET, OPUS, setActionStatus,
} from '../_shared/clients.ts'
import {
  runHybridQuery, HybridFrame, HybridAggregate, HybridProduct,
  clamp, n, normalize, percentile,
} from '../_shared/hybrid_scoring.ts'

const SCORING_VERSION = 'phase-b-v5-hybrid-competitive'
const DEFAULT_KEEP_ASINS = 40
const KEEPA_TOKEN_WAIT_MS = 60_000

type RecommendationTier = 'launch_priority' | 'strong_candidate' | 'watchlist' | 'needs_work' | 'pass'

const TIER_ORDER: Record<RecommendationTier, number> = {
  pass: 0, needs_work: 1, watchlist: 2, strong_candidate: 3, launch_priority: 4,
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  let actionId: string | undefined
  try {
    const body = await req.json().catch(() => ({}))
    const sb = svcClient()
    const secrets = await loadSecrets(sb)
    const keepaKey = await loadKeepaKey(sb)

    actionId = body.pending_action_id
    const conceptId = body.concept_id

    let resolvedActionId = actionId
    let resolvedConceptId = conceptId
    if (!resolvedActionId && resolvedConceptId) {
      const { data } = await sb.from('pending_actions').insert({
        entity_type: 'concept', entity_id: resolvedConceptId, action: 'run_phase_b',
        triggered_by: 'llm', status: 'pending', context: {},
      }).select('id').single()
      resolvedActionId = data!.id
    }
    if (!resolvedActionId) {
      return new Response(JSON.stringify({ error: 'pending_action_id or concept_id required' }), {
        status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders },
      })
    }
    actionId = resolvedActionId

    // Fetch action + concept + candidate
    const { data: action, error: aErr } = await sb.from('pending_actions').select('*').eq('id', resolvedActionId).single()
    if (aErr || !action) throw new Error(`Action not found: ${aErr?.message}`)
    resolvedConceptId = action.entity_id
    const { data: concept, error: cErr } = await sb.from('product_concepts').select('*').eq('id', resolvedConceptId).single()
    if (cErr || !concept) throw new Error(`Concept not found: ${cErr?.message}`)
    const { data: candidate } = await sb.from('idea_candidates').select('ingredient_name,category,subcategory').eq('id', concept.candidate_id).single()
    const ingredientName = candidate?.ingredient_name || concept.concept_name

    await setActionStatus(sb, resolvedActionId, 'in_progress', {
      notes: `Evaluating "${concept.concept_name}" (v5 hybrid)`,
      context_merge: {
        phase_b_started: new Date().toISOString(),
        concept_name: concept.concept_name,
        scoring_version: SCORING_VERSION,
      },
    })

    // Watchdog: fail any other in_progress run_phase_b for this concept older than 5 min
    await sb.from('pending_actions').update({
      status: 'failed', completed_at: new Date().toISOString(),
      notes: `Auto-failed by watchdog: superseded by new run_phase_b (${resolvedActionId})`,
    })
      .eq('entity_id', resolvedConceptId).eq('action', 'run_phase_b').eq('status', 'in_progress')
      .neq('id', resolvedActionId)
      .lt('started_at', new Date(Date.now() - 5 * 60 * 1000).toISOString())

    // ── STEP 1: FRAME INFERENCE ──────────────────────────────────────────
    await setActionStatus(sb, resolvedActionId, 'in_progress', { context_merge: { step: 'frame_inference' } })
    const frame = await inferCompetitiveFrame(secrets.anthropic_api_key, concept, ingredientName, candidate)
    await setActionStatus(sb, resolvedActionId, 'in_progress', {
      context_merge: {
        step: 'frame_done',
        frame_summary: { frame: frame.frame, hero: frame.hero_ingredient, modifier: frame.delivery_modifier || null, queries: frame.query_packet.length },
      },
    })

    // ── STEP 2: DEMAND PACKET (Datarova) ──────────────────────────────────
    await setActionStatus(sb, resolvedActionId, 'in_progress', { context_merge: { step: 'datarova' } })
    const demandPacket = await fetchDatarovaPacket(secrets.datarova_api_key, frame)
    await setActionStatus(sb, resolvedActionId, 'in_progress', {
      context_merge: {
        step: 'datarova_done',
        demand_summary: {
          rows: demandPacket.rows.length,
          primary_clicks: demandPacket.primary_keyword_clicks,
          market_growth_12m: demandPacket.growth_12m_pct,
        },
      },
    })

    // ── STEP 3: HYBRID DISCOVERY + KEEPA ENRICHMENT ──────────────────────
    await setActionStatus(sb, resolvedActionId, 'in_progress', { context_merge: { step: 'hybrid_discovery' } })
    const enrichment = await runHybridQuery(frame, secrets.apify_api_token, keepaKey, DEFAULT_KEEP_ASINS, KEEPA_TOKEN_WAIT_MS)
    const auditProducts = enrichment.audit_products || []
    const included = auditProducts.filter(p => p.bucket === 'included')
    const adjacent = auditProducts.filter(p => p.bucket === 'adjacent')
    const excluded = auditProducts.filter(p => p.bucket === 'excluded')
    await setActionStatus(sb, resolvedActionId, 'in_progress', {
      context_merge: {
        step: 'hybrid_done',
        competitor_summary: {
          discovered: (enrichment.result_quality as any)?.discovery_result_count || 0,
          included: included.length,
          adjacent: adjacent.length,
          excluded: excluded.length,
          monthly_sold_coverage: enrichment.monthly_sold_coverage,
          keepa_tokens: enrichment.tokens_consumed,
        },
      },
    })

    // ── STEP 4: QUALITY GATE ─────────────────────────────────────────────
    const gate = qualityGate(frame, demandPacket, enrichment, included)
    if (gate.status !== 'passed') {
      // Persist enrichment data and frame even on quality-gate failure so the
      // audit trail is visible; mark the row with no composite_score so the
      // concept doesn't get promoted to status='evaluated'.
      await writeCompetitiveResearch(sb, resolvedConceptId, frame, demandPacket, enrichment, auditProducts)
      await sb.from('concept_scores').insert({
        concept_id: resolvedConceptId,
        scoring_version: SCORING_VERSION,
        competitive_frame: frame,
        composite_score: null,
        recommendation_tier: 'pass',
        quality_gate_status: gate.status,
        data_quality_summary: gate.summary,
        overall_assessment: `Quality gate failed: ${gate.reason}. No composite score published.`,
        scored_at: new Date().toISOString(),
      })
      await setActionStatus(sb, resolvedActionId, 'failed', {
        notes: `Quality gate ${gate.status}: ${gate.reason}`,
        context_merge: { quality_gate: gate, completed_at: new Date().toISOString() },
      })
      return new Response(JSON.stringify({ ok: false, quality_gate: gate.status, reason: gate.reason }), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders }, status: 200,
      })
    }
    await setActionStatus(sb, resolvedActionId, 'in_progress', { context_merge: { step: 'gate_passed' } })

    // ── STEP 5: PILLAR SCORES ────────────────────────────────────────────
    const demandPillar = computeDemandPillar(demandPacket)
    const growthPillar = computeGrowthPillar(demandPacket)
    const competitivePillar = computeCompetitivePillar(included, enrichment, concept)

    await setActionStatus(sb, resolvedActionId, 'in_progress', { context_merge: { step: 'differentiation' } })
    const diffPillar = await runDifferentiation(secrets.anthropic_api_key, concept, ingredientName, frame, included, enrichment)
    await setActionStatus(sb, resolvedActionId, 'in_progress', {
      context_merge: {
        step: 'differentiation_done',
        diff_summary: { score: diffPillar.score, total: diffPillar.vector_total },
      },
    })

    // ── STEP 6: COMPOSITE + COMPETITION GATE ─────────────────────────────
    const weights = { demand: 0.20, growth: 0.15, competitive: 0.35, differentiation: 0.30 }
    let rawComposite = (
      demandPillar.score * weights.demand +
      growthPillar.score * weights.growth +
      competitivePillar.score * weights.competitive +
      diffPillar.score * weights.differentiation
    ) * 10

    const competitionGateResult = applyCompetitionGate(competitivePillar, frame, included, concept)
    const cappedComposite = Math.min(rawComposite, competitionGateResult.composite_cap)
    const naiveTier = labelForScore(cappedComposite)
    const cappedTier = capTier(naiveTier, competitionGateResult.tier_cap)

    if (!Number.isFinite(cappedComposite)) {
      throw new Error(`composite_score not finite (raw=${rawComposite}, cap=${competitionGateResult.composite_cap})`)
    }

    // ── STEP 7: PERSIST ──────────────────────────────────────────────────
    await writeCompetitiveResearch(sb, resolvedConceptId, frame, demandPacket, enrichment, auditProducts)
    // Write a stub trends row for FK preservation; growth pillar lives in concept_scores now.
    await writeGoogleTrendsStub(sb, resolvedConceptId, demandPacket, growthPillar)

    const { error: scoreErr } = await sb.from('concept_scores').insert({
      concept_id: resolvedConceptId,
      scoring_version: SCORING_VERSION,
      // v5 fields
      competitive_frame: frame,
      pillar_demand_score: demandPillar.score,
      pillar_growth_score: growthPillar.score,
      pillar_growth_details: growthPillar.details,
      pillar_competitive_score: competitivePillar.score,
      pillar_competitive_subsignals: competitivePillar.subsignals,
      pillar_diff_score: diffPillar.score,
      competition_gate: competitionGateResult,
      quality_gate_status: 'passed',
      data_quality_summary: gate.summary,
      // Composite
      composite_score: Number(cappedComposite.toFixed(2)),
      composite_weights: weights,
      recommendation_tier: cappedTier,
      overall_assessment: buildAssessment(frame, cappedComposite, cappedTier, demandPillar, growthPillar, competitivePillar, diffPillar, competitionGateResult),
      opportunity_signals: buildOpportunitySignals(demandPillar, growthPillar, competitivePillar, diffPillar),
      risk_factors: buildRiskFactors(demandPillar, growthPillar, competitivePillar, competitionGateResult),
      next_steps: buildNextSteps(cappedTier),
      // Legacy v1 columns (kept for backward compat with existing UI components)
      amazon_competitive_score: Math.round(competitivePillar.score),
      tiktok_score: null,
      google_trends_score: Math.round(growthPillar.score),
      differentiation_score: Math.round(diffPillar.score),
      keyword_demand_score: Math.round(demandPillar.score),
      diff_vectors_available: diffPillar.vectors_available,
      diff_competitive_gap: diffPillar.competitive_gap,
      diff_form_factor_fit: diffPillar.form_factor_fit,
      diff_pricing_headroom: diffPillar.pricing_headroom,
      diff_total: diffPillar.vector_total,
      diff_vector_details: diffPillar.vector_details,
      scored_at: new Date().toISOString(),
    })
    if (scoreErr) throw new Error(`concept_scores insert failed: ${scoreErr.message}`)

    // Verify read-back
    const { data: verify } = await sb.from('concept_scores').select('composite_score, quality_gate_status')
      .eq('concept_id', resolvedConceptId).order('scored_at', { ascending: false }).limit(1).maybeSingle()
    if (!verify || verify.composite_score == null || verify.quality_gate_status !== 'passed') {
      throw new Error(`concept_scores read-back failed: ${JSON.stringify(verify)}`)
    }

    await sb.from('product_concepts').update({
      status: 'evaluated', decided_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }).eq('id', resolvedConceptId)

    await setActionStatus(sb, resolvedActionId, 'completed', {
      notes: `Phase B v5 complete. Composite ${cappedComposite.toFixed(1)} (${cappedTier}). Frame: ${frame.frame}/${frame.hero_ingredient}.`,
      context_merge: {
        composite_score: cappedComposite, tier: cappedTier, frame_summary: frame,
        completed_at: new Date().toISOString(),
      },
    })

    return new Response(JSON.stringify({
      ok: true, concept_id: resolvedConceptId,
      composite: Number(cappedComposite.toFixed(2)),
      tier: cappedTier,
      frame: { frame: frame.frame, hero: frame.hero_ingredient, modifier: frame.delivery_modifier },
      pillars: {
        demand: demandPillar.score,
        growth: growthPillar.score,
        competitive: competitivePillar.score,
        differentiation: diffPillar.score,
      },
      gate: competitionGateResult,
      data_quality: gate.summary,
    }), { headers: { 'Content-Type': 'application/json', ...corsHeaders } })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('phase-b-evaluate v5 error:', msg)
    if (actionId) {
      try {
        const sb = svcClient()
        await setActionStatus(sb, actionId, 'failed', { notes: `evaluate failed: ${msg}` })
      } catch (_) { /* ignore */ }
    }
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders },
    })
  }
})

// ═══════════════════════════════════════════════════════════════════════
// STEP 1: FRAME INFERENCE
// ═══════════════════════════════════════════════════════════════════════

async function inferCompetitiveFrame(apiKey: string, concept: any, ingredientName: string, candidate: any): Promise<HybridFrame> {
  const r = await anthropicCall(apiKey, {
    model: SONNET,
    max_tokens: 1500,
    system: `You are a competitive frame analyst for Toniiq supplement product development. Your job: given a product concept, determine the correct competitive frame and produce a query packet for Amazon competitor discovery.

THE TWO FRAMES:
- broad_hero — the hero ingredient defines the competitive lane. Includes single-ingredient products of the hero AND multi-active complexes where the hero is the undisputed lead (named prominently in title, dosed as primary).
- strict_modifier — delivery technology IS the differentiation. Liposomal / phytosome / micellar / enhanced-absorption qualifier on a hero ingredient. Must have BOTH hero + delivery modifier in the title.

Examples:
- "Liposomal Astaxanthin" → strict_modifier, hero=astaxanthin, modifier=liposomal
- "Quercefit 5-in-1" → strict_modifier, hero=quercetin, modifier=phytosome (Quercefit IS the phytosome form of quercetin)
- "Cayenne + MCT Thermogenic Softgels" → broad_hero, hero=cayenne (MCT is positioning within the lane, not a delivery modifier)
- "Nattokinase 5-in-1" → broad_hero, hero=nattokinase
- "Dandelion Root Extract 10:1" → broad_hero, hero=dandelion root
- "S. boulardii 30B" → broad_hero, hero=saccharomyces boulardii

QUERY PACKET (4-8 buyer-style search queries):
- Include the bare hero ingredient, "hero supplement", and meaningful variants buyers actually search.
- For strict_modifier: queries MUST combine hero + modifier (e.g. "liposomal astaxanthin", "astaxanthin liposomal").
- Do NOT include "premium", "best", brand names, or pet/topical/food variants.
- Keep queries short and natural (2-4 words).

INCLUSION RULES: list the title tokens that classify a product as "in lane" (default: [hero]).
EXCLUSION RULES: list tokens that exclude (pets, topical, food, wrong category).
REASONING: 1-2 sentences explaining your call.

Return STRICT JSON (no markdown, no commentary):
{
  "frame": "broad_hero" | "strict_modifier",
  "hero_ingredient": "...",
  "delivery_modifier": "..." or null,
  "primary_lane_query": "...",
  "query_packet": ["...", "...", ...],
  "inclusion_rules": ["..."],
  "exclusion_rules": ["..."],
  "reasoning": "..."
}`,
    messages: [{
      role: 'user',
      content: `Concept: "${concept.concept_name}"
Ingredient: "${ingredientName}"
Category: ${candidate?.category || '(unknown)'} / ${candidate?.subcategory || '(unknown)'}
Format: ${concept.format || '(unknown)'}
Target dosage: ${concept.target_dosage || '(unknown)'}
Positioning: ${concept.positioning_angle || '(none)'}
Key ingredients: ${JSON.stringify(concept.key_ingredients || [])}`,
    }],
  })
  const text = extractText(r)
  const parsed = extractJson<any>(text)
  // Build HybridFrame
  const heroIngredient = String(parsed.hero_ingredient || ingredientName).trim()
  const modifier = parsed.delivery_modifier ? String(parsed.delivery_modifier).trim() : undefined
  const frame: HybridFrame = {
    frame: parsed.frame === 'strict_modifier' ? 'strict_modifier' : 'broad_hero',
    hero_ingredient: heroIngredient,
    delivery_modifier: modifier,
    query_packet: Array.isArray(parsed.query_packet) ? parsed.query_packet.map((q: any) => String(q || '').trim()).filter(Boolean).slice(0, 8) : [],
    include_terms: Array.isArray(parsed.inclusion_rules) && parsed.inclusion_rules.length > 0
      ? parsed.inclusion_rules.map((t: any) => String(t || '').trim()).filter(Boolean)
      : [heroIngredient],
    require_any: modifier ? [modifier] : [],
    exclude_terms: Array.isArray(parsed.exclusion_rules)
      ? parsed.exclusion_rules.map((t: any) => String(t || '').trim()).filter(Boolean)
      : [],
    stack_terms: [],
  }
  // Attach reasoning + primary_lane_query for audit trail (extra fields on frame object)
  ;(frame as any).reasoning = String(parsed.reasoning || '').slice(0, 600)
  ;(frame as any).primary_lane_query = String(parsed.primary_lane_query || frame.query_packet[0] || heroIngredient)
  return frame
}

// ═══════════════════════════════════════════════════════════════════════
// STEP 2: DATAROVA DEMAND PACKET
// ═══════════════════════════════════════════════════════════════════════

interface DemandPacket {
  source: 'datarova' | 'fallback'
  queries: string[]
  rows: Array<{
    keyword: string
    monthly_records: Array<{ month: string; clicks: number; sales: number }>
    latest_clicks: number
    latest_sales: number
    weighted_conversion_pct: number | null
  }>
  primary_keyword: string | null
  primary_keyword_clicks: number | null
  primary_keyword_sales: number | null
  total_clicks: number | null
  total_sales: number | null
  weighted_conversion_pct: number | null
  growth_3m_pct: number | null
  growth_6m_pct: number | null
  growth_12m_pct: number | null
  latest_month: string | null
  baseline_month: string | null
  total_monthly_data_points: number
  error?: string
}

function monthKey(date: Date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-01`
}

function addMonths(date: Date, offset: number) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + offset, 1))
}

function latestCompleteMonth() {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))
}

async function fetchDatarovaPacket(apiKey: string, frame: HybridFrame): Promise<DemandPacket> {
  const queries = [...new Set(frame.query_packet.map(q => normalize(q)).filter(Boolean))].slice(0, 12)
  const empty = (error?: string): DemandPacket => ({
    source: 'fallback', queries,
    rows: [],
    primary_keyword: null, primary_keyword_clicks: null, primary_keyword_sales: null,
    total_clicks: null, total_sales: null, weighted_conversion_pct: null,
    growth_3m_pct: null, growth_6m_pct: null, growth_12m_pct: null,
    latest_month: null, baseline_month: null, total_monthly_data_points: 0,
    error,
  })
  if (!queries.length) return empty('empty_query_packet')

  try {
    const end = latestCompleteMonth()
    const start = addMonths(end, -12)
    const records = await datarovaKeywords(apiKey, {
      keywords: queries,
      start: monthKey(start),
      end: monthKey(end),
      marketplace: 'US',
    })

    const rows = records.map((item: any) => {
      const keyword = String(item.keyword || '').trim()
      const sorted = [...(item.records || [])]
        .filter((r: any) => (r.start_date || r.date))
        .sort((a: any, b: any) => String(a.start_date || a.date).localeCompare(String(b.start_date || b.date)))
      const monthly_records = sorted.map((r: any) => ({
        month: String(r.start_date || r.date).slice(0, 10),
        clicks: n(r.clicks),
        sales: n(r.sales),
      }))
      const latest = [...monthly_records].reverse().find(r => r.clicks > 0 || r.sales > 0) || monthly_records.at(-1)
      const totalClicks = monthly_records.reduce((s, r) => s + r.clicks, 0)
      const totalSales = monthly_records.reduce((s, r) => s + r.sales, 0)
      return {
        keyword,
        monthly_records,
        latest_clicks: latest?.clicks || 0,
        latest_sales: latest?.sales || 0,
        weighted_conversion_pct: totalClicks > 0 ? Number(((totalSales / totalClicks) * 100).toFixed(1)) : null,
      }
    }).filter(r => r.keyword && (r.latest_clicks > 0 || r.latest_sales > 0))

    // Aggregate monthly totals across rows
    const monthTotals = new Map<string, { clicks: number; sales: number }>()
    for (const row of rows) {
      for (const m of row.monthly_records) {
        const cur = monthTotals.get(m.month) || { clicks: 0, sales: 0 }
        cur.clicks += m.clicks
        cur.sales += m.sales
        monthTotals.set(m.month, cur)
      }
    }
    const months = [...monthTotals.keys()].sort()
    const latestMonth = [...months].reverse().find(m => (monthTotals.get(m)?.clicks || 0) > 0) || months.at(-1) || null
    const latestIdx = latestMonth ? months.indexOf(latestMonth) : -1
    const latestTotals = latestMonth ? monthTotals.get(latestMonth) : null

    const windowGrowth = (windowMonths: number): number | null => {
      if (latestIdx < windowMonths) return null
      const recent = months.slice(latestIdx - windowMonths + 1, latestIdx + 1)
      const prior = months.slice(Math.max(0, latestIdx - 2 * windowMonths + 1), latestIdx - windowMonths + 1)
      if (!recent.length || !prior.length) return null
      const recentAvg = recent.reduce((s, m) => s + (monthTotals.get(m)?.clicks || 0), 0) / recent.length
      const priorAvg = prior.reduce((s, m) => s + (monthTotals.get(m)?.clicks || 0), 0) / prior.length
      if (priorAvg <= 0) return null
      return Number((((recentAvg - priorAvg) / priorAvg) * 100).toFixed(1))
    }

    const yoyGrowth = (): number | null => {
      if (!latestMonth || latestIdx < 12) return null
      const latestClicks = monthTotals.get(latestMonth)?.clicks || 0
      const baselineMonth = months[latestIdx - 12]
      const baselineClicks = monthTotals.get(baselineMonth)?.clicks || 0
      if (baselineClicks <= 0) return null
      return Number((((latestClicks - baselineClicks) / baselineClicks) * 100).toFixed(1))
    }

    const baselineMonth = (latestMonth && latestIdx >= 12) ? months[latestIdx - 12] : (months[0] || null)

    const primary = [...rows].sort((a, b) => b.latest_clicks - a.latest_clicks)[0] || null
    const totalClicks = latestTotals?.clicks || 0
    const totalSales = latestTotals?.sales || 0

    return {
      source: 'datarova', queries, rows,
      primary_keyword: primary?.keyword || null,
      primary_keyword_clicks: primary?.latest_clicks ?? null,
      primary_keyword_sales: primary?.latest_sales ?? null,
      total_clicks: totalClicks || null,
      total_sales: totalSales || null,
      weighted_conversion_pct: totalClicks > 0 ? Number(((totalSales / totalClicks) * 100).toFixed(1)) : null,
      growth_3m_pct: windowGrowth(3),
      growth_6m_pct: windowGrowth(6),
      growth_12m_pct: yoyGrowth(),
      latest_month: latestMonth,
      baseline_month: baselineMonth,
      total_monthly_data_points: months.length,
    }
  } catch (err) {
    return empty(err instanceof Error ? err.message.slice(0, 300) : String(err).slice(0, 300))
  }
}

// ═══════════════════════════════════════════════════════════════════════
// STEP 4: QUALITY GATE
// ═══════════════════════════════════════════════════════════════════════

type QualityStatus = 'passed' | 'failed_demand' | 'failed_competitive' | 'failed_frame'

interface QualityGateResult {
  status: QualityStatus
  reason: string
  summary: any
}

function qualityGate(frame: HybridFrame, demand: DemandPacket, enrichment: HybridAggregate, included: HybridProduct[]): QualityGateResult {
  const minIncluded = frame.frame === 'strict_modifier' ? 3 : 5
  const keepaCoveredIncluded = included.filter(p =>
    (p.bsr_current || p.bsr_avg30) != null && p.reviews > 0 && (p.price || 0) > 0
  )
  const monthlySoldCovered = included.filter(p => p.monthly_sold > 0)
  const keepaCoveragePct = included.length > 0 ? keepaCoveredIncluded.length / included.length : 0
  const monthlySoldCoveragePct = included.length > 0 ? monthlySoldCovered.length / included.length : 0

  const demandRowsWithData = demand.rows.filter(r => r.latest_clicks > 0).length
  const primaryClicks = demand.primary_keyword_clicks || 0

  const summary = {
    frame: frame.frame, hero: frame.hero_ingredient, modifier: frame.delivery_modifier || null,
    discovery_result_count: (enrichment.result_quality as any)?.discovery_result_count || 0,
    included_count: included.length,
    adjacent_count: ((enrichment.result_quality as any)?.adjacent_count || 0),
    excluded_count: ((enrichment.result_quality as any)?.excluded_count || 0),
    keepa_coverage_count: keepaCoveredIncluded.length,
    keepa_coverage_pct: Number((keepaCoveragePct * 100).toFixed(1)),
    monthly_sold_badge_count: monthlySoldCovered.length,
    monthly_sold_badge_pct: Number((monthlySoldCoveragePct * 100).toFixed(1)),
    demand_source: demand.source,
    demand_rows_with_data: demandRowsWithData,
    demand_primary_clicks: primaryClicks,
    demand_total_monthly_data_points: demand.total_monthly_data_points,
    keepa_tokens_consumed: enrichment.tokens_consumed,
    min_included_required: minIncluded,
  }

  // Demand gate
  //
  // Default: ≥5 keyword rows with click data AND primary keyword ≥100 clicks.
  // Niche-strain exception: if the primary keyword is strong (≥1,000 clicks)
  // we accept ≥2 rows with click data. This catches concepts like
  // "S. boulardii 30B" where Datarova tracks the parent term densely but
  // siblings sparsely — the primary signal is unambiguous so we don't punish
  // the concept for the narrowness of the surrounding cluster.
  if (demand.source !== 'datarova') {
    return { status: 'failed_demand', reason: `Datarova demand packet unavailable (source=${demand.source}, error=${demand.error || 'unknown'})`, summary }
  }
  if (primaryClicks < 100) {
    return { status: 'failed_demand', reason: `Demand data insufficient: primary keyword "${demand.primary_keyword}" only ${primaryClicks} monthly clicks (need ≥100)`, summary }
  }
  const strongPrimary = primaryClicks >= 1000
  if (demandRowsWithData < 5 && !(strongPrimary && demandRowsWithData >= 2)) {
    return {
      status: 'failed_demand',
      reason: `Demand data insufficient: ${demandRowsWithData} Datarova rows with click data, primary keyword ${primaryClicks} clicks (need ≥5 rows, OR ≥2 rows when primary keyword ≥1,000 clicks)`,
      summary,
    }
  }

  // Competitive gate
  if (included.length < minIncluded) {
    return { status: 'failed_competitive', reason: `Competitive data insufficient: ${included.length}/${minIncluded} included competitors after classification (frame=${frame.frame})`, summary }
  }
  if (keepaCoveragePct < 0.8) {
    return { status: 'failed_competitive', reason: `Competitive data insufficient: only ${keepaCoveredIncluded.length}/${included.length} (${(keepaCoveragePct * 100).toFixed(0)}%) included competitors have Keepa BSR/reviews/price data (need ≥80%)`, summary }
  }

  return { status: 'passed', reason: 'all gates passed', summary }
}

// ═══════════════════════════════════════════════════════════════════════
// STEP 5: PILLAR SCORES
// ═══════════════════════════════════════════════════════════════════════

interface PillarResult {
  score: number  // 0-10
  details?: any
  subsignals?: any
}

function computeDemandPillar(demand: DemandPacket): PillarResult {
  // Primary keyword clicks tier: 0-4 pts
  const clicks = demand.primary_keyword_clicks || 0
  let clicksPts = 0
  if (clicks >= 100_000) clicksPts = 4
  else if (clicks >= 10_000) clicksPts = 3
  else if (clicks >= 1_000) clicksPts = 2
  else if (clicks >= 100) clicksPts = 1

  // Aggregate cluster volume (sum of latest clicks across rows): 0-3 pts
  const aggClicks = demand.rows.reduce((s, r) => s + r.latest_clicks, 0)
  let aggPts = 0
  if (aggClicks >= 200_000) aggPts = 3
  else if (aggClicks >= 50_000) aggPts = 2
  else if (aggClicks >= 10_000) aggPts = 1

  // Conversion intent: 0-3 pts
  const cvr = demand.weighted_conversion_pct || 0
  let cvrPts = 0
  if (cvr >= 30) cvrPts = 3
  else if (cvr >= 20) cvrPts = 2
  else if (cvr >= 15) cvrPts = 1

  const score = clicksPts + aggPts + cvrPts  // max 10
  return {
    score,
    details: {
      primary_clicks: clicks,
      primary_clicks_pts: clicksPts,
      aggregate_cluster_clicks: aggClicks,
      aggregate_cluster_pts: aggPts,
      weighted_conversion_pct: cvr,
      conversion_pts: cvrPts,
    },
  }
}

function computeGrowthPillar(demand: DemandPacket): PillarResult {
  const mapWindow = (pct: number | null): number => {
    if (pct === null) return 4  // unknown defaults to neutral-positive
    if (pct > 100) return 10
    if (pct > 50) return 8
    if (pct > 20) return 6
    if (pct > 0) return 4
    if (pct > -20) return 2
    return 0
  }
  const w3 = mapWindow(demand.growth_3m_pct)
  const w6 = mapWindow(demand.growth_6m_pct)
  const w12 = mapWindow(demand.growth_12m_pct)
  // Weighted: 3m 40%, 6m 30%, 12m 30%
  const score = (w3 * 0.40) + (w6 * 0.30) + (w12 * 0.30)

  // Trajectory shape
  let shape = 'unknown'
  const g3 = demand.growth_3m_pct ?? 0
  const g6 = demand.growth_6m_pct ?? 0
  const g12 = demand.growth_12m_pct ?? 0
  if (g3 > 20 && g6 > 20 && g12 > 20) shape = 'consistent strong growth'
  else if (g12 > 50 && g3 < 10) shape = 'long-term explosive but recent flattening'
  else if (g12 < 0 && g3 > 20) shape = 'recent rebound from decline'
  else if (g3 < -10 && g6 < -10 && g12 < -10) shape = 'consistent decline'
  else if (Math.abs(g3) < 10 && Math.abs(g6) < 10 && Math.abs(g12) < 10) shape = 'stable mature market'
  else if (g12 > 0 && g3 > 0) shape = 'growth with variance'
  else if (g12 < 0 && g3 < 0) shape = 'declining'
  else shape = 'mixed signals'

  return {
    score: Number(score.toFixed(2)),
    details: {
      growth_3m_pct: demand.growth_3m_pct,
      growth_6m_pct: demand.growth_6m_pct,
      growth_12m_pct: demand.growth_12m_pct,
      window_scores: { w3, w6, w12 },
      window_weights: { w3: 0.40, w6: 0.30, w12: 0.30 },
      trajectory_shape: shape,
      latest_month: demand.latest_month,
      baseline_month: demand.baseline_month,
    },
  }
}

function computeCompetitivePillar(included: HybridProduct[], enrichment: HybridAggregate, concept: any): PillarResult {
  // ── 7 sub-signals, each 0-10 ────────────────────────────────────────────
  // 1. Review moat distribution (25% of pillar)
  const reviews = included.map(p => p.reviews).filter(r => r > 0).sort((a, b) => a - b)
  const reviewP50 = percentile(reviews, 0.5) || 0
  const reviewP90 = percentile(reviews, 0.9) || 0
  const reviewMax = reviews.length ? Math.max(...reviews) : 0
  // Lower moat (smaller p50/p90) = higher score (more attackable). p50 < 500 → 10, p50 > 50k → 0
  const logScale = (val: number, lo: number, hi: number): number => {
    if (val <= 0) return 10
    const logVal = Math.log10(val)
    const logLo = Math.log10(lo)
    const logHi = Math.log10(hi)
    return clamp(10 - ((logVal - logLo) / (logHi - logLo)) * 10, 0, 10)
  }
  const reviewMoatScore = (logScale(reviewP50, 500, 50_000) * 0.55) + (logScale(reviewP90, 1_000, 100_000) * 0.25) + (logScale(reviewMax, 2_000, 200_000) * 0.20)

  // 2. Revenue/Review efficiency ratio (20%)
  // monthly_sold * price / reviews; high ratio = healthy velocity, low ratio = mature/saturated
  const ratios: number[] = []
  for (const p of included) {
    if (p.monthly_sold > 0 && (p.price || 0) > 0 && p.reviews > 0) {
      ratios.push((p.monthly_sold * (p.price || 0)) / p.reviews)
    }
  }
  const ratioP50 = ratios.length ? percentile(ratios, 0.5) || 0 : 0
  let revReviewScore = 0
  if (ratioP50 >= 50) revReviewScore = 10
  else if (ratioP50 >= 30) revReviewScore = 8
  else if (ratioP50 >= 15) revReviewScore = 7
  else if (ratioP50 >= 8) revReviewScore = 5
  else if (ratioP50 >= 3) revReviewScore = 3
  else if (ratioP50 > 0) revReviewScore = 1
  else revReviewScore = 0  // no monthly_sold data — neutral signal handled by quality gate
  const reviewRevenueAvailable = ratios.length

  // 3. BSR concentration (15%)
  const bsrValues = included.map(p => p.bsr_current || p.bsr_avg30 || 0).filter(b => b > 0).sort((a, b) => a - b)
  const bsrBest = bsrValues.length ? bsrValues[0] : 0
  // Locked-up top (best BSR < 200) = low score; diffuse top (best > 5k) = high score
  let bsrScore = 5
  if (bsrBest === 0) bsrScore = 5
  else if (bsrBest <= 200) bsrScore = 2
  else if (bsrBest <= 1_000) bsrScore = 4
  else if (bsrBest <= 5_000) bsrScore = 6
  else if (bsrBest <= 20_000) bsrScore = 8
  else bsrScore = 10
  // top-3 cluster: avg of top 3 BSR
  const top3BsrAvg = bsrValues.length >= 3 ? (bsrValues[0] + bsrValues[1] + bsrValues[2]) / 3 : bsrBest
  if (top3BsrAvg <= 500 && bsrScore > 4) bsrScore = Math.max(3, bsrScore - 2)

  // 4. Brand concentration (10%)
  const brandsTop20 = new Set(included.slice(0, 20).map(p => normalize(p.brand)).filter(Boolean))
  const distinctBrands = brandsTop20.size
  // Compute top brand share (% of monthly_sold or reviews captured by top brand)
  const brandSales = new Map<string, number>()
  for (const p of included.slice(0, 20)) {
    const b = normalize(p.brand)
    if (!b) continue
    const weight = p.monthly_sold > 0 ? p.monthly_sold : p.reviews
    brandSales.set(b, (brandSales.get(b) || 0) + weight)
  }
  const totalWeight = [...brandSales.values()].reduce((s, w) => s + w, 0)
  const topBrandWeight = [...brandSales.values()].sort((a, b) => b - a)[0] || 0
  const topBrandShare = totalWeight > 0 ? topBrandWeight / totalWeight : 0
  // Diverse (10+ brands, top brand <25%) = 9-10; consolidated (3 brands, top brand >60%) = 1-2
  let brandScore = 5
  if (distinctBrands >= 12 && topBrandShare < 0.20) brandScore = 10
  else if (distinctBrands >= 8 && topBrandShare < 0.30) brandScore = 8
  else if (distinctBrands >= 6 && topBrandShare < 0.40) brandScore = 6
  else if (distinctBrands >= 4 && topBrandShare < 0.55) brandScore = 4
  else if (distinctBrands >= 3) brandScore = 2
  else brandScore = 1

  // 5. Competitor density (10%)
  // Sweet spot 15-50 included. <15 = niche-opportunity bonus; >100 = race-to-bottom penalty
  let densityScore = 5
  const ic = included.length
  if (ic >= 15 && ic <= 50) densityScore = 10
  else if (ic >= 8 && ic < 15) densityScore = 8  // niche opportunity
  else if (ic >= 50 && ic <= 80) densityScore = 7
  else if (ic >= 80 && ic <= 100) densityScore = 5
  else if (ic > 100) densityScore = 3
  else if (ic >= 5) densityScore = 6
  else densityScore = 3

  // 6. Premium tier viability (10%)
  // Share of top-20 at price ≥ $25 AND rating ≥ 4.3 AND reviews ≥ 500
  const top20 = included.slice(0, 20)
  const premium = top20.filter(p =>
    (p.price || 0) >= 25 && (p.rating || 0) >= 4.3 && p.reviews >= 500
  )
  const premiumShare = top20.length > 0 ? premium.length / top20.length : 0
  let premiumScore = 0
  if (premiumShare >= 0.5) premiumScore = 10
  else if (premiumShare >= 0.3) premiumScore = 8
  else if (premiumShare >= 0.2) premiumScore = 6
  else if (premiumShare >= 0.1) premiumScore = 4
  else if (premiumShare > 0) premiumScore = 2
  else premiumScore = 0

  // 7. Spec wedge availability (10%)
  // Compare top-10 dose claims (extracted heuristically from title) to concept's planned dose
  const conceptDose = parseDoseFromString(concept.target_dosage || '') || parseDoseFromString(JSON.stringify(concept.key_ingredients || []))
  const top10 = included.slice(0, 10)
  const topDoses = top10.map(p => parseDoseFromString(p.title)).filter((d): d is number => d !== null)
  let specScore = 5
  if (conceptDose && topDoses.length >= 5) {
    const maxTopDose = Math.max(...topDoses)
    const medianTopDose = percentile(topDoses, 0.5) || 0
    const strictAbove = topDoses.every(d => conceptDose > d)
    if (strictAbove && conceptDose >= maxTopDose * 1.5) specScore = 10
    else if (strictAbove) specScore = 8
    else if (conceptDose >= maxTopDose) specScore = 6
    else if (conceptDose >= medianTopDose) specScore = 4
    else specScore = 2
  } else if (conceptDose && topDoses.length >= 2) {
    const maxTopDose = Math.max(...topDoses)
    if (conceptDose > maxTopDose) specScore = 8
    else if (conceptDose >= maxTopDose * 0.8) specScore = 5
    else specScore = 3
  } else {
    specScore = 5  // insufficient comparable doses extracted
  }

  // Weighted sum to pillar 0-10
  const weights = { review_moat: 0.25, rev_review: 0.20, bsr: 0.15, brand: 0.10, density: 0.10, premium: 0.10, spec: 0.10 }
  const pillarScore = (reviewMoatScore * weights.review_moat) +
    (revReviewScore * weights.rev_review) +
    (bsrScore * weights.bsr) +
    (brandScore * weights.brand) +
    (densityScore * weights.density) +
    (premiumScore * weights.premium) +
    (specScore * weights.spec)

  return {
    score: Number(pillarScore.toFixed(2)),
    subsignals: {
      review_moat: {
        score: Number(reviewMoatScore.toFixed(2)),
        weight: weights.review_moat,
        review_p50: reviewP50, review_p90: reviewP90, review_max: reviewMax,
        reasoning: `p50=${reviewP50.toLocaleString()}, p90=${reviewP90.toLocaleString()}, max=${reviewMax.toLocaleString()} reviews; ${reviewMoatScore >= 7 ? 'low moat — attackable' : reviewMoatScore >= 4 ? 'moderate moat' : 'high moat — entrenched competitors'}`,
      },
      rev_review_efficiency: {
        score: revReviewScore, weight: weights.rev_review,
        ratio_p50: Number(ratioP50.toFixed(2)),
        rev_review_data_count: reviewRevenueAvailable,
        reasoning: `${reviewRevenueAvailable} competitors with revenue+reviews data; p50 ratio ${ratioP50.toFixed(1)} ${revReviewScore >= 7 ? '(healthy velocity)' : revReviewScore >= 4 ? '(moderate)' : '(mature/saturated or sparse data)'}`,
      },
      bsr_concentration: {
        score: bsrScore, weight: weights.bsr,
        best_bsr: bsrBest, top3_avg_bsr: Number(top3BsrAvg.toFixed(0)),
        reasoning: `Best BSR ${bsrBest.toLocaleString()}, top-3 avg ${top3BsrAvg.toLocaleString()}; ${bsrScore >= 7 ? 'top is diffuse' : bsrScore >= 4 ? 'moderate concentration' : 'locked-up top'}`,
      },
      brand_concentration: {
        score: brandScore, weight: weights.brand,
        distinct_brands_top20: distinctBrands,
        top_brand_share: Number(topBrandShare.toFixed(3)),
        reasoning: `${distinctBrands} distinct brands in top 20, top brand share ${(topBrandShare * 100).toFixed(1)}%; ${brandScore >= 7 ? 'diverse market' : brandScore >= 4 ? 'moderately concentrated' : 'consolidated'}`,
      },
      competitor_density: {
        score: densityScore, weight: weights.density,
        included_count: ic,
        reasoning: ic >= 15 && ic <= 50 ? 'sweet-spot density' : ic < 15 ? 'niche/thin market' : 'crowded — race-to-bottom risk',
      },
      premium_tier_viability: {
        score: premiumScore, weight: weights.premium,
        premium_count_top20: premium.length,
        premium_share: Number(premiumShare.toFixed(3)),
        reasoning: `${premium.length}/${top20.length} top products at ≥$25 AND ≥4.3★ AND ≥500 reviews; ${premiumScore >= 7 ? 'premium tier is viable' : premiumScore >= 4 ? 'narrow premium space' : 'no premium tier present'}`,
      },
      spec_wedge: {
        score: specScore, weight: weights.spec,
        concept_dose: conceptDose,
        top10_doses: topDoses,
        reasoning: conceptDose ? `Concept dose ${conceptDose}, top-10 sample doses [${topDoses.slice(0, 6).join(', ')}]; ${specScore >= 7 ? 'spec wedge exists' : specScore >= 4 ? 'parity with leaders' : 'concept under-doses vs market'}` : 'no comparable dose data extracted',
      },
    },
    details: {
      pillar_weights: weights,
      pillar_score: Number(pillarScore.toFixed(2)),
    },
  }
}

function parseDoseFromString(text: string): number | null {
  if (!text) return null
  // Look for first number followed by mg / billion CFU / IU. Returns the numeric dose.
  // Examples: "30 billion CFU" → 30; "500 mg" → 500; "1000mg" → 1000; "24mg" → 24
  // Prefer billion CFU > IU > mg
  const cfuMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:bn|billion)\s*(?:cfu)?/i)
  if (cfuMatch) return parseFloat(cfuMatch[1])
  const mgMatch = text.match(/(\d{1,5}(?:\.\d+)?)\s*mg\b/i)
  if (mgMatch) return parseFloat(mgMatch[1])
  const mcgMatch = text.match(/(\d{1,6}(?:\.\d+)?)\s*mcg\b/i)
  if (mcgMatch) return parseFloat(mcgMatch[1]) / 1000  // normalize to mg-equivalent
  const iuMatch = text.match(/(\d{1,6}(?:\.\d+)?)\s*iu\b/i)
  if (iuMatch) return parseFloat(iuMatch[1])
  return null
}

// ═══════════════════════════════════════════════════════════════════════
// STEP 5b: DIFFERENTIATION (Opus 6-vector)
// ═══════════════════════════════════════════════════════════════════════

interface DiffResult extends PillarResult {
  vectors_available: number
  competitive_gap: number
  form_factor_fit: number
  pricing_headroom: number
  vector_total: number  // 0-12 (legacy)
  vector_details: any
  reasoning: string
}

// v5.1 — vectors-available redesign.
// Old behavior: scored against the CONCEPT's specific spec/dose/format/positioning,
// which are unreliable placeholders at evaluation stage. Produced bogus "concept
// dose 4" comparisons for Cayenne (likely parsed mg of capsaicin from a hallucinated
// spec). The concept_scores it produced couldn't be trusted.
//
// New behavior: scores the NICHE's differentiation room — "are there vectors
// available for Toniiq's playbook to attack, given the competitive landscape?"
// The concept name/ingredient is context for the LLM; scoring is grounded
// strictly in the Keepa-enriched competitor set. The concept's final spec
// is decided downstream in R&D — evaluation just answers "is there room?"
async function runDifferentiation(
  apiKey: string,
  concept: any,
  ingredientName: string,
  frame: HybridFrame,
  included: HybridProduct[],
  enrichment: HybridAggregate,
): Promise<DiffResult> {
  const topCompetitors = included.slice(0, 12).map(p => ({
    brand: p.brand, title: p.title.slice(0, 200), price: p.price, rating: p.rating,
    reviews: p.reviews, monthly_sold: p.monthly_sold, bsr: p.bsr_current || p.bsr_avg30,
  }))

  // Ingredient-spec primer — guards against extract-vs-active confusion that
  // produces hallucinations like "500mg capsaicin" (lethal dose) when buyers
  // actually mean 500mg cayenne extract. Applied to all LLM steps in this run.
  const INGREDIENT_SPEC_PRIMER = `INGREDIENT SPEC CONVENTIONS — READ CAREFULLY:
- Listed dose on a supplement label almost always refers to the WHOLE EXTRACT or PLANT MATERIAL, not the active marker.
- Examples of common extract-vs-active confusion:
  • "500mg cayenne pepper" = 500mg of cayenne pepper EXTRACT (or whole-spice powder). Capsaicin (the active) is typically 0.5-5mg per capsule. NEVER assume 500mg of capsaicin — that's a lethal dose.
  • "Milk thistle 500mg" = 500mg of milk thistle extract. Silymarin (the active) is typically 80% of that = 400mg. Silybin (the most-active subfraction) is ~30% of silymarin = ~120mg.
  • "Ashwagandha 1000mg" = 1000mg of ashwagandha extract. Withanolides (active) are typically 2.5-10% = 25-100mg.
  • "Turmeric 1000mg" = 1000mg of turmeric powder OR turmeric extract. Curcuminoids (active) range from 3% (root powder) to 95% (extract).
  • "Berberine 500mg" = 500mg of berberine HCl (the actual active compound — berberine IS the active, not extracted from a parent).
  • "Astaxanthin 12mg" = 12mg of astaxanthin (the active itself, usually in oleoresin form).
  • "Boswellia 500mg" = 500mg of boswellia extract. AKBA (most-active subfraction) is typically 30-65%.
- When extracting "competitor dose" from a title, capture the WHOLE EXTRACT dose (the prominent number), not a guess at active marker.
- When comparing potency, compare apples to apples: extract-to-extract OR standardized-active-to-standardized-active.`

  // SONNET (not OPUS): the 6-vector differentiation eval is well-structured and
  // Sonnet handles it reliably. OPUS pushed total Phase B runtime past the
  // 6.67-min Supabase edge function limit (caused 11+ min reaper kills on the
  // 2026-05-23 v5.1 verification runs).
  const r = await anthropicCall(apiKey, {
    model: SONNET,
    max_tokens: 2500,
    system: `You are a niche differentiation strategist for Toniiq. Your job is to evaluate whether a given competitive niche has ROOM for Toniiq's differentiation playbook to win — independent of the specific concept's placeholder spec.

CRITICAL FRAMING:
- The concept supplied below is a high-level idea from Phase A — its spec, dose, format, and positioning are NOT locked. They will be re-decided in R&D after evaluation.
- DO NOT score "is THIS concept differentiated?" — score "are there differentiation vectors AVAILABLE in this niche for Toniiq?"
- Your output guides whether the niche is worth pursuing, not whether the concept's draft spec is right.

${INGREDIENT_SPEC_PRIMER}

Toniiq's playbook — the 6 differentiation vectors:
1. **concentration_potency** — Is competitor standardization VARIED enough that Toniiq can come in higher? (e.g. market sells "ashwagandha 5% withanolides", Toniiq deploys 10%.) If most competitors are already at the ceiling (e.g. all at 95% curcuminoids), the vector is closed. Score 0-10.
2. **branded_patented_ingredient** — Is a branded/clinical form (Quercefit, Berbevis, KSM-66, Sensoril, Creapure, AstaPure, BCM-95, etc.) deployable here AND under-deployed by competitors? If most competitors already use the branded form, the vector is closed. Score 0-10.
3. **purity_standardization** — Does the niche have lax purity / spec clarity that Toniiq's tested-purity / lab-verified positioning would stand out against? If competitors all publish COAs and clear specs, closed. Score 0-10.
4. **multi_pathway_stack** — Would a complementary co-ingredient unlock a positioning angle competitors aren't using? (e.g. saw palmetto + pumpkin seed; quercetin + bromelain.) If the niche is already saturated with stacked products, less differentiating. Score 0-10.
5. **cfu_strain_specificity** — ONLY for live cultures (probiotics, S. boulardii, etc.). Can Toniiq deploy a clinically-validated strain (HN019, BC30, CNCM I-745, 1714, etc.) competitors aren't using? Score 0-10 for relevant niches, 0 for non-microbial.
6. **bioavailability_delivery** — Is enhanced delivery (liposomal, phytosome, micellar, enteric) viable here and under-deployed? (Note: if the frame is already strict_modifier on delivery, this vector is largely "spent" on the modifier itself — score it as the room for FURTHER innovation, not the modifier itself.) Score 0-10.

For each vector, return:
- score (0-10) — strictly based on competitive evidence in the supplied data
- reasoning — 1-2 sentence grounded justification citing specific competitor evidence

Then summarize:
- vectors_available — count of vectors scoring ≥6 (these are vectors Toniiq could realistically deploy)
- pillar_score — straight average of the 6 vectors (0-10), then output as scaled 0-10
- reasoning — 2-3 sentence summary of niche differentiation room overall

DATA INTEGRITY: every score must trace to specific competitor evidence in the supplied data. If you cannot cite evidence for or against a vector, score it 5 (neutral) with a "data insufficient" note. Do NOT invent competitor specs or branded ingredients that aren't in the supplied data.

Return STRICT JSON:
{
  "vectors": {
    "concentration_potency": {"score": 0-10, "reasoning": "..."},
    "branded_patented_ingredient": {"score": 0-10, "reasoning": "..."},
    "purity_standardization": {"score": 0-10, "reasoning": "..."},
    "multi_pathway_stack": {"score": 0-10, "reasoning": "..."},
    "cfu_strain_specificity": {"score": 0-10, "reasoning": "..."},
    "bioavailability_delivery": {"score": 0-10, "reasoning": "..."}
  },
  "vectors_available": 0-6,
  "pillar_score": 0-10,
  "reasoning": "..."
}`,
    messages: [{
      role: 'user',
      content: `Niche: ${ingredientName} (hero) ${frame.delivery_modifier ? `· ${frame.delivery_modifier} delivery` : ''}
Frame: ${frame.frame}
Concept name (for context only — DO NOT score against its spec): "${concept.concept_name}"

Competitive landscape (Keepa-enriched, ${included.length} included competitors after classification):
- Price p50: $${enrichment.price_p50 ?? 'n/a'}
- Reviews — p50: ${enrichment.review_p50?.toLocaleString() ?? 'n/a'} / p90: ${enrichment.review_p90?.toLocaleString() ?? 'n/a'} / max: ${enrichment.review_max?.toLocaleString() ?? 'n/a'}
- Best BSR: ${enrichment.bsr_best ?? 'n/a'}
- Distinct brands in top-20: ${enrichment.distinct_brands ?? 'n/a'}

Top 12 included competitors:
${JSON.stringify(topCompetitors, null, 1)}

Score the 6 differentiation vectors strictly based on whether this niche has ROOM for Toniiq's playbook — independent of the concept's draft spec.`,
    }],
  })
  const text = extractText(r)
  let parsed: any
  try {
    parsed = extractJson(text)
  } catch (e) {
    return {
      score: 0, vectors_available: 0, competitive_gap: 0, form_factor_fit: 0, pricing_headroom: 0,
      vector_total: 0, vector_details: {}, reasoning: `parse_error: ${(e as Error).message}`,
    }
  }

  // Extract per-vector scores; clamp to 0-10.
  const vectors = parsed.vectors || {}
  const vectorKeys = [
    'concentration_potency',
    'branded_patented_ingredient',
    'purity_standardization',
    'multi_pathway_stack',
    'cfu_strain_specificity',
    'bioavailability_delivery',
  ]
  const vectorScores: number[] = []
  const vectorDetails: any = {}
  for (const key of vectorKeys) {
    const v = vectors[key] || {}
    const s = Math.max(0, Math.min(10, n(v.score)))
    vectorScores.push(s)
    vectorDetails[key] = { score: s, reasoning: String(v.reasoning || '').slice(0, 400) }
  }

  // vectors_available = count scoring >= 6 (vectors Toniiq could realistically deploy)
  const vectors_available = vectorScores.filter(s => s >= 6).length
  // Pillar score = clamped LLM-output, defaulting to average if absent.
  const computedAvg = vectorScores.length > 0 ? vectorScores.reduce((a, b) => a + b, 0) / vectorScores.length : 0
  const llm_score = n(parsed.pillar_score)
  const score = Number((Math.max(0, Math.min(10, llm_score || computedAvg))).toFixed(2))

  return {
    score,
    vectors_available,
    // Legacy fields preserved as 0 — they're meaningless under the new framework.
    // They're kept in the schema for backwards compatibility with pre-v5.1 rows.
    competitive_gap: 0,
    form_factor_fit: 0,
    pricing_headroom: 0,
    vector_total: vectorScores.reduce((a, b) => a + b, 0),
    vector_details: vectorDetails,
    reasoning: String(parsed.reasoning || '').slice(0, 500),
  }
}

// ═══════════════════════════════════════════════════════════════════════
// STEP 6: COMPETITION GATE
// ═══════════════════════════════════════════════════════════════════════

interface CompetitionGateResult {
  composite_cap: number
  tier_cap: RecommendationTier
  caps_applied: string[]
}

function applyCompetitionGate(
  competitivePillar: PillarResult,
  frame: HybridFrame,
  included: HybridProduct[],
  concept: any,
): CompetitionGateResult {
  const subs: any = competitivePillar.subsignals || {}
  let cap = 100
  let tierCap: RecommendationTier = 'launch_priority'
  const caps_applied: string[] = []

  const setCap = (compositeCap: number, newTierCap: RecommendationTier, reason: string) => {
    cap = Math.min(cap, compositeCap)
    if (TIER_ORDER[newTierCap] < TIER_ORDER[tierCap]) tierCap = newTierCap
    caps_applied.push(reason)
  }

  // Convert pillar caps (0-10) into composite caps using the 35% weight
  // Cap pillar at 5 means worst-case competitive contribution = 5 * 10 * 0.35 = 17.5
  // The other pillars max contribute 65, so overall composite capped at 65 + 17.5 = 82.5.
  // We translate "cap pillar at 5" to "cap composite at 80" for cleaner UI numbers.
  const PILLAR_CAP_TO_COMPOSITE: Record<number, number> = { 5: 78, 6: 82 }

  if ((subs.review_moat?.score ?? 10) <= 2) {
    setCap(PILLAR_CAP_TO_COMPOSITE[5], 'strong_candidate', 'review_moat_at_or_below_2_caps_pillar_at_5')
  }
  if ((subs.spec_wedge?.score ?? 10) <= 2) {
    setCap(PILLAR_CAP_TO_COMPOSITE[5], 'strong_candidate', 'spec_wedge_at_or_below_2_caps_pillar_at_5')
  }
  const bestBsr = subs.bsr_concentration?.best_bsr ?? 999_999_999
  if (bestBsr > 0 && bestBsr <= 200) {
    setCap(PILLAR_CAP_TO_COMPOSITE[6], 'strong_candidate', `dominant_top_bsr_${bestBsr}_caps_pillar_at_6`)
  }
  const conceptPrice = parsePlannedPrice(concept)
  const premium = subs.premium_tier_viability?.score ?? 10
  if (premium <= 2 && conceptPrice && conceptPrice >= 25) {
    setCap(PILLAR_CAP_TO_COMPOSITE[5], 'strong_candidate', `premium_tier_weak_${premium}_with_planned_price_${conceptPrice}_caps_pillar_at_5`)
  }
  if (frame.frame === 'strict_modifier' && included.length < 3) {
    if (TIER_ORDER.strong_candidate < TIER_ORDER[tierCap]) tierCap = 'strong_candidate'
    caps_applied.push(`strict_modifier_with_${included.length}_included_caps_tier_at_strong_candidate`)
  }

  return { composite_cap: cap, tier_cap: tierCap, caps_applied }
}

function parsePlannedPrice(concept: any): number | null {
  const fields = [concept.target_price, concept.planned_price, concept.positioning_angle]
  for (const f of fields) {
    if (!f) continue
    const m = String(f).match(/\$\s*(\d{1,3}(?:\.\d{1,2})?)/)
    if (m) return parseFloat(m[1])
  }
  return null
}

// ═══════════════════════════════════════════════════════════════════════
// HELPERS: TIERING, MESSAGING, PERSISTENCE
// ═══════════════════════════════════════════════════════════════════════

function labelForScore(score: number): RecommendationTier {
  if (score >= 80) return 'launch_priority'
  if (score >= 65) return 'strong_candidate'
  if (score >= 50) return 'watchlist'
  if (score >= 35) return 'needs_work'
  return 'pass'
}

function capTier(label: RecommendationTier, maxLabel: RecommendationTier): RecommendationTier {
  return TIER_ORDER[label] <= TIER_ORDER[maxLabel] ? label : maxLabel
}

function buildAssessment(
  frame: HybridFrame, composite: number, tier: RecommendationTier,
  d: PillarResult, g: PillarResult, c: PillarResult, df: PillarResult,
  gate: CompetitionGateResult,
): string {
  const capsNote = gate.caps_applied.length ? ` Competition gate: ${gate.caps_applied.join('; ')}.` : ''
  return `Composite ${composite.toFixed(1)}/100 → ${tier} (${frame.frame}, hero=${frame.hero_ingredient}${frame.delivery_modifier ? `+${frame.delivery_modifier}` : ''}). Pillars: demand ${d.score.toFixed(1)} / growth ${g.score.toFixed(1)} / competitive ${c.score.toFixed(1)} / differentiation ${df.score.toFixed(1)}.${capsNote}`
}

function buildOpportunitySignals(d: PillarResult, g: PillarResult, c: PillarResult, df: PillarResult): string[] {
  const out: string[] = []
  if (d.score >= 7) out.push(`Strong demand pillar (${d.score.toFixed(1)}/10) — primary keyword ${d.details?.primary_clicks?.toLocaleString() || '?'} monthly clicks at ${d.details?.weighted_conversion_pct || '?'}% conversion`)
  if (g.score >= 7) out.push(`Growth ${g.details?.trajectory_shape || ''}: 3m ${g.details?.growth_3m_pct ?? '?'}%, 6m ${g.details?.growth_6m_pct ?? '?'}%, 12m ${g.details?.growth_12m_pct ?? '?'}%`)
  if ((c.subsignals?.review_moat?.score ?? 0) >= 7) out.push('Review moat is low — top competitors are not entrenched')
  if ((c.subsignals?.spec_wedge?.score ?? 0) >= 7) out.push('Spec wedge available — concept dose exceeds top-10 competitors')
  if ((c.subsignals?.premium_tier_viability?.score ?? 0) >= 7) out.push('Premium tier is viable — multiple top-20 products at ≥$25 with strong ratings')
  if (df.score >= 7) out.push(`Differentiation ${df.score.toFixed(1)}/10 — ${(df as any).vectors_available || '?'}/5 vectors available, ${(df as any).competitive_gap || '?'}/3 gap`)
  return out
}

function buildRiskFactors(d: PillarResult, g: PillarResult, c: PillarResult, gate: CompetitionGateResult): string[] {
  const out: string[] = []
  if (d.score <= 4) out.push(`Demand pillar weak (${d.score.toFixed(1)}/10) — primary keyword volume or conversion is below thresholds`)
  if (g.score <= 3) out.push(`Growth pillar weak (${g.score.toFixed(1)}/10) — trajectory ${g.details?.trajectory_shape || 'declining/flat'}`)
  if ((c.subsignals?.review_moat?.score ?? 10) <= 3) out.push(`Heavy review moat — p50 ${c.subsignals?.review_moat?.review_p50?.toLocaleString() || '?'}, max ${c.subsignals?.review_moat?.review_max?.toLocaleString() || '?'}`)
  if ((c.subsignals?.brand_concentration?.score ?? 10) <= 3) out.push(`Brand consolidation — top brand controls ${((c.subsignals?.brand_concentration?.top_brand_share || 0) * 100).toFixed(0)}% of top-20`)
  if ((c.subsignals?.bsr_concentration?.best_bsr || 0) > 0 && (c.subsignals?.bsr_concentration?.best_bsr || 0) <= 500) out.push(`Top competitor at BSR ${c.subsignals.bsr_concentration.best_bsr.toLocaleString()} — locked-up leader`)
  if (gate.caps_applied.length) out.push(`Competition gate caps: ${gate.caps_applied.join('; ')}`)
  return out
}

function buildNextSteps(tier: RecommendationTier): string[] {
  if (tier === 'launch_priority') {
    return [
      'Fast-track to formulation + costing',
      'Source supplier quotes for hero ingredient',
      'Begin product brief draft (use _Skills/product-brief)',
    ]
  }
  if (tier === 'strong_candidate') {
    return [
      'Address top 1-2 risk factors before greenlight',
      'Validate primary differentiation vector with sample sourcing',
      'Refine positioning vs review-moat leaders',
    ]
  }
  if (tier === 'watchlist') {
    return [
      'Park unless a sharper angle emerges',
      'Re-score in 90 days if growth trajectory improves',
    ]
  }
  if (tier === 'needs_work') {
    return [
      'Refine concept positioning to address differentiation gaps',
      'Consider alternative angle or pair with stronger concept',
    ]
  }
  return ['Pass — return to ideation if positioning shifts']
}

async function loadKeepaKey(sb: any): Promise<string> {
  const envKey = Deno.env.get('KEEPA_API_KEY')
  if (envKey) return envKey
  const { data, error } = await sb.from('system_config').select('value').eq('key', 'keepa_api_key').maybeSingle()
  if (error) throw new Error(`keepa_api_key lookup failed: ${error.message}`)
  if (!data?.value) throw new Error('KEEPA_API_KEY env or keepa_api_key system_config value required')
  return data.value
}

async function writeCompetitiveResearch(
  sb: any, conceptId: string, frame: HybridFrame, demand: DemandPacket,
  enrichment: HybridAggregate, auditProducts: HybridProduct[],
) {
  const included = auditProducts.filter(p => p.bucket === 'included')
  const top15 = included.slice(0, 15).map(p => ({
    asin: p.asin, brand: p.brand, title: p.title, price: p.price, rating: p.rating,
    reviews: p.reviews, monthly_sold: p.monthly_sold, bsr_current: p.bsr_current,
    bsr_avg30: p.bsr_avg30, lane_fit: p.lane_fit, amazon_url: p.amazon_url || `https://www.amazon.com/dp/${p.asin}`,
  }))
  const prices = included.map(p => p.price || 0).filter(v => v > 0).sort((a, b) => a - b)
  const reviews = included.map(p => p.reviews).filter(v => v > 0).sort((a, b) => a - b)
  await sb.from('concept_competitive_research').insert({
    concept_id: conceptId,
    search_queries: frame.query_packet,
    search_date: new Date().toISOString().slice(0, 10),
    top_products: top15,
    total_competitors: included.length,
    median_price: enrichment.price_p50,
    price_range_low: prices[0] || null,
    price_range_high: prices[prices.length - 1] || null,
    median_reviews: enrichment.review_p50,
    max_reviews: enrichment.review_max,
    avg_rating: enrichment.rating_p50,
    products_with_10k_reviews: included.filter(p => p.reviews >= 10_000).length,
    premium_tier_count: included.filter(p => (p.price || 0) >= (enrichment.price_p50 || 0) * 1.5).length,
    pricing_tiers: null,  // Detailed tiering deferred to UI / on-demand analysis
    direct_competitors: included.slice(0, 10).map(p => ({ brand: p.brand, title: p.title.slice(0, 120), price: p.price, reviews: p.reviews })),
    positioning_gaps: [],  // v5 moved this into pillar_competitive_subsignals.spec_wedge / brand_concentration
    brand_concentration: `${enrichment.distinct_brands || 0} distinct brands in top results`,
    review_moats: `p50 ${enrichment.review_p50?.toLocaleString() || '?'}; max ${enrichment.review_max?.toLocaleString() || '?'}`,
    differentiation_assessment: 'See concept_scores.pillar_diff_score and pillar_competitive_subsignals for v5 detail.',
    price_positioning: enrichment.price_p50 ? `Median competitor at $${enrichment.price_p50.toFixed(2)}` : 'insufficient price data',
    competition_score: null,  // legacy column; v5 uses pillar_competitive_score
    opportunity_score: null,  // legacy column; v5 uses composite_score
    overall_assessment: `v5 hybrid: ${included.length} included / ${(enrichment.result_quality as any)?.adjacent_count || 0} adjacent / ${(enrichment.result_quality as any)?.excluded_count || 0} excluded; ${enrichment.monthly_sold_coverage} with monthly_sold badge`,
    opportunity_signals: [],
    risk_factors: [],
    listing_quality_assessment: 'See concept_scores for v5 audit.',
    premium_tier_analysis: 'See pillar_competitive_subsignals.premium_tier_viability.',
    researched_at: new Date().toISOString(),
  })
}

async function writeGoogleTrendsStub(sb: any, conceptId: string, demand: DemandPacket, growth: PillarResult) {
  // Preserves the FK / row for legacy UI; growth pillar truth now lives in concept_scores.
  await sb.from('concept_google_trends').insert({
    concept_id: conceptId,
    search_terms: demand.queries.slice(0, 5),
    time_range: 'last_12_months',
    geo: 'US',
    interest_over_time: { note: 'v5: growth pillar uses Datarova clicks over 12 months; see concept_scores.pillar_growth_details for window breakdown.' },
    related_queries: {},
    yoy_growth_pct: demand.growth_12m_pct,
    trend_direction: growth.details?.trajectory_shape || 'unknown',
    google_trends_score: Math.round(growth.score),
    key_signals: [],
    cross_platform_validation: '',
    overall_assessment: `v5 stub. Growth derived from Datarova ${demand.queries.length}-keyword packet.`,
    data_source: 'datarova_via_phase_b_v5',
    researched_at: new Date().toISOString(),
  })
}
