-- Exported from live Supabase toniiq-npd (gmfndxaoeztxohbbkudu), supabase_migrations.schema_migrations, on 2026-10-22.
-- QA fix 2026-08-19 (part 2): the async dispatch machinery for pending_actions.
-- Without this, Accept-concept clicks queue run_phase_a/b rows nothing picks up.
CREATE EXTENSION IF NOT EXISTS pg_cron;

CREATE OR REPLACE FUNCTION public._invoke_phase_a_gather(p_action_id uuid)
 RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER
 SET search_path TO 'public', 'vault', 'pg_temp'
AS $function$
DECLARE
  v_endpoint text; v_jwt text; v_request_id bigint;
BEGIN
  SELECT value INTO v_endpoint FROM system_config WHERE key = 'supabase_functions_url';
  IF v_endpoint IS NULL THEN
    RAISE WARNING 'supabase_functions_url missing from system_config'; RETURN NULL;
  END IF;
  SELECT decrypted_secret INTO v_jwt FROM vault.decrypted_secrets WHERE name = 'supabase_anon_jwt';
  IF v_jwt IS NULL THEN
    RAISE WARNING 'supabase_anon_jwt missing from vault.decrypted_secrets'; RETURN NULL;
  END IF;
  SELECT net.http_post(
    url := v_endpoint || '/phase-a-gather',
    body := jsonb_build_object('pending_action_id', p_action_id),
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||v_jwt,'apikey',v_jwt),
    timeout_milliseconds := 5000
  ) INTO v_request_id;
  RETURN v_request_id;
END; $function$;

CREATE OR REPLACE FUNCTION public._invoke_phase_b_evaluate(p_action_id uuid)
 RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER
 SET search_path TO 'public', 'vault', 'pg_temp'
AS $function$
DECLARE
  v_endpoint text; v_jwt text; v_request_id bigint;
BEGIN
  SELECT value INTO v_endpoint FROM system_config WHERE key = 'supabase_functions_url';
  IF v_endpoint IS NULL THEN
    RAISE WARNING 'supabase_functions_url missing from system_config'; RETURN NULL;
  END IF;
  SELECT decrypted_secret INTO v_jwt FROM vault.decrypted_secrets WHERE name = 'supabase_anon_jwt';
  IF v_jwt IS NULL THEN
    RAISE WARNING 'supabase_anon_jwt missing from vault.decrypted_secrets'; RETURN NULL;
  END IF;
  SELECT net.http_post(
    url := v_endpoint || '/phase-b-evaluate',
    body := jsonb_build_object('pending_action_id', p_action_id),
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||v_jwt,'apikey',v_jwt),
    timeout_milliseconds := 5000
  ) INTO v_request_id;
  RETURN v_request_id;
END; $function$;

CREATE OR REPLACE FUNCTION public.dispatch_pending_phase_a()
 RETURNS integer LANGUAGE plpgsql SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE r record; n integer := 0; in_flight integer;
BEGIN
  -- Throttle: at most 1 run_phase_a in flight (Apify autocomplete rate limits)
  SELECT COUNT(*) INTO in_flight FROM pending_actions
    WHERE action='run_phase_a' AND status='in_progress';
  IF in_flight >= 1 THEN RETURN 0; END IF;
  FOR r IN
    SELECT id FROM pending_actions
    WHERE action='run_phase_a' AND status='pending' AND created_at < NOW() - INTERVAL '30 seconds'
    ORDER BY created_at LIMIT 1
  LOOP
    UPDATE pending_actions SET status='in_progress', started_at=NOW(),
      notes='Picked up by cron dispatcher' WHERE id=r.id AND status='pending';
    IF FOUND THEN PERFORM _invoke_phase_a_gather(r.id); n := n + 1; END IF;
  END LOOP;
  RETURN n;
END; $function$;

CREATE OR REPLACE FUNCTION public.dispatch_pending_phase_b()
 RETURNS integer LANGUAGE plpgsql SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE r record; n integer := 0;
BEGIN
  FOR r IN
    SELECT id FROM pending_actions
    WHERE action='run_phase_b' AND status='pending' AND created_at < NOW() - INTERVAL '30 seconds'
    ORDER BY created_at LIMIT 3  -- Phase B heavier; keep parallelism low
  LOOP
    UPDATE pending_actions SET status='in_progress', started_at=NOW(),
      notes='Picked up by cron dispatcher' WHERE id=r.id AND status='pending';
    IF FOUND THEN PERFORM _invoke_phase_b_evaluate(r.id); n := n + 1; END IF;
  END LOOP;
  RETURN n;
END; $function$;

CREATE OR REPLACE FUNCTION public.reap_stale_pending_actions()
 RETURNS integer LANGUAGE plpgsql SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE n integer;
BEGIN
  UPDATE pending_actions
  SET status='failed', completed_at=NOW(),
      notes=COALESCE(notes,'') || ' [auto-failed by reaper: in_progress > 10 min, edge function likely timed out]'
  WHERE status='in_progress' AND action IN ('run_phase_a','run_phase_b')
    AND started_at < NOW() - INTERVAL '10 minutes';
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END; $function$;

REVOKE EXECUTE ON FUNCTION public._invoke_phase_a_gather(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public._invoke_phase_b_evaluate(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.dispatch_pending_phase_a() FROM anon;
REVOKE EXECUTE ON FUNCTION public.dispatch_pending_phase_b() FROM anon;
REVOKE EXECUTE ON FUNCTION public.reap_stale_pending_actions() FROM anon;

-- The three cron jobs (same names/schedules as source)
SELECT cron.schedule('phase-a-dispatcher', '* * * * *', 'SELECT dispatch_pending_phase_a();');
SELECT cron.schedule('dispatch_pending_phase_b', '* * * * *', 'SELECT dispatch_pending_phase_b();');
SELECT cron.schedule('reap_stale_pending_actions', '*/2 * * * *', 'SELECT reap_stale_pending_actions();');
