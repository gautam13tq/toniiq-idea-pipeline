-- Piece 1 of the Amazon ideas rebuild (2026-10-22): one entry point for scoring an idea.
--
-- score_idea(jsonb) finds or creates the idea (idea_candidates) and its concept
-- (product_concepts), returns a fresh Phase B v5 score if one exists, and otherwise
-- queues exactly one run_phase_b for the existing cron dispatcher. Calling it again
-- with the same input never creates duplicate rows or a second run.
-- idea_score_result(uuid) is the one result shape every consumer reads.
-- Phase B itself (phase-b-evaluate, scoring_core.ts) is unchanged.
--
-- Callers: the agent through SQL (Supabase connector), later an HTTP wrapper or the UI.
-- Only service_role (and postgres) may execute; queuing spends Datarova, Apify, Keepa
-- and Claude credits.

CREATE OR REPLACE FUNCTION public.normalize_idea_name(p_name text)
 RETURNS text LANGUAGE sql IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
  -- Same rule as normalizeIdeaName() in src/lib/opportunity.js, so UI and agent
  -- map an idea to the same idea_candidates row.
  SELECT btrim(regexp_replace(
    regexp_replace(lower(coalesce(p_name, '')),
      '\m(supplements?|capsules?|powders?|gumm(y|ies)|tablets?|softgels?|liquid|organic|pure|natural|for women|for men|for kids)\M',
      ' ', 'g'),
    '\s+', ' ', 'g'))
$function$;

