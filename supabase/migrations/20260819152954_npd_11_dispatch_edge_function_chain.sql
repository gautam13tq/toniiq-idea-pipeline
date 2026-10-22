-- Exported from live Supabase toniiq-npd (gmfndxaoeztxohbbkudu), supabase_migrations.schema_migrations, on 2026-10-22.
-- QA fix 2026-08-19: port the edge-function dispatch chain missed by the clone.
-- Enables Phase A gather→think hand-off (phase-a-gather calls rpc dispatch_edge_function).
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Vault secret: this project's anon JWT (public client key, used only as the
-- Authorization header for internal function-to-function dispatch).
SELECT vault.create_secret(
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdtZm5keGFvZXp0eG9oYmJrdWR1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODcxNDU3ODMsImV4cCI6MjEwMjcyMTc4M30.U_t8nwIrEfROL7a4aBBC08jFj6gJuZ2B1fV_2kUumeU',
  'supabase_anon_jwt'
);

CREATE OR REPLACE FUNCTION public.get_internal_auth_header()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'vault', 'public', 'pg_temp'
AS $function$
  SELECT 'Bearer ' || decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_anon_jwt';
$function$;

CREATE OR REPLACE FUNCTION public.dispatch_edge_function(p_function_name text, p_body jsonb)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'net', 'pg_temp'
AS $function$
DECLARE
  v_request_id BIGINT;
  v_url        TEXT;
  v_auth       TEXT;
BEGIN
  -- Pull the URL from system_config rather than hard-coding (matches the
  -- _invoke_phase_a_gather pattern).
  SELECT value INTO v_url FROM public.system_config WHERE key = 'supabase_functions_url';
  IF v_url IS NULL THEN
    RAISE EXCEPTION 'system_config.supabase_functions_url not set';
  END IF;

  -- Bearer anon JWT from Vault. Same auth header all the other crons use.
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

-- Lock down direct access like a SECURITY DEFINER internal should be:
REVOKE EXECUTE ON FUNCTION public.get_internal_auth_header() FROM anon;
REVOKE EXECUTE ON FUNCTION public.dispatch_edge_function(text, jsonb) FROM anon;
