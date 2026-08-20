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
  n, normalize,
} from '../_shared/hybrid_scoring.ts'
import {
  type DemandPacket,
  type RecommendationTier,
  type QualityGateResult,
  type PillarResult,
  type CompetitionGateResult,
  buildDemandPacketFromRecords,
  qualityGate,
  computeDemandPillar,
  computeGrowthPillar,
  computeCompetitivePillar,
  applyCompetitionGate,
  labelForScore,
  capTier,
  TIER_ORDER,
} from '../_shared/scoring_core.ts'

const SCORING_VERSION = 'phase-b-v5-hybrid-competitive'
const DEFAULT_KEEP_ASINS = 40
const KEEPA_TOKEN_WAIT_MS = 60_000

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
    const { data: phaseAEnrichment } = await sb.from('datarova_enrichments')
      .select('related_keywords, primary_keyword, primary_keyword_clicks, primary_keyword_sales, avg_conversion_rate, growth_3m_clicks_pct, growth_6m_clicks_pct, growth_yoy_clicks_pct, monthly_trend')
      .eq('candidate_id', concept.candidate_id)
      .order('enriched_at', { ascending: false })
      .limit(1)
      .maybeSingle()

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
    const demandPacket = await fetchDatarovaPacket(secrets.datarova_api_key, frame, phaseAEnrichment)
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

    // ── STEP 2b: INFRA PREFLIGHT — dead/invalid Datarova key ─────────────
    // A Datarova auth failure (401/403/invalid_api_key) means the KEY is broken
    // (infrastructure), NOT that this concept lacks demand. Without this guard the
    // run continues, burns a full Apify+Keepa discovery, then the quality gate
    // mislabels it `failed_demand` and writes a misleading null-score row — so one
    // dead key looks like N independent demand rejections (incident 2026-06-08).
    // Abort BEFORE discovery, write NO score row, surface a distinct infra_error.
    if (demandPacket.source !== 'datarova' && /\b401\b|\b403\b|invalid[_ ]api[_ ]key|access denied|unauthor/i.test(demandPacket.error || '')) {
      const infraMsg = `Datarova auth failure (infrastructure, not a demand rejection): ${demandPacket.error || 'unknown'}. The Datarova API key is invalid/revoked — rotate system_config.datarova_api_key. No competitive run or score written.`
      console.error('[phase-b-evaluate] INFRA ABORT (datarova_auth):', infraMsg)
      await setActionStatus(sb, resolvedActionId, 'failed', {
        notes: `Infra error (datarova_auth): ${infraMsg}`,
        context_merge: { infra_error: 'datarova_auth', datarova_error: (demandPacket.error || '').slice(0, 300), completed_at: new Date().toISOString() },
      })
      return new Response(JSON.stringify({ ok: false, infra_error: 'datarova_auth', reason: infraMsg }), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
        status: 200,
      })
    }

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
    temperature: 0,
    system: `You are a competitive frame analyst for Toniiq supplement product development. Your job: given a product concept, determine the correct competitive frame and produce a query packet for Amazon competitor discovery.

THE TWO FRAMES:
- broad_hero — the hero ingredient defines the competitive lane. Includes single-ingredient products of the hero AND multi-active complexes where the hero is the undisputed lead (named prominently in title, dosed as primary).
- strict_modifier — delivery technology IS the differentiation. Liposomal / phytosome / micellar / enhanced-absorption qualifier on a hero ingredient. Must have BOTH hero + delivery modifier in the title.

COMBINATION LANE (combo_terms) — applies ON TOP of the frame above:
When the concept is a multi-active COMBINATION whose buyer value IS the combination (the co-actives are a real reason someone buys it, not trace cofactors), the competitive lane is the COMBO — not the single-ingredient parent aisle. In that case set "combo_terms" to the co-active signal tokens a genuine combo competitor's title would carry. This restricts the SCORED competitive set to combo products; bare single-ingredient hero products become parent-market context (adjacent), not direct competitors. Also bias the query_packet toward the combo — at least half the queries should target it (e.g. "creatine electrolytes", "creatine hydration powder"). If the co-actives are merely trace/supporting cofactors and buyers are really shopping the single-ingredient lane, leave combo_terms empty ([]).

Examples:
- "Liposomal Astaxanthin" → strict_modifier, hero=astaxanthin, modifier=liposomal
- "Quercefit 5-in-1" → strict_modifier, hero=quercetin, modifier=phytosome (Quercefit IS the phytosome form of quercetin)
- "Creatine + Electrolytes Hydration Powder" → broad_hero, hero=creatine, combo_terms=["electrolyte","hydration","sodium","potassium"] (buyer wants a hydration-creatine; a plain single-ingredient creatine tub is the parent market, NOT a direct competitor)
- "Nattokinase + Serrapeptase Enzyme Complex" → broad_hero, hero=nattokinase, combo_terms=["serrapeptase"] (the enzyme pairing is the lane)
- "Cayenne + MCT Thermogenic Softgels" → broad_hero, hero=cayenne, combo_terms=[] (MCT is positioning within the cayenne lane, not a lane-defining co-star)
- "Nattokinase 5-in-1" → broad_hero, hero=nattokinase, combo_terms=[] (the 4 others are supporting cofactors; lane is nattokinase)
- "Dandelion Root Extract 10:1" → broad_hero, hero=dandelion root, combo_terms=[]
- "S. boulardii 30B" → broad_hero, hero=saccharomyces boulardii, combo_terms=[]

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
  "combo_terms": ["..."] or [],
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
  const heroIngredient = String(parsed.hero_ingredient || ingredientName).trim()
  const modifier = parsed.delivery_modifier ? String(parsed.delivery_modifier).trim() : undefined
  const queryPacket = Array.isArray(parsed.query_packet)
    ? [...new Set(parsed.query_packet.map((q: any) => String(q || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b)).slice(0, 8)
    : []
  const comboTerms = Array.isArray(parsed.combo_terms)
    ? [...new Set(parsed.combo_terms.map((t: any) => String(t || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b))
    : []
  const frame: HybridFrame = {
    frame: parsed.frame === 'strict_modifier' ? 'strict_modifier' : 'broad_hero',
    hero_ingredient: heroIngredient,
    delivery_modifier: modifier,
    query_packet: queryPacket,
    include_terms: Array.isArray(parsed.inclusion_rules) && parsed.inclusion_rules.length > 0
      ? [...new Set(parsed.inclusion_rules.map((t: any) => String(t || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b))
      : [heroIngredient],
    require_any: modifier
      ? [modifier]
      : comboTerms,
    exclude_terms: Array.isArray(parsed.exclusion_rules)
      ? [...new Set(parsed.exclusion_rules.map((t: any) => String(t || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b))
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

async function fetchDatarovaPacket(apiKey: string, frame: HybridFrame, phaseAEnrichment: any = null): Promise<DemandPacket> {
  const phaseAKeywords = Array.isArray(phaseAEnrichment?.related_keywords)
    ? phaseAEnrichment.related_keywords
      .map((item: any) => normalize(String(item?.keyword || '')))
      .filter(Boolean)
    : []
  const queries = [...new Set([
    ...frame.query_packet.map(q => normalize(q)).filter(Boolean),
    ...phaseAKeywords,
  ])].sort((a, b) => a.localeCompare(b)).slice(0, 44)

  if (!queries.length) {
    return buildDemandPacketFromRecords([], frame, phaseAEnrichment, queries)
  }

  try {
    const end = latestCompleteMonth()
    const start = addMonths(end, -12)
    const records = await datarovaKeywords(apiKey, {
      keywords: queries,
      start: monthKey(start),
      end: monthKey(end),
      marketplace: 'US',
    })
    return buildDemandPacketFromRecords(records, frame, phaseAEnrichment, queries)
  } catch (err) {
    const packet = buildDemandPacketFromRecords([], frame, phaseAEnrichment, queries)
    return { ...packet, source: 'fallback', error: err instanceof Error ? err.message.slice(0, 300) : String(err).slice(0, 300) }
  }
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
