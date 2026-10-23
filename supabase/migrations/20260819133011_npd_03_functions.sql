-- Exported from live Supabase toniiq-npd (gmfndxaoeztxohbbkudu), supabase_migrations.schema_migrations, on 2026-10-22.
CREATE OR REPLACE FUNCTION public.enqueue_concept_action()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_action text;
  v_gate text;
  v_composite numeric;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status = OLD.status THEN
    RETURN NEW;
  END IF;

  v_action := CASE NEW.status
    WHEN 'accepted'  THEN 'run_phase_b'
    WHEN 'evaluated' THEN 'decide_greenlight'
    WHEN 'greenlit'  THEN 'create_dev_folder'
    ELSE NULL
  END;

  IF v_action IS NULL THEN
    RETURN NEW;
  END IF;

  IF v_action = 'decide_greenlight' THEN
    SELECT quality_gate_status, composite_score INTO v_gate, v_composite
    FROM concept_scores WHERE concept_id = NEW.id
    ORDER BY scored_at DESC NULLS LAST LIMIT 1;
    IF v_composite IS NULL OR coalesce(v_gate,'') <> 'passed' THEN
      RETURN NEW;  -- incomplete/gate-failed: no human decision queued
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pending_actions
    WHERE entity_type = 'concept'
      AND entity_id = NEW.id
      AND action = v_action
      AND status IN ('pending', 'in_progress')
  ) THEN
    RETURN NEW;
  END IF;

  INSERT INTO pending_actions (entity_type, entity_id, action, triggered_by, context)
  VALUES (
    'concept', NEW.id, v_action, 'trigger',
    jsonb_build_object('concept_name', NEW.concept_name, 'candidate_id', NEW.candidate_id)
  );

  RETURN NEW;
END;
$function$;


CREATE OR REPLACE FUNCTION public.link_atlas_entry_to_review()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_candidate_name TEXT;
  v_target_atlas_id UUID;
BEGIN
  -- Only act on category_atlas-sourced reviews
  IF NEW.source IS DISTINCT FROM 'category_atlas' THEN
    RETURN NEW;
  END IF;

  -- Resolve the candidate's ingredient_name (the join key to category_atlas_entries.name)
  SELECT ingredient_name INTO v_candidate_name
  FROM idea_candidates
  WHERE id = NEW.candidate_id;

  IF v_candidate_name IS NULL THEN
    RETURN NEW;
  END IF;

  -- Pick the best matching atlas entry: prefer hybrid_scored, then scored, then
  -- pending lanes. Skip entries that already have a backlink (no overwrites).
  SELECT id INTO v_target_atlas_id
  FROM category_atlas_entries
  WHERE LOWER(TRIM(name)) = LOWER(TRIM(v_candidate_name))
    AND promoted_review_id IS NULL
  ORDER BY 
    CASE score_status
      WHEN 'hybrid_scored' THEN 1
      WHEN 'scored' THEN 2
      WHEN 'pending_hybrid' THEN 3
      WHEN 'pending_v4' THEN 4
      ELSE 5
    END,
    scored_at DESC NULLS LAST
  LIMIT 1;

  IF v_target_atlas_id IS NOT NULL THEN
    UPDATE category_atlas_entries
    SET promoted_review_id = NEW.id, updated_at = NOW()
    WHERE id = v_target_atlas_id;
  END IF;

  RETURN NEW;
END;
$function$;


CREATE OR REPLACE FUNCTION public.rollup_idea_stage_from_concepts()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  candidate uuid;
  new_stage idea_stage;
  has_in_dev boolean;
  has_greenlit boolean;
  has_evaluated boolean;
  has_accepted boolean;
  has_proposed boolean;
  has_active boolean;
  all_terminal boolean;
BEGIN
  candidate := COALESCE(NEW.candidate_id, OLD.candidate_id);
  IF candidate IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;

  SELECT
    bool_or(status = 'in_development'),
    bool_or(status = 'greenlit'),
    bool_or(status = 'evaluated'),
    bool_or(status = 'accepted'),
    bool_or(status = 'proposed'),
    bool_or(status NOT IN ('rejected','parked','archived')),
    bool_and(status IN ('rejected','parked','archived'))
  INTO has_in_dev, has_greenlit, has_evaluated, has_accepted, has_proposed, has_active, all_terminal
  FROM product_concepts WHERE candidate_id = candidate;

  IF has_in_dev OR has_greenlit THEN
    new_stage := 'development';
  ELSIF has_evaluated THEN
    new_stage := 'evaluation';
  ELSIF has_accepted OR has_proposed THEN
    new_stage := 'research';
  ELSIF all_terminal = true THEN
    new_stage := 'archive';
  ELSE
    RETURN COALESCE(NEW, OLD);
  END IF;

  UPDATE idea_candidates SET stage = new_stage, last_updated_at = NOW()
  WHERE id = candidate AND stage <> new_stage;

  RETURN COALESCE(NEW, OLD);
END;
$function$;


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
BEGIN
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

  RETURN jsonb_build_object('run_id', v_run, 'concepts_audited', v_total, 'critical', v_tot_crit, 'warnings', v_tot_warn);
END;
$function$;


