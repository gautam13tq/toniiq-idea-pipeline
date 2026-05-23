/**
 * phase-a-think v4 — Phase A steps 3 & 4 (Science research + Concept synthesis)
 *
 * Chained from phase-a-gather. Loads the candidate + prior enrichment/reddit
 * rows, runs science research with Sonnet + web search tool, then synthesizes
 * 3 product concepts with Opus (extended thinking).
 *
 * v4 changes (2026-05-19) — buyer-keyword inference plumbed into synthesis:
 *   - Reads inferred_keywords from pending_action.context (written by
 *     phase-a-gather v4 at the start of the run)
 *   - Passes the inferred primary_keyword + related_keywords + reasoning into
 *     synthesizeConcepts as an additional context block so concept naming,
 *     positioning, and keyword_evidence land closer to real buyer queries
 *   - Science research now also uses the inferred primary_keyword (was
 *     candidate.ingredient_name) — produces more relevant clinical citations
 *     for technical/category-style names like "Butyrate / tributyrin postbiotic
 *     -metabolite lane"
 *   - Fully backwards-compatible: candidates without inferred_keywords (older
 *     runs from phase-a-gather v3 or earlier) fall back to v3 behavior
 *
 * v3 changes (2026-05-19) — manual / supplier context in synthesis prompt:
 *   - Also loads the linked opportunity_review row (source, source_context,
 *     signal_tags) when one exists for the candidate
 *   - Passes candidate.notes + review fields into synthesizeConcepts as
 *     manual_context / source / source_context / signal_tags
 *   - Synthesis prompt gains a MANUAL / SUPPLIER CONTEXT block when
 *     candidate.notes is non-empty, with explicit rules that at least one of
 *     the 3 concepts must be anchored on the manual context
 *   - Fully backwards-compatible: candidates without notes get the identical
 *     prompt and behavior as v2
 *
 * v2 changes (2026-05-13) — fitted to Supabase 150s wall clock:
 *   - Web search max_uses 5 → 3 (saves 30-60s of web search latency)
 *   - Opus thinking budget 8000 → 4000 tokens
 *   - Opus max_tokens 12000 → 8000 tokens
 *   - Added timing instrumentation at each step
 *   - anthropicCall now auto-retries 429 rate limits (handled in _shared/clients.ts)
 *
 * Budget: setup 2s + science 50-80s + synthesis 40-60s + db writes 2s = ~100-140s.
 *
 * DATA INTEGRITY: Science claims must cite real sources (PubMed/DOI/NCT).
 * Concepts are stored with status='proposed' so Gautam still decides accept/
 * reject/park — the LLM never greenlits anything on its own.
 */