CREATE OR REPLACE FUNCTION public.idea_score_result(p_score_id uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  s concept_scores%ROWTYPE;
  c product_concepts%ROWTYPE;
  r concept_competitive_research%ROWTYPE;
  a pending_actions%ROWTYPE;
  v_enrichment_id uuid;
  v_passed boolean;
  v_f jsonb;
  v_dq jsonb;
  v_sub jsonb;
  v_competitors jsonb;
BEGIN
  SELECT * INTO s FROM concept_scores WHERE id = p_score_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO c FROM product_concepts WHERE id = s.concept_id;

  IF coalesce(s.scoring_version, '') NOT LIKE 'phase-b-v5%' THEN
    RETURN jsonb_build_object(
      'idea_name', c.concept_name, 'concept_id', s.concept_id, 'candidate_id', c.candidate_id,
      'score_id', s.id, 'scoring_version', s.scoring_version, 'scale', s.score_scale,
      'composite', s.composite_score, 'tier', s.recommendation_tier, 'scored_at', s.scored_at,
      'note', 'Not a Phase B v5 score; only composite and tier are available.');
  END IF;

  -- Phase B writes the competitor snapshot just before the score row, and completes
  -- its pending action just after.
  SELECT * INTO r FROM concept_competitive_research
   WHERE concept_id = s.concept_id AND researched_at <= s.scored_at + interval '5 minutes'
   ORDER BY researched_at DESC LIMIT 1;
  SELECT * INTO a FROM pending_actions
   WHERE entity_type = 'concept' AND entity_id = s.concept_id AND action = 'run_phase_b'
     AND completed_at BETWEEN s.scored_at - interval '1 minute' AND s.scored_at + interval '5 minutes'
   ORDER BY completed_at LIMIT 1;
  SELECT id INTO v_enrichment_id FROM datarova_enrichments
   WHERE candidate_id = c.candidate_id AND enriched_at <= s.scored_at
   ORDER BY enriched_at DESC LIMIT 1;

  v_passed := s.quality_gate_status = 'passed';
  v_f := coalesce(s.competitive_frame, '{}'::jsonb);
  v_dq := coalesce(s.data_quality_summary, '{}'::jsonb);
  v_sub := s.pillar_competitive_subsignals;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'asin', x.p->'asin', 'brand', x.p->'brand', 'title', x.p->'title',
           'price', x.p->'price', 'reviews', x.p->'reviews', 'rating', x.p->'rating',
           'monthly_sold', x.p->'monthly_sold',
           'bsr', coalesce(nullif(x.p->'bsr_current', 'null'::jsonb), x.p->'bsr_avg30'),
           'url', x.p->'amazon_url') ORDER BY x.i), '[]'::jsonb)
    INTO v_competitors
    FROM jsonb_array_elements(CASE WHEN jsonb_typeof(r.top_products) = 'array' THEN r.top_products ELSE '[]'::jsonb END)
         WITH ORDINALITY AS x(p, i)
   WHERE x.i <= 10;

  RETURN jsonb_build_object(
    'idea_name', c.concept_name,
    'concept_id', s.concept_id,
    'candidate_id', c.candidate_id,
    'score_id', s.id,
    'scoring_version', s.scoring_version,
    'scale', s.score_scale,
    'gate', jsonb_build_object(
      'status', s.quality_gate_status,
      'reason', CASE WHEN v_passed THEN 'all gates passed'
                     ELSE coalesce(substring(s.overall_assessment from '^Quality gate failed: (.*)\. No composite score published\.$'),
                                   s.overall_assessment) END),
    'composite', CASE WHEN v_passed THEN s.composite_score END,
    'tier', CASE WHEN v_passed THEN s.recommendation_tier END,
    'composite_cap', CASE WHEN v_passed THEN s.competition_gate->'composite_cap' END,
    'cap_applied', CASE WHEN v_passed THEN coalesce(s.competition_gate->'caps_applied', '[]'::jsonb) END,
    'pillars', CASE WHEN v_passed THEN jsonb_build_object(
      'demand', s.pillar_demand_score, 'growth', s.pillar_growth_score,
      'competitive', s.pillar_competitive_score, 'differentiation', s.pillar_diff_score) END,
    'weights', s.composite_weights,
    'competitive_signals', CASE WHEN v_sub IS NOT NULL THEN jsonb_build_object(
      'review_moat', v_sub->'review_moat'->'score',
      'rev_review', v_sub->'rev_review_efficiency'->'score',
      'bsr', v_sub->'bsr_concentration'->'score',
      'brand', v_sub->'brand_concentration'->'score',
      'density', v_sub->'competitor_density'->'score',
      'premium', v_sub->'premium_tier_viability'->'score',
      'spec', v_sub->'spec_wedge'->'score') END,
    'growth', s.pillar_growth_details,
    'frame', jsonb_build_object(
      'type', v_f->'frame',
      'hero', v_f->'hero_ingredient',
      'modifier', v_f->'delivery_modifier',
      'combo_terms', CASE WHEN v_f->'delivery_modifier' IS NULL OR v_f->'delivery_modifier' = 'null'::jsonb
                          THEN coalesce(v_f->'require_any', '[]'::jsonb) ELSE '[]'::jsonb END,
      'query_packet', v_f->'query_packet',
      'include_terms', v_f->'include_terms',
      'exclude_terms', v_f->'exclude_terms',
      'reasoning', v_f->'reasoning'),
    'demand', jsonb_build_object(
      'source', v_dq->'demand_source',
      'primary_keyword', v_dq->'demand_primary_keyword',
      'primary_clicks', v_dq->'demand_primary_clicks',
      'frame_relevant_clicks', v_dq->'demand_frame_relevant_clicks',
      'rows_with_data', v_dq->'demand_rows_with_data',
      'gate_path', v_dq->'demand_gate_path'),
    'competitors', v_competitors,
    'differentiation', CASE WHEN v_passed THEN jsonb_build_object(
      'vectors_available', s.diff_vectors_available, 'vectors', s.diff_vector_details) END,
    'data_quality', jsonb_build_object(
      'discovered', v_dq->'discovery_result_count',
      'included', v_dq->'included_count',
      'adjacent', v_dq->'adjacent_count',
      'excluded', v_dq->'excluded_count',
      'keepa_covered_pct', v_dq->'keepa_coverage_pct',
      'monthly_sold_badge_pct', v_dq->'monthly_sold_badge_pct',
      'keepa_tokens', v_dq->'keepa_tokens_consumed'),
    'assessment', jsonb_build_object(
      'summary', s.overall_assessment, 'opportunities', s.opportunity_signals,
      'risks', s.risk_factors, 'next_steps', s.next_steps),
    'evidence_links', jsonb_build_object(
      'competitive_research_id', r.id, 'datarova_enrichment_id', v_enrichment_id,
      'pending_action_id', a.id),
    'scored_at', s.scored_at,
    'run_ms', CASE WHEN a.started_at IS NOT NULL
                   THEN round(extract(epoch FROM a.completed_at - a.started_at) * 1000) END
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public._score_idea_core(p jsonb)
 RETURNS jsonb LANGUAGE plpgsql VOLATILE
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_name text := nullif(btrim(p->>'idea_name'), '');
  v_notes text := nullif(btrim(p->>'notes'), '');
  v_format text := nullif(btrim(p->>'format'), '');
  v_force boolean := coalesce((p->>'force_rerun')::boolean, false);
  v_max_age interval := make_interval(days => coalesce((p->>'max_age_days')::int, 60));
  v_norm text;
  v_cand idea_candidates%ROWTYPE;
  v_concept product_concepts%ROWTYPE;
  v_new_candidate boolean := false;
  v_new_concept boolean := false;
  v_score_id uuid;
  v_scored_at timestamptz;
  v_prev jsonb;
  v_act pending_actions%ROWTYPE;
  v_cap int;
  v_used int;
  v_base jsonb;
BEGIN
  -- 1. Resolve the idea and its concept.
  IF nullif(p->>'concept_id', '') IS NOT NULL THEN
    SELECT * INTO v_concept FROM product_concepts WHERE id = (p->>'concept_id')::uuid FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'score_idea: concept % not found', p->>'concept_id'; END IF;
    SELECT * INTO v_cand FROM idea_candidates WHERE id = v_concept.candidate_id;
  ELSE
    IF v_name IS NULL THEN RAISE EXCEPTION 'score_idea: idea_name or concept_id is required'; END IF;
    IF nullif(p->>'candidate_id', '') IS NOT NULL THEN
      SELECT * INTO v_cand FROM idea_candidates WHERE id = (p->>'candidate_id')::uuid;
      IF NOT FOUND THEN RAISE EXCEPTION 'score_idea: candidate % not found', p->>'candidate_id'; END IF;
    ELSE
      v_norm := normalize_idea_name(v_name);
      IF v_norm = '' THEN RAISE EXCEPTION 'score_idea: idea_name "%" is empty after normalising', v_name; END IF;
      -- Older imports used other normalisers, so an exact name match counts too.
      SELECT * INTO v_cand FROM idea_candidates
       WHERE ingredient_name_normalized = v_norm OR lower(btrim(ingredient_name)) = lower(v_name)
       ORDER BY (ingredient_name_normalized = v_norm) DESC
       LIMIT 1;
      IF NOT FOUND THEN
        INSERT INTO idea_candidates (ingredient_name, ingredient_name_normalized, stage, notes, surfaced_week)
        VALUES (v_name, v_norm, 'inbox', v_notes, date_trunc('week', now())::date)
        ON CONFLICT (ingredient_name_normalized) DO NOTHING
        RETURNING * INTO v_cand;
        v_new_candidate := FOUND;
        IF NOT v_new_candidate THEN
          SELECT * INTO v_cand FROM idea_candidates WHERE ingredient_name_normalized = v_norm;
        END IF;
      END IF;
    END IF;

    -- Serialise concurrent calls for the same idea so they can't create two concepts.
    PERFORM pg_advisory_xact_lock(hashtextextended('score_idea:' || v_cand.id::text, 0));

    SELECT * INTO v_concept FROM product_concepts
     WHERE candidate_id = v_cand.id AND lower(btrim(concept_name)) = lower(v_name)
     ORDER BY (status IN ('rejected', 'parked', 'archived')), generated_at DESC NULLS LAST
     LIMIT 1
     FOR UPDATE;
    IF NOT FOUND THEN
      -- Created as 'proposed' so the status trigger doesn't queue Phase B before the
      -- budget check below; step 7 moves it to 'accepted'.
      INSERT INTO product_concepts (candidate_id, concept_name, concept_type, format, positioning_angle, status, decision_notes)
      VALUES (v_cand.id, v_name, 'agent_idea', v_format, v_notes, 'proposed', 'Created by score_idea for Phase B scoring.')
      RETURNING * INTO v_concept;
      v_new_concept := true;
    END IF;
  END IF;

  v_base := jsonb_build_object(
    'idea_name', v_concept.concept_name,
    'concept_id', v_concept.id,
    'candidate_id', v_concept.candidate_id,
    'concept_status', v_concept.status,
    'created', jsonb_build_object('candidate', v_new_candidate, 'concept', v_new_concept));

  -- 2. A fresh v5 score answers the call (gate-failed scores count: they are results).
  SELECT id, scored_at INTO v_score_id, v_scored_at FROM concept_scores
   WHERE concept_id = v_concept.id AND scoring_version LIKE 'phase-b-v5%'
   ORDER BY scored_at DESC NULLS LAST LIMIT 1;
  IF v_score_id IS NOT NULL THEN
    v_prev := idea_score_result(v_score_id);
    IF v_scored_at > now() - v_max_age AND NOT v_force THEN
      RETURN v_base || jsonb_build_object('status', 'scored', 'result', v_prev);
    END IF;
  END IF;

  -- 3. A run already queued or running is returned, never duplicated.
  SELECT * INTO v_act FROM pending_actions
   WHERE entity_type = 'concept' AND entity_id = v_concept.id AND action = 'run_phase_b'
     AND status IN ('pending', 'in_progress')
   ORDER BY created_at DESC LIMIT 1;
  IF FOUND THEN
    RETURN v_base || jsonb_build_object(
      'status', CASE v_act.status WHEN 'pending' THEN 'queued' ELSE 'running' END,
      'action_id', v_act.id, 'queued_at', v_act.created_at, 'started_at', v_act.started_at,
      'previous_result', v_prev);
  END IF;

  -- 4. A run that failed in the last 24 hours without writing a score (infra error,
  --    timeout, crash) is reported instead of retried, so polling can't burn credits.
  SELECT * INTO v_act FROM pending_actions
   WHERE entity_type = 'concept' AND entity_id = v_concept.id AND action = 'run_phase_b'
     AND status = 'failed' AND completed_at > now() - interval '24 hours'
     AND completed_at > coalesce(v_scored_at + interval '5 minutes', '-infinity'::timestamptz)
   ORDER BY completed_at DESC LIMIT 1;
  IF FOUND AND NOT v_force THEN
    RETURN v_base || jsonb_build_object(
      'status', 'failed', 'action_id', v_act.id, 'failed_at', v_act.completed_at,
      'reason', v_act.notes, 'infra_error', v_act.context->'infra_error',
      'hint', 'Fix the cause, then call again with force_rerun true.',
      'previous_result', v_prev);
  END IF;

  -- 5. Phase B sets the concept to 'evaluated' when it finishes, so it must not run
  --    on a concept someone has already decided on.
  IF v_concept.status NOT IN ('proposed', 'accepted', 'evaluated') THEN
    RETURN v_base || jsonb_build_object(
      'status', 'blocked',
      'reason', format('Concept is %s; rescoring would overwrite that decision.', v_concept.status),
      'previous_result', v_prev);
  END IF;

  -- 6. Daily budget for runs queued through this entry point.
  SELECT CASE WHEN value ~ '^\d+$' THEN value::int END INTO v_cap
    FROM system_config WHERE key = 'score_idea_daily_cap';
  v_cap := coalesce(v_cap, 10);
  SELECT count(*) INTO v_used FROM pending_actions
   WHERE action = 'run_phase_b' AND context->>'source' = 'score_idea'
     AND created_at > now() - interval '24 hours';
  IF v_used >= v_cap THEN
    RETURN v_base || jsonb_build_object(
      'status', 'over_budget',
      'reason', format('%s of %s score_idea runs used in the last 24 hours (system_config score_idea_daily_cap).', v_used, v_cap),
      'previous_result', v_prev);
  END IF;

  -- 7. Queue one run. The dispatcher picks it up after 30 s.
  INSERT INTO pending_actions (entity_type, entity_id, action, triggered_by, status, context)
  VALUES ('concept', v_concept.id, 'run_phase_b', 'llm', 'pending', jsonb_strip_nulls(jsonb_build_object(
    'source', 'score_idea',
    'concept_name', v_concept.concept_name,
    'candidate_id', v_concept.candidate_id,
    'notion_page_id', p->>'notion_page_id',
    'lane', p->>'lane',
    'planned_price', p->'planned_price',
    'force_rerun', v_force,
    'requested_at', now())))
  RETURNING * INTO v_act;
  IF v_concept.status = 'proposed' THEN
    -- The status trigger sees the pending run above and doesn't add another.
    UPDATE product_concepts SET status = 'accepted' WHERE id = v_concept.id;
    v_base := v_base || jsonb_build_object('concept_status', 'accepted');
  END IF;

  RETURN v_base || jsonb_build_object(
    'status', 'queued', 'action_id', v_act.id, 'queued_at', v_act.created_at,
    'budget', jsonb_build_object('used', v_used + 1, 'cap', v_cap),
    'previous_result', v_prev);
END;
$function$;

CREATE OR REPLACE FUNCTION public.score_idea(p jsonb)
 RETURNS jsonb LANGUAGE plpgsql VOLATILE
 SET search_path TO 'public', 'pg_temp'
AS $function$
-- Input: { idea_name, notes?, format?, lane?, planned_price?, notion_page_id?,
--          candidate_id?, concept_id?, force_rerun?, max_age_days?, dry_run? }
-- Output status: scored | queued | running | failed | blocked | over_budget.
-- dry_run true runs the same path and rolls it back: nothing is written or queued.
DECLARE
  v_result jsonb;
BEGIN
  IF NOT coalesce((p->>'dry_run')::boolean, false) THEN
    RETURN _score_idea_core(p);
  END IF;
  BEGIN
    v_result := _score_idea_core(p);
    RAISE EXCEPTION USING ERRCODE = 'SIDRY', MESSAGE = 'score_idea dry run';
  EXCEPTION WHEN SQLSTATE 'SIDRY' THEN
    RETURN v_result || jsonb_build_object(
      'dry_run', true, 'note', 'Dry run: nothing was written or queued; ids of new rows are not real.');
  END;
END;
$function$;

REVOKE ALL ON FUNCTION public.score_idea(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._score_idea_core(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.idea_score_result(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.score_idea(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public._score_idea_core(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.idea_score_result(uuid) TO service_role;

COMMENT ON FUNCTION public.score_idea(jsonb) IS
  'Piece 1 entry point: find or create an idea and its concept, return a fresh Phase B v5 score or queue exactly one run_phase_b. Statuses: scored, queued, running, failed, blocked, over_budget. dry_run rolls back.';
COMMENT ON FUNCTION public.idea_score_result(uuid) IS
  'The one result shape for a concept_scores row (Phase B v5): gate, composite, tier, pillars, competitive signals, frame, demand, top 10 competitors, data quality, evidence links.';
