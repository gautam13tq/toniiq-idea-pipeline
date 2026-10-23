-- Bump the pending_actions reaper threshold from 6 min to 10 min.
--
-- Context (2026-05-19 audit): several Phase A runs hit the 6-min reaper while
-- still in_progress on the science research / web_search step. The function's
-- own internal wall clock is ~150s but science research with Anthropic web
-- search can push past 6 min when the search index is slow or under retry.
-- Bumping to 10 min absorbs that variance without changing the function's
-- inner architecture. Pending_actions stuck for >10 min are still a real
-- problem worth surfacing.
--
-- The phase-a-dispatcher cron continues to run every minute, and the reaper
-- cron continues to run every 2 minutes — only the staleness threshold moves.

CREATE OR REPLACE FUNCTION public.reap_stale_pending_actions()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  n integer;
BEGIN
  UPDATE pending_actions
  SET status = 'failed',
      completed_at = NOW(),
      notes = COALESCE(notes, '') || ' [auto-failed by reaper: in_progress > 10 min, edge function likely timed out]'
  WHERE status = 'in_progress'
    AND action IN ('run_phase_a', 'run_phase_b')
    AND started_at < NOW() - INTERVAL '10 minutes';
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$function$;