import { corsHeaders } from '../_shared/cors.ts'
import {
  svcClient, loadSecrets, anthropicCall, extractText, extractJson,
  SONNET, OPUS, setActionStatus,
} from '../_shared/clients.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  const tStart = Date.now()
  const log = (msg: string) => console.log(`[phase-a-think] ${Date.now() - tStart}ms · ${msg}`)

  let actionIdForErrorHandler: string | undefined
  try {
    const body = await req.json().catch(() => ({}))
    const sb = svcClient()
    const secrets = await loadSecrets(sb)

    const actionId: string = body.pending_action_id
    if (!actionId) {
      return new Response(JSON.stringify({ error: 'pending_action_id required' }), {
        status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders },
      })
    }
    actionIdForErrorHandler = actionId

    const { data: action, error: aErr } = await sb.from('pending_actions').select('*').eq('id', actionId).single()
    if (aErr || !action) throw new Error(`Action not found: ${aErr?.message}`)
    const candidateId = action.entity_id
    const { data: candidate } = await sb.from('idea_candidates').select('*').eq('id', candidateId).single()
    if (!candidate) throw new Error('Candidate not found')

    log(`setup done, candidate="${candidate.ingredient_name}"`)

    // Load prior enrichment (gather must have run first) + linked opportunity_review
    // for manual/supplier context. The review carries source_context (e.g. "Vitafoods
    // Supplier Taiyi") and source (e.g. "manual") which feed the synthesis prompt
    // when a human or supplier has pre-framed the idea. candidate.notes carries the
    // free-text spec/positioning the user captured at queue time.
    const [{ data: datarova }, { data: reddit }, { data: opportunityReview }] = await Promise.all([
      sb.from('datarova_enrichments').select('*').eq('candidate_id', candidateId).order('enriched_at', { ascending: false }).limit(1).maybeSingle(),
      sb.from('reddit_concept_research').select('*').eq('candidate_id', candidateId).order('researched_at', { ascending: false }).limit(1).maybeSingle(),
      sb.from('opportunity_reviews').select('source, source_context, signal_tags, rationale').eq('candidate_id', candidateId).order('created_at', { ascending: false }).limit(1).maybeSingle(),
    ])
    log(`prior enrichment loaded · datarova=${!!datarova} reddit=${!!reddit} review=${!!opportunityReview}`)

    // v4: Pull inferred_keywords from gather's context (written by phase-a-gather v4+)
    // for technical/category-style ingredient names that need buyer-friendly queries.
    // Older runs from v3-gather won't have this; we fall back to ingredient_name.
    const inferredKeywords = action?.context?.inferred_keywords as
      | { primary_keyword?: string; related_keywords?: string[]; reasoning?: string; skipped?: boolean }
      | undefined
    const scienceQuery = inferredKeywords?.primary_keyword || candidate.ingredient_name
    log(`science query="${scienceQuery}" (inferred=${!!inferredKeywords && !inferredKeywords.skipped})`)

    // ── STEP 3: SCIENCE RESEARCH (Sonnet + web search, 3 max uses) ───────
    await setActionStatus(sb, actionId, 'in_progress', { context_merge: { science: 'running' } })
    const tScience = Date.now()
    const scienceResult = await runScienceResearch(secrets.anthropic_api_key, scienceQuery)
    log(`science done in ${Date.now() - tScience}ms · ${(scienceResult.sources_consulted || []).length} sources`)

    await sb.from('science_concept_research').insert({
      candidate_id: candidateId,
      ingredient_name: candidate.ingredient_name,
      clinical_dosages: scienceResult.clinical_dosages,
      proven_combinations: scienceResult.proven_combinations,
      active_compounds: scienceResult.active_compounds,
      bioavailability_notes: scienceResult.bioavailability_notes,
      novel_angles: scienceResult.novel_angles,
      safety_notes: scienceResult.safety_notes,
      contraindications: scienceResult.contraindications,
      concept_suggestions: scienceResult.concept_suggestions,
      sources_consulted: scienceResult.sources_consulted,
      researched_at: new Date().toISOString(),
    })

    await setActionStatus(sb, actionId, 'in_progress', {
      context_merge: { science: 'done', science_sources_count: (scienceResult.sources_consulted || []).length },
    })

    // ── STEP 4: CONCEPT SYNTHESIS (Opus with reduced thinking) ───────────
    await setActionStatus(sb, actionId, 'in_progress', { context_merge: { synthesis: 'running' } })
    const tSynth = Date.now()
    const concepts = await synthesizeConcepts(secrets.anthropic_api_key, {
      ingredient: candidate.ingredient_name,
      category: candidate.category,
      datarova, reddit, science: scienceResult,
      manual_context: candidate.notes,
      source: opportunityReview?.source,
      source_context: opportunityReview?.source_context,
      signal_tags: opportunityReview?.signal_tags,
      inferred_primary_keyword: inferredKeywords?.primary_keyword,
      inferred_related_keywords: inferredKeywords?.related_keywords,
      inference_reasoning: inferredKeywords?.reasoning,
      inference_skipped: inferredKeywords?.skipped,
    })
    log(`synthesis done in ${Date.now() - tSynth}ms · ${concepts.length} concepts`)

    for (let i = 0; i < concepts.length; i++) {
      const c = concepts[i]
      const { data: inserted, error } = await sb.from('product_concepts').insert({
        candidate_id: candidateId,
        concept_name: c.concept_name,
        concept_type: c.concept_type,
        format: c.format,
        target_dosage: c.target_dosage,
        key_ingredients: c.key_ingredients,
        positioning_angle: c.positioning_angle,
        keyword_evidence: c.keyword_evidence,
        reddit_evidence: c.reddit_evidence,
        science_evidence: c.science_evidence,
        confidence_score: c.confidence_score,
        confidence_reasoning: c.confidence_reasoning,
        rank_within_ingredient: i + 1,
        status: 'proposed',
        generated_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).select('id').single()
      if (!error && inserted) {
        await sb.from('concept_ingredient_links').insert({
          concept_id: inserted.id, candidate_id: candidateId, role: 'primary',
        })
      }
    }

    // Idea stage will auto-update to 'research' via the rollup trigger.
    await setActionStatus(sb, actionId, 'completed', {
      notes: `Phase A complete. ${concepts.length} concepts generated.`,
      context_merge: {
        synthesis: 'done',
        concepts_count: concepts.length,
        think_elapsed_ms: Date.now() - tStart,
        completed_at: new Date().toISOString(),
      },
    })

    log(`done in ${Date.now() - tStart}ms`)
    return new Response(JSON.stringify({
      ok: true, step: 'think', action_id: actionId, concepts: concepts.length,
      elapsed_ms: Date.now() - tStart,
    }), { headers: { 'Content-Type': 'application/json', ...corsHeaders } })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('phase-a-think error:', msg)
    try {
      const sb = svcClient()
      if (actionIdForErrorHandler) {
        await setActionStatus(sb, actionIdForErrorHandler, 'failed', { notes: `think failed: ${msg}` })
      }
    } catch (_) { /* ignore */ }
    return new Response(JSON.stringify({ error: msg, elapsed_ms: Date.now() - tStart }), {
      status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders },
    })
  }
})

