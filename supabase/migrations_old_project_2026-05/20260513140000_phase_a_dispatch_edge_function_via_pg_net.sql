-- Phase A — fire-and-forget chain hardening (2026-05-13)
--
-- Background:
--   phase-a-gather chains to phase-a-think after both research branches
--   complete. The previous designs all relied on Deno fetch from inside the
--   Edge Function, which gets aborted when the Edge Function exits — so when
--   gather hit the 150s Supabase wall clock, the in-flight think dispatch
--   was killed and think never spawned. The action would sit `in_progress`
--   until the 6-minute reaper killed it.
--
-- Fix:
--   Move the dispatch into Postgres via pg_net.http_post. Background workers
--   queue and fire the HTTP request independently of any Edge Function's
--   lifecycle. The Edge Function returns immediately after the RPC call.
--
-- Auth:
--   Same anon-JWT-from-Vault pattern used by every other Supabase cron in
--   this project (sync_shopify_daily, etc.) — via get_internal_auth_header().
--   This is the proven, working pattern.

CREATE OR REPLACE FUNCTION public.dispatch_edge_function(
  p_function_name TEXT,
  p_body          JSONB
) RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'net'
AS $function$
DECLARE
  v_request_id BIGINT;
  v_url        TEXT;
  v_auth       TEXT;
BEGIN
  SELECT value INTO v_url FROM public.system_config WHERE key = 'supabase_functions_url';
  IF v_url IS NULL THEN
    RAISE EXCEPTION 'system_config.supabase_functions_url not set';
  END IF;

  v_auth := public.get_internal_auth_header();
  IF v_auth IS NULL THEN
    RAISE EXCEPTION 'get_internal_auth_header() returned NULL — vault supabase_anon_jwt missing';
  END IF;

  SELECT net.http_post(
    url                  := v_url || '/' || p_function_name,
    headers              := jsonb_build_object(
                              'Content-Type',  'application/json',
                              'Authorization', v_auth
                            ),
    body                 := p_body,
    timeout_milliseconds := 300000
  ) INTO v_request_id;
  RETURN v_request_id;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.dispatch_edge_function(TEXT, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.dispatch_edge_function(TEXT, JSONB) TO authenticated;
