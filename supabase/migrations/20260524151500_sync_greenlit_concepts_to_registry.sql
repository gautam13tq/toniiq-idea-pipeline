-- Ensure concepts moved to Development are visible in the Development Cockpit.
--
-- The lifecycle trigger already enqueues create_dev_folder when a concept
-- becomes greenlit. This companion trigger creates the npd_registry_products
-- row immediately so the /development cockpit does not depend on a later
-- manual pending_action cleanup.

CREATE UNIQUE INDEX IF NOT EXISTS npd_registry_products_concept_id_unique
  ON public.npd_registry_products (concept_id)
  WHERE concept_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.sync_greenlit_concept_to_npd_registry()
RETURNS trigger
LANGUAGE plpgsql
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

DROP TRIGGER IF EXISTS trg_sync_greenlit_concept_to_npd_registry ON public.product_concepts;

CREATE TRIGGER trg_sync_greenlit_concept_to_npd_registry
AFTER INSERT OR UPDATE OF status ON public.product_concepts
FOR EACH ROW
WHEN (NEW.status IN ('greenlit', 'in_development'))
EXECUTE FUNCTION public.sync_greenlit_concept_to_npd_registry();