// ── Science Research (Sonnet + web search, 3 max uses) ──────────────────
async function runScienceResearch(apiKey: string, ingredient: string): Promise<any> {
  const r = await anthropicCall(apiKey, {
    model: SONNET,
    max_tokens: 6000,
    tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }],
    system: `You are the Science Research sub-agent for Toniiq's supplement ideation pipeline. For the given ingredient/concept, research the clinical and scientific landscape, then return structured JSON.

DATA INTEGRITY (Toniiq has a history of hallucinated studies — this is non-negotiable):
- Every clinical dosage must cite a real study (PubMed ID, DOI, or ClinicalTrials.gov NCT number)
- Every bioavailability claim must cite a real paper
- If you cannot find a real citation for a claim, OMIT the claim or mark it "[cite: pending — general literature]"
- Do NOT invent trial names, PMIDs, or dosing figures
- Use web_search tool 2-3 times to find real papers (budget-constrained; pick the highest-value queries)

Return STRICT JSON (no markdown):
{
  "clinical_dosages": [{"protocol": "...", "dose": "...", "source": "PMID XXXX / NCT XXXX / DOI"}],
  "proven_combinations": [{"combo": "X + Y", "status": "validated/weak/speculative", "source": "..."}],
  "active_compounds": [{"compound": "...", "role": "...", "mechanisms": [...]}],
  "bioavailability_notes": [{"note": "...", "source": "...", "evidence_tier": "high/preclinical/gap"}],
  "novel_angles": [{"angle": "...", "support": "..."}],
  "safety_notes": "2-4 sentence summary",
  "contraindications": ["..."],
  "concept_suggestions": [{"concept": "...", "angle": "...", "risk": "low/medium/high"}],
  "sources_consulted": ["PMID XXXX description", "NCT XXXX", "DOI ..."]
}`,
    messages: [{
      role: 'user',
      content: `Ingredient/concept: "${ingredient}"\n\nResearch the clinical evidence and return the structured JSON.`,
    }],
  })
  const text = extractText(r)
  try {
    return extractJson(text)
  } catch (e) {
    return {
      clinical_dosages: [], proven_combinations: [], active_compounds: [],
      bioavailability_notes: [], novel_angles: [],
      safety_notes: `Science research parse error: ${(e as Error).message}`,
      contraindications: [], concept_suggestions: [], sources_consulted: [],
    }
  }
}

