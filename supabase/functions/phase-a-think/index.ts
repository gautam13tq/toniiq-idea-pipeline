/**
 * phase-a-think — Phase A steps 3 & 4 (Science research + Concept synthesis)
 *
 * Chained from phase-a-gather. Loads the candidate + prior enrichment/reddit
 * rows, runs science research with Sonnet + web search tool, then synthesizes
 * 3 product concepts with Opus (extended thinking).
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

    const { data: action, error: aErr } = await sb.from('pending_actions').select('*').eq('id', actionId).single()
    if (aErr || !action) throw new Error(`Action not found: ${aErr?.message}`)
    const candidateId = action.entity_id
    const { data: candidate } = await sb.from('idea_candidates').select('*').eq('id', candidateId).single()
    if (!candidate) throw new Error('Candidate not found')

    // Load prior enrichment (gather must have run first)
    const [{ data: datarova }, { data: reddit }] = await Promise.all([
      sb.from('datarova_enrichments').select('*').eq('candidate_id', candidateId).order('enriched_at', { ascending: false }).limit(1).maybeSingle(),
      sb.from('reddit_concept_research').select('*').eq('candidate_id', candidateId).order('researched_at', { ascending: false }).limit(1).maybeSingle(),
    ])

    // ── STEP 3: SCIENCE RESEARCH (Sonnet + web search) ───────────────────
    await setActionStatus(sb, actionId, 'in_progress', { context_merge: { science: 'running' } })

    const scienceResult = await runScienceResearch(secrets.anthropic_api_key, candidate.ingredient_name)

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

    // ── STEP 4: CONCEPT SYNTHESIS (Opus with extended thinking) ──────────
    await setActionStatus(sb, actionId, 'in_progress', { context_merge: { synthesis: 'running' } })

    const concepts = await synthesizeConcepts(secrets.anthropic_api_key, {
      ingredient: candidate.ingredient_name,
      category: candidate.category,
      datarova, reddit, science: scienceResult,
    })

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

    // Idea stage will auto-update to 'research' via the rollup trigger (concept insert triggers it).
    await setActionStatus(sb, actionId, 'completed', {
      notes: `Phase A complete. ${concepts.length} concepts generated.`,
      context_merge: { synthesis: 'done', concepts_count: concepts.length, completed_at: new Date().toISOString() },
    })

    return new Response(JSON.stringify({ ok: true, step: 'think', action_id: actionId, concepts: concepts.length }), {
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('phase-a-think error:', msg)
    try {
      const sb = svcClient()
      const body = await req.clone().json().catch(() => ({}))
      if (body.pending_action_id) {
        await setActionStatus(sb, body.pending_action_id, 'failed', { notes: `think failed: ${msg}` })
      }
    } catch (_) { /* ignore */ }
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders },
    })
  }
})

// ── Science Research (Sonnet + web search) ─────────────────────────────
async function runScienceResearch(apiKey: string, ingredient: string): Promise<any> {
  const r = await anthropicCall(apiKey, {
    model: SONNET,
    max_tokens: 8000,
    tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }],
    system: `You are the Science Research sub-agent for Toniiq's supplement ideation pipeline. For the given ingredient/concept, research the clinical and scientific landscape, then return structured JSON.

DATA INTEGRITY (Toniiq has a history of hallucinated studies — this is non-negotiable):
- Every clinical dosage must cite a real study (PubMed ID, DOI, or ClinicalTrials.gov NCT number)
- Every bioavailability claim must cite a real paper
- If you cannot find a real citation for a claim, OMIT the claim or mark it "[cite: pending — general literature]"
- Do NOT invent trial names, PMIDs, or dosing figures
- Use web_search tool 3-5 times to find real papers

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

// ── Concept Synthesis (Opus with extended thinking) ─────────────────────
async function synthesizeConcepts(apiKey: string, opts: {
  ingredient: string; category?: string; datarova: any; reddit: any; science: any;
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

  const r = await anthropicCall(apiKey, {
    model: OPUS,
    max_tokens: 12000,
    thinking: { type: 'enabled', budget_tokens: 8000 },
    system: `You are the Concept Synthesis agent for Toniiq — a premium supplement brand. You synthesize Phase A research (keyword demand + Reddit social signal + clinical science) into 3 product concepts per ingredient, each scored on confidence (0-10) with full evidence citations.

DATA INTEGRITY (CRITICAL — Toniiq has a history of hallucinated concepts):
- Every claim in keyword_evidence must reference specific keywords from the Datarova data supplied
- Every claim in reddit_evidence must reference specific pain points, brands, or quotes from the Reddit data supplied
- Every claim in science_evidence must reference a specific source (PMID/NCT/DOI) from the science data supplied
- Do NOT invent keyword volumes, pain points, or study citations
- If evidence is weak for a proposed concept, say so honestly in confidence_reasoning and lower the score

CONCEPT QUALITY:
- Generate 2-4 concepts (typically 3) — the BEST ones, ranked by confidence
- Cover different concept types: single_ingredient, combination, format_innovation, condition_specific
- For angle-framed ideas (liposomal X, X for men), make the angle the primary differentiator
- Positioning angle should be marketing-ready but truthful
- Confidence score reflects alignment across all 3 evidence streams (keyword + Reddit + science)

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
    "confidence_reasoning": "2-4 sentences — what supports the score, what tempers it"
  }
]`,
    messages: [{
      role: 'user',
      content: `Ingredient/concept: "${opts.ingredient}"\nCategory: ${opts.category || 'Uncategorized'}\n\nDATAROVA (keyword demand):\n${JSON.stringify(datarovaSummary, null, 1)}\n\nREDDIT (social signal):\n${JSON.stringify(redditSummary, null, 1)}\n\nSCIENCE (clinical evidence):\n${JSON.stringify(opts.science, null, 1)}\n\nSynthesize 3 product concepts with evidence citations. Return JSON array.`,
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