CREATE OR REPLACE FUNCTION public.sync_greenlit_concept_to_npd_registry()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_active_count integer;
  v_queue text;
  v_sort_order integer;
  v_score numeric;
  v_tier text;
  v_assessment text;
  v_quality_gate text;
  v_scoring_version text;
  v_ingredient text;
  v_category text;
  v_confidence text;
  v_lv_band text;
BEGIN
  IF NEW.status NOT IN ('greenlit', 'in_development') THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.npd_registry_products
    WHERE concept_id = NEW.id
  ) THEN
    RETURN NEW;
  END IF;

  SELECT count(*)
  INTO v_active_count
  FROM public.npd_registry_products
  WHERE queue = 'Active Development';

  v_queue := CASE
    WHEN v_active_count < 13 THEN 'Active Development'
    ELSE 'Greenlight Bench'
  END;

  SELECT coalesce(max(sort_order), 0) + 1
  INTO v_sort_order
  FROM public.npd_registry_products
  WHERE queue = v_queue;

  SELECT
    cs.composite_score,
    cs.recommendation_tier,
    cs.overall_assessment,
    cs.quality_gate_status,
    cs.scoring_version
  INTO
    v_score,
    v_tier,
    v_assessment,
    v_quality_gate,
    v_scoring_version
  FROM public.concept_scores cs
  WHERE cs.concept_id = NEW.id
  ORDER BY cs.updated_at DESC NULLS LAST, cs.scored_at DESC NULLS LAST
  LIMIT 1;

  SELECT ic.ingredient_name, ic.category
  INTO v_ingredient, v_category
  FROM public.idea_candidates ic
  WHERE ic.id = NEW.candidate_id;

  v_confidence := CASE
    WHEN coalesce(NEW.confidence_score, 0) >= 8 THEN 'High'
    WHEN coalesce(NEW.confidence_score, 0) >= 5 THEN 'Med'
    ELSE 'Low'
  END;

  v_lv_band := CASE
    WHEN v_score IS NULL THEN NULL
    WHEN v_score >= 80 THEN 'Attack Now'
    WHEN v_score >= 70 THEN 'Needs One Unlock'
    WHEN v_score >= 60 THEN 'Selective Hold'
    ELSE 'Park / Reframe'
  END;

  INSERT INTO public.npd_registry_products (
    product,
    queue,
    state,
    priority,
    lv_score,
    lv_score_note,
    lv_band,
    confidence,
    last_updated,
    today_action,
    decision_needed,
    blocker_risk,
    concept_id,
    registry_anchor,
    detail_markdown,
    sort_order
  )
  VALUES (
    NEW.concept_name,
    v_queue,
    CASE WHEN NEW.status = 'in_development' THEN 'In development' ELSE 'Evaluation complete (Phase B passed)' END,
    'medium',
    round(v_score),
    'Auto-created from greenlit concept; Phase B composite shown where available, not a separate full registry LV rescore.',
    v_lv_band,
    v_confidence,
    current_date,
    'Create development folder/Notion/GDrive handoff and confirm first development unlock.',
    'Confirm first active R&D decision before committing supplier or formulation work.',
    'Auto-created registry row; development folder/Notion/GDrive links may still need creation.',
    NEW.id,
    lower(regexp_replace(regexp_replace(NEW.concept_name, '[^a-zA-Z0-9]+', '-', 'g'), '(^-|-$)', '', 'g')),
    concat_ws(E'\n',
      '## Auto-created from Development move',
      'This registry row was created when the concept status changed to greenlit/in_development.',
      concat('- Ingredient: ', coalesce(v_ingredient, 'unknown')),
      concat('- Category: ', coalesce(v_category, 'unknown')),
      concat('- Format: ', coalesce(NEW.format, 'unknown')),
      concat('- Target dosage: ', coalesce(NEW.target_dosage, 'unknown')),
      concat('- Phase B score: ', coalesce(round(v_score, 1)::text, 'not scored'), ' / 100; tier ', coalesce(v_tier, 'unknown')),
      concat('- Quality gate: ', coalesce(v_quality_gate, 'unknown'), '; scoring version ', coalesce(v_scoring_version, 'unknown')),
      concat('- Assessment: ', coalesce(v_assessment, 'not available'))
    ),
    v_sort_order
  )
  ON CONFLICT (concept_id) WHERE concept_id IS NOT NULL DO NOTHING;

  RETURN NEW;
END;
$function$;


CREATE OR REPLACE FUNCTION public.touch_category_atlas_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
begin
  new.updated_at = now();
  return new;
end;
$function$;


CREATE OR REPLACE FUNCTION public.touch_market_curation_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
begin
  new.updated_at = now();
  return new;
end;
$function$;


CREATE OR REPLACE FUNCTION public.touch_npd_registry_products_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
begin
  new.updated_at = now();
  return new;
end;
$function$;


CREATE OR REPLACE FUNCTION public.touch_opportunity_operating_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
begin
  new.updated_at = now();
  return new;
end;
$function$;


CREATE OR REPLACE FUNCTION public.update_candidate_timestamp()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
    NEW.last_updated_at = NOW();
    RETURN NEW;
END;
$function$;


CREATE OR REPLACE FUNCTION public.update_product_concepts_timestamp()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$function$;


CREATE OR REPLACE FUNCTION public.update_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$;
