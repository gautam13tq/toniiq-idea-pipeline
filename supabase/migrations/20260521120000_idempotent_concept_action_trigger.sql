-- Make the enqueue_concept_action trigger idempotent.
--
-- Background (2026-05-21): A Phase B re-fire reproduced a race where a manual
-- INSERT into pending_actions for a concept ran concurrently with the auto-
-- trigger's INSERT (fired when concept.status was reset to 'accepted'). Both
-- pending_actions got picked up and phase-b-evaluate ran twice in parallel for
-- the same concept, hammering Apify TikTok memory and getting both runs killed
-- by the 10-min reaper.
--
-- Fix: the trigger now checks whether a pending or in_progress action already
-- exists for (concept_id, action) and skips the insert if so. Safe-by-default:
-- you can still manually insert a pending_action, and the trigger won't
-- duplicate. You can also retry a failed/completed action by resetting status
-- to 'accepted' — the trigger will insert a fresh one because the prior is no
-- longer pending/in_progress.

CREATE OR REPLACE FUNCTION public.enqueue_concept_action()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  v_action text;
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

  -- Idempotency guard: skip if a pending or in_progress action already exists
  -- for this (concept, action). Prevents duplicate dispatch when concept status
  -- is toggled or when both a trigger and a manual INSERT race.
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
