-- Exported from live Supabase toniiq-npd (gmfndxaoeztxohbbkudu), supabase_migrations.schema_migrations, on 2026-10-22.
-- Eval extension 2026-08-19: add pipeline-level checks to run_pipeline_quality_audit().
-- New findings rows use entity_type='pipeline'. Existing per-concept logic unchanged.
CREATE OR REPLACE FUNCTION public.run_pipeline_quality_audit()
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_run uuid := gen_random_uuid();
  r record;
  v_findings jsonb;
  v_crit int; v_warn int;
  v_total int := 0; v_tot_crit int := 0; v_tot_warn int := 0;
  v_pipe_findings jsonb := '[]'::jsonb;
  v_pipe_crit int := 0; v_pipe_warn int := 0;
  v_active_count int;
BEGIN
  -- ===== Per-concept checks (unchanged) =====
  FOR r IN
    SELECT pc.id AS concept_id, pc.concept_name, pc.candidate_id, ic.ingredient_name,
      cs.id AS score_id, cs.composite_score, cs.quality_gate_status, cs.scored_at,
      cs.pillar_demand_score, cs.pillar_competitive_score, cs.pillar_diff_score,
      ccr.total_competitors,
      (SELECT count(*) FROM reddit_concept_research rr WHERE rr.candidate_id = ic.id) AS reddit_rows,
      (SELECT count(*) FROM voc_insights v WHERE v.candidate_id = ic.id) AS voc_rows
    FROM product_concepts pc
    JOIN idea_candidates ic ON ic.id = pc.candidate_id
    LEFT JOIN LATERAL (SELECT * FROM concept_scores WHERE concept_id = pc.id ORDER BY scored_at DESC NULLS LAST LIMIT 1) cs ON true
    LEFT JOIN LATERAL (SELECT * FROM concept_competitive_research WHERE concept_id = pc.id ORDER BY researched_at DESC NULLS LAST LIMIT 1) ccr ON true
    WHERE pc.status = 'evaluated' AND ic.stage = 'evaluation' AND ic.shelved_at IS NULL
  LOOP
    v_findings := '[]'::jsonb; v_crit := 0; v_warn := 0;

    IF r.score_id IS NULL THEN
      v_findings := v_findings || jsonb_build_object('check','score_missing','severity','critical','detail','No concept_scores row despite status=evaluated'); v_crit := v_crit + 1;
    ELSIF r.composite_score IS NULL OR coalesce(r.quality_gate_status,'') <> 'passed' THEN
      v_findings := v_findings || jsonb_build_object('check','gate_failed','severity','critical','detail', concat('Quality gate: ', coalesce(r.quality_gate_status,'unknown'), ' — no publishable composite; should not sit in the decide queue')); v_crit := v_crit + 1;
    ELSIF r.pillar_demand_score IS NULL OR r.pillar_competitive_score IS NULL OR r.pillar_diff_score IS NULL THEN
      v_findings := v_findings || jsonb_build_object('check','pillar_incomplete','severity','critical','detail','Composite present but pillar scores missing'); v_crit := v_crit + 1;
    END IF;

    IF coalesce(r.total_competitors, 0) < 8 THEN
      v_findings := v_findings || jsonb_build_object('check','thin_competitor_set','severity','warn','detail', concat('Only ', coalesce(r.total_competitors,0), ' competitors in research (want >= 8)')); v_warn := v_warn + 1;
    END IF;
    IF r.reddit_rows = 0 THEN
      v_findings := v_findings || jsonb_build_object('check','no_reddit_research','severity','warn','detail','No Reddit research rows for this idea (Phase A branch failed or skipped)'); v_warn := v_warn + 1;
    END IF;
    IF r.voc_rows = 0 THEN
      v_findings := v_findings || jsonb_build_object('check','no_voc_mining','severity','warn','detail','No verified voice-of-customer insight for this idea'); v_warn := v_warn + 1;
    END IF;
    IF r.scored_at IS NOT NULL AND r.scored_at < now() - interval '60 days' THEN
      v_findings := v_findings || jsonb_build_object('check','stale_score','severity','warn','detail', concat('Score is from ', r.scored_at::date, ' (>60 days old)')); v_warn := v_warn + 1;
    END IF;

    INSERT INTO quality_audits (run_id, entity_type, entity_id, entity_name, candidate_id, findings, critical_count, warn_count)
    VALUES (v_run, 'concept', r.concept_id, r.concept_name, r.candidate_id, v_findings, v_crit, v_warn);
    v_total := v_total + 1; v_tot_crit := v_tot_crit + v_crit; v_tot_warn := v_tot_warn + v_warn;
  END LOOP;

  -- ===== NEW pipeline-level checks (2026-08-19) =====

  -- A. Stuck machine actions: pending >48h or in_progress >24h.
  --    decide_greenlight is Gautam's human queue — excluded on purpose.
  FOR r IN
    SELECT id, action, status, created_at, started_at
    FROM pending_actions
    WHERE action IN ('run_phase_a','run_phase_b','run_voc_mining','run_field_report','create_dev_folder')
      AND ( (status = 'pending' AND created_at < now() - interval '48 hours')
         OR (status = 'in_progress' AND started_at < now() - interval '24 hours') )
  LOOP
    v_pipe_findings := v_pipe_findings || jsonb_build_object(
      'check','stuck_action','severity','warn',
      'detail', concat(r.action, ' ', r.status, ' since ', coalesce(r.started_at, r.created_at)::date, ' (id ', r.id, ')'));
    v_pipe_warn := v_pipe_warn + 1;
  END LOOP;

  -- B. Stage drift: a greenlit/in_development concept whose idea is not in 'development'.
  --    (The Ginseng/Diosmin failure mode.)
  FOR r IN
    SELECT pc.id, pc.concept_name, ic.stage
    FROM product_concepts pc JOIN idea_candidates ic ON ic.id = pc.candidate_id
    WHERE pc.status IN ('greenlit','in_development') AND ic.stage <> 'development'
  LOOP
    v_pipe_findings := v_pipe_findings || jsonb_build_object(
      'check','stage_drift','severity','critical',
      'detail', concat('"', r.concept_name, '" is ', 'in development but its idea sits at stage=', r.stage));
    v_pipe_crit := v_pipe_crit + 1;
  END LOOP;

  -- C. Registry consistency: Active Development over the hard cap of 13,
  --    and dev-status concepts with no registry row.
  SELECT count(*) INTO v_active_count FROM npd_registry_products WHERE queue = 'Active Development';
  IF v_active_count > 13 THEN
    v_pipe_findings := v_pipe_findings || jsonb_build_object(
      'check','active_over_cap','severity','warn',
      'detail', concat('Active Development has ', v_active_count, ' products (hard cap 13 — something must leave)'));
    v_pipe_warn := v_pipe_warn + 1;
  END IF;
  FOR r IN
    SELECT pc.id, pc.concept_name
    FROM product_concepts pc
    WHERE pc.status IN ('greenlit','in_development')
      AND NOT EXISTS (SELECT 1 FROM npd_registry_products n WHERE n.concept_id = pc.id)
  LOOP
    v_pipe_findings := v_pipe_findings || jsonb_build_object(
      'check','registry_row_missing','severity','warn',
      'detail', concat('"', r.concept_name, '" is in development but has no npd_registry_products row'));
    v_pipe_warn := v_pipe_warn + 1;
  END LOOP;

  IF jsonb_array_length(v_pipe_findings) > 0 THEN
    INSERT INTO quality_audits (run_id, entity_type, entity_id, entity_name, findings, critical_count, warn_count)
    VALUES (v_run, 'pipeline', v_run, 'pipeline-level checks', v_pipe_findings, v_pipe_crit, v_pipe_warn);
    v_total := v_total + 1; v_tot_crit := v_tot_crit + v_pipe_crit; v_tot_warn := v_tot_warn + v_pipe_warn;
  END IF;

  RETURN jsonb_build_object('run_id', v_run, 'concepts_audited', v_total, 'critical', v_tot_crit, 'warnings', v_tot_warn);
END;
$function$;
