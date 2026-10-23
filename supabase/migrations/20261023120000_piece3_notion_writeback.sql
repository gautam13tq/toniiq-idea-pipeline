-- Piece 3 of the Amazon ideas rebuild (2026-10-23): Notion write-back support.
--
-- A Notion "Product Ideas" row is linked to one concept through
-- product_concepts.notion_page_id. score_idea() resolves a call by that page id first,
-- so renaming the Notion row never creates a second concept, and stamps the id on the
-- concept the first time it scores the row.
-- notion_writeback_queue() lists v5 scores of linked concepts that are not yet written
-- to Notion; mark_notion_synced(score_id) records that the agent wrote one.
-- Claude does the Notion side when it files and scores ideas from Gautam's dumps.

ALTER TABLE public.product_concepts ADD COLUMN IF NOT EXISTS notion_page_id text;
CREATE UNIQUE INDEX IF NOT EXISTS product_concepts_notion_page_id_key
  ON public.product_concepts (notion_page_id) WHERE notion_page_id IS NOT NULL;
ALTER TABLE public.concept_scores ADD COLUMN IF NOT EXISTS notion_synced_at timestamptz;

CREATE OR REPLACE FUNCTION public._score_idea_core(p jsonb)
 RETURNS jsonb LANGUAGE plpgsql VOLATILE
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_name text := nullif(btrim(p->>'idea_name'), '');
  v_notes text := nullif(btrim(p->>'notes'), '');
  v_format text := nullif(btrim(p->>'format'), '');
  v_page text := nullif(btrim(p->>'notion_page_id'), '');
  v_page_note text;
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
  -- 1. Resolve the idea and its concept. A Notion row keeps its concept even if
  --    the row's title is edited later.
  IF nullif(p->>'concept_id', '') IS NULL AND v_page IS NOT NULL THEN
    SELECT * INTO v_concept FROM product_concepts WHERE notion_page_id = v_page FOR UPDATE;
    IF FOUND THEN
      SELECT * INTO v_cand FROM idea_candidates WHERE id = v_concept.candidate_id;
    END IF;
  END IF;

  IF v_concept.id IS NOT NULL THEN
    NULL;
  ELSIF nullif(p->>'concept_id', '') IS NOT NULL THEN
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

  IF v_page IS NOT NULL AND v_concept.notion_page_id IS NULL THEN
    IF EXISTS (SELECT 1 FROM product_concepts WHERE notion_page_id = v_page) THEN
      v_page_note := 'This Notion row is already linked to another concept; link not changed.';
    ELSE
      UPDATE product_concepts SET notion_page_id = v_page WHERE id = v_concept.id
      RETURNING * INTO v_concept;
    END IF;
  ELSIF v_page IS NOT NULL AND v_concept.notion_page_id <> v_page THEN
    v_page_note := 'This concept is linked to another Notion row; link not changed.';
  END IF;

  v_base := jsonb_build_object(
    'idea_name', v_concept.concept_name,
    'concept_id', v_concept.id,
    'candidate_id', v_concept.candidate_id,
    'concept_status', v_concept.status,
    'notion_page_id', v_concept.notion_page_id,
    'created', jsonb_build_object('candidate', v_new_candidate, 'concept', v_new_concept))
    || CASE WHEN v_page_note IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('notion_note', v_page_note) END;

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

CREATE OR REPLACE FUNCTION public.notion_writeback_queue()
 RETURNS SETOF jsonb LANGUAGE sql STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  -- The latest v5 score of each Notion-linked concept, while it is unsynced.
  SELECT jsonb_build_object('notion_page_id', c.notion_page_id, 'score_id', s.id)
         || jsonb_build_object('result', idea_score_result(s.id))
    FROM product_concepts c
    JOIN LATERAL (
      SELECT id, notion_synced_at FROM concept_scores
       WHERE concept_id = c.id AND scoring_version LIKE 'phase-b-v5%'
       ORDER BY scored_at DESC NULLS LAST LIMIT 1) s ON true
   WHERE c.notion_page_id IS NOT NULL AND s.notion_synced_at IS NULL
   ORDER BY c.notion_page_id
$function$;

CREATE OR REPLACE FUNCTION public.mark_notion_synced(p_score_id uuid)
 RETURNS timestamptz LANGUAGE sql VOLATILE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  UPDATE concept_scores SET notion_synced_at = now() WHERE id = p_score_id
  RETURNING notion_synced_at
$function$;

REVOKE ALL ON FUNCTION public._score_idea_core(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notion_writeback_queue() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_notion_synced(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.notion_writeback_queue() TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_notion_synced(uuid) TO service_role;