// ── Concept Synthesis (Opus with reduced thinking + max_tokens) ─────────
async function synthesizeConcepts(apiKey: string, opts: {
  ingredient: string; category?: string; datarova: any; reddit: any; science: any;
  manual_context?: string | null;
  source?: string | null;
  source_context?: string | null;
  signal_tags?: string[] | null;
  inferred_primary_keyword?: string | null;
  inferred_related_keywords?: string[] | null;
  inference_reasoning?: string | null;
  inference_skipped?: boolean | null;
}): Promise<any[]> {
  // Compact the evidence — Opus doesn't need raw JSONB dumps
  const datarovaSummary = opts.datarova ? {
    primary: opts.datarova.primary_keyword,
    primary_clicks: opts.datarova.primary_keyword_clicks,
    primary_conv: opts.datarova.primary_keyword_conversion,
    total_clicks: opts.datarova.total_monthly_clicks,
    growth_3m: opts.datarova.growth_3m_clicks_pct,
    growth_yoy: opts.datarova.growth_yoy_clicks_pct,
    top_keywords: (opts.datarova.related_keywords || []).slice(0, 10),
  } : null

  const redditSummary = opts.reddit ? {
    score: opts.reddit.reddit_score,
    posts: opts.reddit.total_posts_analyzed,
    sentiment_ratio: opts.reddit.sentiment_ratio,
    pain_points: opts.reddit.pain_points,
    brands: opts.reddit.brand_landscape,
    underserved: opts.reddit.underserved_needs,
    formats: opts.reddit.formats_discussed,
    dosages: opts.reddit.dosages_discussed,
    combos: opts.reddit.combos_discussed,
  } : null

  // Inferred-buyer-keywords block — rendered when phase-a-gather v4 produced a
  // non-skipped inference (i.e. the candidate had a technical/category-style name
  // that was decomposed into buyer queries). Helps synthesis name concepts in
  // buyer-friendly terms and cite the decomposition in keyword_evidence.
  const inferredPrimary = (opts.inferred_primary_keyword || '').trim()
  const inferredRelated = Array.isArray(opts.inferred_related_keywords)
    ? opts.inferred_related_keywords.filter(k => typeof k === 'string' && k.trim().length > 0)
    : []
  const hasInferredKeywords = !opts.inference_skipped && inferredPrimary.length > 0
  const inferredBlock = hasInferredKeywords ? `

INFERRED BUYER KEYWORDS (from phase-a-gather v4):
- Original candidate name: "${opts.ingredient}"
- Primary buyer query used for Datarova/Reddit/science: "${inferredPrimary}"
- Related buyer queries pulled: ${inferredRelated.length > 0 ? inferredRelated.map(k => `"${k}"`).join(', ') : '(none)'}
- Decomposition reasoning: ${opts.inference_reasoning || '(none)'}

** WHEN AN INFERENCE IS PROVIDED **
The candidate's display name above is a technical/category descriptor — the gathered Datarova and Reddit data were pulled using the inferred primary/related buyer keywords, not the display name. When you synthesize:
- Name concepts using the buyer-recognizable form (e.g. "Butyrate Complex", not "Butyrate Postbiotic-Metabolite Lane")
- In keyword_evidence, cite the actual buyer keywords that returned data (which are the inferred primary/related, not the display name)
- If the inferred decomposition spans multiple lanes (e.g. butyrate + tributyrin + postbiotic), feel free to differentiate concepts across those lanes — they're real adjacent buyer markets, not arbitrary splits
` : ''

  // Manual / supplier context block — rendered only when an upstream human or
  // supplier has pre-framed the idea (manual idea capture, supplier conversation
  // at a trade show, etc.). When present, at least one concept must be anchored
  // on this context. Empty notes = no block = identical prompt to pre-v3 runs.
  const manualNotes = (opts.manual_context || '').trim()
  const hasManualContext = manualNotes.length > 0
  const manualBlock = hasManualContext ? `

MANUAL / SUPPLIER CONTEXT (high-confidence pre-framing — HUMAN-PROVIDED):
- Source: ${opts.source || 'manual'}${opts.source_context ? ` (${opts.source_context})` : ''}
- Tags: ${(opts.signal_tags || []).join(', ') || '(none)'}
- Notes / spec / positioning:
${manualNotes}

** IMPORTANT — TREATMENT OF MANUAL CONTEXT **
This context was captured by a Toniiq team member or supplier and represents a high-confidence pre-framing of the opportunity. Treat it as a priority input alongside the Datarova / Reddit / science evidence.

Rules:
1. AT LEAST ONE of the 3 concepts MUST be directly anchored on the spec / positioning / supplier offer described in the Notes. If a supplier quoted a specific spec (% actives, price, format, organic option, etc.), build a concept that uses exactly that spec.
2. Other concepts MAY explore adjacent or alternative angles informed by keyword / Reddit / science evidence — but they should treat the manual context as a known baseline (e.g. higher-spec premium vs supplier baseline, complementary stack, condition-specific positioning).
3. In keyword_evidence / reddit_evidence / science_evidence arrays for the manual-context-anchored concept, you may add an entry of the form: { "signal": "supplier_spec", "data": "<exact quote from manual notes>" } — treat the manual notes themselves as Tier-1 evidence for that concept's positioning and spec.
4. Do NOT contradict or silently override the manual context. If keyword/Reddit/science evidence weakens the supplier-anchored concept, flag it honestly in that concept's confidence_reasoning rather than dropping the concept.
` : ''

  const r = await anthropicCall(apiKey, {
    model: OPUS,
    max_tokens: 8000,             // v2: was 12000
    thinking: { type: 'enabled', budget_tokens: 4000 },  // v2: was 8000
    system: `You are the Concept Synthesis agent for Toniiq — a premium supplement brand. You synthesize Phase A research (keyword demand + Reddit social signal + clinical science) into 3 product concepts per ingredient, each scored on confidence (0-10) with full evidence citations.

DATA INTEGRITY (CRITICAL — Toniiq has a history of hallucinated concepts):
- Every claim in keyword_evidence must reference specific keywords from the Datarova data supplied
- Every claim in reddit_evidence must reference specific pain points, brands, or quotes from the Reddit data supplied
- Every claim in science_evidence must reference a specific source (PMID/NCT/DOI) from the science data supplied
- Do NOT invent keyword volumes, pain points, or study citations
- If evidence is weak for a proposed concept, say so honestly in confidence_reasoning and lower the score
- If Reddit or science data is missing/empty, acknowledge the gap in confidence_reasoning rather than fabricating evidence

CONCEPT QUALITY:
- Generate 2-4 concepts (typically 3) — the BEST ones, ranked by confidence
- Cover different concept types: single_ingredient, combination, format_innovation, condition_specific
- For angle-framed ideas (liposomal X, X for men), make the angle the primary differentiator
- Positioning angle should be marketing-ready but truthful
- Confidence score reflects alignment across all 3 evidence streams (keyword + Reddit + science)

CONCISENESS: Keep evidence arrays focused — 2-3 strong signals per stream beats 6 weak ones.
positioning_angle and confidence_reasoning should be 1-3 sentences max.

Return STRICT JSON — an array of concept objects:
[
  {
    "concept_name": "...",
    "concept_type": "single_ingredient|combination|format_innovation|condition_specific",
    "format": "capsules|softgels|powder|liquid|gummies",
    "target_dosage": "e.g., 500mg daily",
    "key_ingredients": [{"name": "...", "dose": "...", "role": "primary/secondary"}],
    "positioning_angle": "1-2 sentence product positioning",
    "keyword_evidence": [{"signal": "...", "data": "specific keyword + numbers"}],
    "reddit_evidence": [{"signal": "...", "quote": "specific quote or data"}],
    "science_evidence": [{"signal": "...", "source": "PMID/NCT/DOI"}],
    "confidence_score": 0-10,
    "confidence_reasoning": "2-3 sentences"
  }
]`,
    messages: [{
      role: 'user',
      content: `Ingredient/concept: "${opts.ingredient}"\nCategory: ${opts.category || 'Uncategorized'}${inferredBlock}${manualBlock}\n\nDATAROVA (keyword demand):\n${JSON.stringify(datarovaSummary, null, 1)}\n\nREDDIT (social signal):\n${JSON.stringify(redditSummary, null, 1)}\n\nSCIENCE (clinical evidence):\n${JSON.stringify(opts.science, null, 1)}\n\nSynthesize 3 product concepts with evidence citations.${hasManualContext ? ' Remember: at least one concept must be anchored on the manual/supplier context above.' : ''}${hasInferredKeywords ? ' Use buyer-recognizable terminology in concept_name (per the inferred buyer keywords above).' : ''} Return JSON array.`,
    }],
  })
  const text = extractText(r)
  try {
    const arr = extractJson<any[]>(text)
    if (!Array.isArray(arr)) throw new Error('not an array')
    return arr.slice(0, 4).map(c => ({
      concept_name: c.concept_name || 'Unnamed',
      concept_type: c.concept_type || 'single_ingredient',
      format: c.format || null,
      target_dosage: c.target_dosage || null,
      key_ingredients: c.key_ingredients || [],
      positioning_angle: c.positioning_angle || null,
      keyword_evidence: c.keyword_evidence || [],
      reddit_evidence: c.reddit_evidence || [],
      science_evidence: c.science_evidence || [],
      confidence_score: typeof c.confidence_score === 'number' ? c.confidence_score : 5,
      confidence_reasoning: c.confidence_reasoning || '',
    }))
  } catch (e) {
    throw new Error(`Concept synthesis parse failed: ${(e as Error).message}`)
  }
}
